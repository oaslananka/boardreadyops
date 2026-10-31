import { createHash } from "node:crypto";
import type { SqlQueryExecutor } from "./lifecycle-store.js";

/**
 * A read-only, deliberately incomplete export building block.
 * Never a customer download, full archive or export completion signal.
 * A cap breach rejects the whole slice instead of silently truncating it.
 */
export class ExportRecordSnapshotUnavailableError extends Error {
  constructor() {
    super("The claimed export record snapshot is unavailable or exceeds its safe limits.");
    this.name = "ExportRecordSnapshotUnavailableError";
  }
}

export type ClaimedRecordSnapshot = {
  readonly bytes: Buffer;
  readonly byteLength: number;
  readonly sha256: string;
  readonly contentType: "application/json";
};
export type ExportRecordClaim = {
  exportId: string;
  tenantId: string;
  installationId: string;
  workerId: string;
  token: string;
};

const maxRows = 100;
const maxBytes = 256 * 1024;
const canonical = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 256 && value.trim() === value;

type RunRow = {
  id: string;
  repository_id: string;
  commit_sha: string;
  ref: string;
  status: string;
  decision: string | null;
};
type FindingRow = {
  id: string;
  run_id: string;
  rule_id: string;
  severity: string;
  message: string;
  path: string | null;
  kind: string | null;
};

/** One DB statement under the original unexpired lease, not a download route. */
export async function prepareClaimedRunFindingSnapshot(
  db: SqlQueryExecutor,
  input: ExportRecordClaim,
): Promise<ClaimedRecordSnapshot | null> {
  if (![input.exportId, input.tenantId, input.installationId, input.workerId, input.token].every(canonical)) {
    throw new ExportRecordSnapshotUnavailableError();
  }
  const result = (await db.query(
    `WITH allowed AS MATERIALIZED (
       SELECT exports.id, exports.scope, exports.scope_id, installations.id AS installation_id
         FROM data_exports AS exports
         JOIN installations ON installations.id=exports.installation_id
        WHERE exports.id=$1 AND lower(exports.tenant_id)=lower($2)
          AND exports.installation_id=$3 AND exports.status='running'
          AND exports.preparation_worker=$4 AND exports.preparation_token=$5
          AND exports.preparation_lease_until>NOW()
          AND installations.suspended_at IS NULL
          AND lower(installations.account_login)=lower(exports.tenant_id)
          AND ( (exports.scope='organization' AND exports.scope_id IS NULL)
                OR (exports.scope='repository' AND EXISTS (
                  SELECT 1 FROM repositories
                   WHERE repositories.id=exports.scope_id
                     AND repositories.installation_id=installations.id
                     AND repositories.disabled_at IS NULL)) )
     ),
     permitted_repositories AS MATERIALIZED (
       SELECT repositories.id FROM repositories
       JOIN allowed ON allowed.installation_id=repositories.installation_id
       WHERE repositories.disabled_at IS NULL
         AND (allowed.scope='organization' OR repositories.id=allowed.scope_id)
     ),
     run_rows AS (
       SELECT release_runs.id, release_runs.repository_id, release_runs.commit_sha,
              release_runs.ref, release_runs.status, release_runs.decision
         FROM release_runs JOIN permitted_repositories ON permitted_repositories.id=release_runs.repository_id
        ORDER BY release_runs.id LIMIT 101
     ),
     finding_rows AS (
       SELECT findings.id, findings.run_id, findings.rule_id, findings.severity,
              findings.message, findings.path, findings.kind
         FROM findings JOIN release_runs ON release_runs.id=findings.run_id
         JOIN permitted_repositories ON permitted_repositories.id=release_runs.repository_id
        ORDER BY findings.id LIMIT 101
     )
     SELECT
       (SELECT COALESCE(jsonb_agg(to_jsonb(run_rows) ORDER BY run_rows.id),'[]'::jsonb) FROM run_rows) AS runs,
       (SELECT COALESCE(jsonb_agg(to_jsonb(finding_rows) ORDER BY finding_rows.id),'[]'::jsonb) FROM finding_rows) AS findings
     FROM allowed LIMIT 1`,
    [input.exportId, input.tenantId, input.installationId, input.workerId, input.token],
  )) as { rows?: Array<{ runs: unknown; findings: unknown }> };
  const record = result.rows?.[0];
  if (!record) return null;
  if (!Array.isArray(record.runs) || !Array.isArray(record.findings)) throw new ExportRecordSnapshotUnavailableError();
  if (record.runs.length > maxRows || record.findings.length > maxRows)
    throw new ExportRecordSnapshotUnavailableError();

  const runs = record.runs.map((r: RunRow) => {
    if (
      !r ||
      ![r.id, r.repository_id, r.commit_sha, r.ref, r.status].every(canonical) ||
      (r.decision !== null && !canonical(r.decision))
    )
      throw new ExportRecordSnapshotUnavailableError();
    return {
      id: r.id,
      repositoryId: r.repository_id,
      commitSha: r.commit_sha,
      ref: r.ref,
      status: r.status,
      decision: r.decision,
    };
  });
  const runIds = new Set(runs.map((run) => run.id));
  const findings = record.findings.map((f: FindingRow) => {
    if (
      !f ||
      ![f.id, f.run_id, f.rule_id, f.severity].every(canonical) ||
      typeof f.message !== "string" ||
      (f.path !== null && typeof f.path !== "string") ||
      (f.kind !== null && typeof f.kind !== "string") ||
      !runIds.has(f.run_id)
    )
      throw new ExportRecordSnapshotUnavailableError();
    return {
      id: f.id,
      runId: f.run_id,
      ruleId: f.rule_id,
      severity: f.severity,
      message: f.message,
      path: f.path,
      kind: f.kind,
    };
  });
  const bytes = Buffer.from(
    JSON.stringify({
      formatVersion: 1,
      kind: "boardreadyops.claimed-run-finding-snapshot",
      coverage: "active-installation-release-runs-and-findings-only",
      exportId: input.exportId,
      exclusions: ["artifacts", "audit-events", "reviews", "source-code", "backups-and-platform-logs"],
      runs,
      findings,
    }),
    "utf8",
  );
  if (!bytes.length || bytes.length > maxBytes) throw new ExportRecordSnapshotUnavailableError();
  return {
    bytes,
    byteLength: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    contentType: "application/json",
  };
}
