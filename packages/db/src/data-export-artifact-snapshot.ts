import { createHash } from "node:crypto";
import type { ExportRecordClaim } from "./data-export-record-snapshot.js";
import type { SqlQueryExecutor } from "./lifecycle-store.js";

/**
 * A lease-bound, read-only artifact METADATA preparation slice.
 * Never includes stored bytes or storage paths and grants no download,
 * complete-export status, deletion or recovery capability.
 */
export class ExportArtifactSnapshotUnavailableError extends Error {
  constructor() {
    super("The claimed artifact metadata snapshot is unavailable or exceeds its safe limits.");
    this.name = "ExportArtifactSnapshotUnavailableError";
  }
}

type ArtifactRow = {
  id: unknown;
  run_id: unknown;
  kind: unknown;
  name: unknown;
  role: unknown;
  sha256: unknown;
  bytes: unknown;
  content_type: unknown;
};

const validText = (value: unknown, maxLength = 256): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= maxLength &&
  Buffer.byteLength(value, "utf8") <= maxLength &&
  value.trim() === value;

/** A bounded lowercase SHA-256 digest check that never runs a regex on metadata. */
const validSha256 = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length !== 64) return false;
  for (let index = 0; index < value.length; index++) {
    const char = value.charCodeAt(index);
    if (!((char >= 48 && char <= 57) || (char >= 97 && char <= 102))) return false;
  }
  return true;
};

export async function prepareClaimedArtifactMetadataSnapshot(
  db: SqlQueryExecutor,
  input: ExportRecordClaim,
): Promise<{ bytes: Buffer; byteLength: number; sha256: string; contentType: "application/json" } | null> {
  if (![input.exportId, input.tenantId, input.installationId, input.workerId, input.token].every((v) => validText(v))) {
    throw new ExportArtifactSnapshotUnavailableError();
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
        AND ((exports.scope='organization' AND exports.scope_id IS NULL)
          OR (exports.scope='repository' AND EXISTS (
            SELECT 1 FROM repositories
            WHERE repositories.id=exports.scope_id
              AND repositories.installation_id=installations.id
              AND repositories.disabled_at IS NULL)))
    ), permitted_repositories AS MATERIALIZED (
      SELECT repositories.id FROM repositories
      JOIN allowed ON allowed.installation_id=repositories.installation_id
      WHERE repositories.disabled_at IS NULL
        AND (allowed.scope='organization' OR repositories.id=allowed.scope_id)
    ), artifact_rows AS (
      SELECT artifacts.id, artifacts.run_id, artifacts.kind,
             artifacts.name, artifacts.role, artifacts.sha256,
             artifacts.bytes, artifacts.content_type
      FROM artifacts
      JOIN release_runs ON release_runs.id=artifacts.run_id
      JOIN permitted_repositories ON permitted_repositories.id=release_runs.repository_id
      ORDER BY artifacts.id LIMIT 101
    )
    SELECT (SELECT COALESCE(jsonb_agg(to_jsonb(artifact_rows) ORDER BY artifact_rows.id),'[]'::jsonb)
            FROM artifact_rows) AS artifacts
    FROM allowed LIMIT 1`,
    [input.exportId, input.tenantId, input.installationId, input.workerId, input.token],
  )) as { rows?: Array<{ artifacts: unknown }> };

  const data = result.rows?.[0];
  if (!data) return null;
  if (!Array.isArray(data.artifacts) || data.artifacts.length > 100) {
    throw new ExportArtifactSnapshotUnavailableError();
  }

  const seenIds = new Set<string>();
  const artifacts = data.artifacts.map((row: ArtifactRow) => {
    if (
      !row ||
      !validText(row.id) ||
      !validText(row.run_id) ||
      !validText(row.kind) ||
      !validText(row.name, 1024) ||
      !validText(row.role) ||
      !validText(row.content_type) ||
      !validSha256(row.sha256) ||
      typeof row.bytes !== "number" ||
      !Number.isSafeInteger(row.bytes) ||
      row.bytes < 0 ||
      seenIds.has(row.id)
    ) {
      throw new ExportArtifactSnapshotUnavailableError();
    }
    seenIds.add(row.id);
    return {
      id: row.id,
      runId: row.run_id,
      kind: row.kind,
      name: row.name,
      role: row.role,
      sha256: row.sha256,
      byteLength: row.bytes,
      contentType: row.content_type,
    };
  });

  const bytes = Buffer.from(
    JSON.stringify({
      formatVersion: 1,
      kind: "boardreadyops.claimed-artifact-metadata-snapshot",
      coverage: "active-installation-artifact-metadata-only",
      exportId: input.exportId,
      exclusions: ["artifact-contents", "storage-paths", "reviews", "audit-events", "source-code", "platform-backups"],
      artifacts,
    }),
    "utf8",
  );
  if (bytes.length === 0 || bytes.length > 256 * 1024) throw new ExportArtifactSnapshotUnavailableError();
  return {
    bytes,
    byteLength: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    contentType: "application/json",
  };
}
