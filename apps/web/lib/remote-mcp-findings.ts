import { findingSeveritySchema } from "@boardreadyops/contracts";
import type { SqlQueryExecutor } from "@boardreadyops/db";
import {
  type CheckLiveRepositoryPermission,
  loadAuthorizedRemoteReviewSnapshot,
  type RemoteMcpPrincipal,
} from "./remote-mcp-access.js";

const pageSize = 30;
const allowedId = /^[A-Za-z0-9_-]{1,120}$/u;
const allowedRule = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const allowedKind = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;
const allowedFingerprint = /^[A-Za-z0-9_-]{1,128}$/u;

type FindingRow = {
  id: string;
  rule_id: string;
  severity: string;
  kind: string | null;
  fingerprint: string | null;
};

/**
 * Read only persisted, deterministic finding identifiers for the exact current
 * Review head. Re-check GitHub collaborator authority per request before
 * loading any finding. Never copy DB messages, paths, coordinates or raw CAD.
 */
export async function loadAuthorizedRemoteFindings(
  db: Pick<SqlQueryExecutor, "query">,
  principal: RemoteMcpPrincipal,
  reviewId: string,
  cursor: string | undefined,
  checkCurrentPermission: CheckLiveRepositoryPermission,
): Promise<{
  schemaVersion: 1;
  availability: "available";
  evidenceDigest: string;
  headCommitSha: string;
  findings: Array<{
    ruleId: string;
    severity: "error" | "high" | "medium" | "low" | "info";
    kind: string | null;
    fingerprint: string | null;
  }>;
  nextCursor: string | null;
} | null> {
  if (!principal.scopes.includes("review:read") || (cursor !== undefined && !allowedId.test(cursor))) return null;
  const snapshot = await loadAuthorizedRemoteReviewSnapshot(db, principal, reviewId, checkCurrentPermission);
  if (!snapshot?.facts.headCommitSha || !snapshot.facts.evidenceDigest) return null;

  const result = await db.query(
    `select id, rule_id, severity, kind, fingerprint
       from findings
      where run_id = $1 and ($2::text is null or id > $2)
      order by id asc
      limit $3`,
    [snapshot.headRunId, cursor ?? null, pageSize + 1],
  );
  const rows: unknown = (result as { rows?: unknown }).rows;
  if (!Array.isArray(rows) || rows.length > pageSize + 1) return null;
  const findings: Array<{
    ruleId: string;
    severity: "error" | "high" | "medium" | "low" | "info";
    kind: string | null;
    fingerprint: string | null;
  }> = [];
  for (const input of rows.slice(0, pageSize)) {
    const row = input as Partial<FindingRow> | null;
    if (
      !row ||
      typeof row.id !== "string" ||
      !allowedId.test(row.id) ||
      typeof row.rule_id !== "string" ||
      !allowedRule.test(row.rule_id) ||
      !findingSeveritySchema.safeParse(row.severity).success ||
      (row.kind !== null && (typeof row.kind !== "string" || !allowedKind.test(row.kind))) ||
      (row.fingerprint !== null && (typeof row.fingerprint !== "string" || !allowedFingerprint.test(row.fingerprint)))
    )
      return null;
    findings.push({
      ruleId: row.rule_id,
      severity: row.severity as "error" | "high" | "medium" | "low" | "info",
      kind: row.kind,
      fingerprint: row.fingerprint,
    });
  }
  const last = rows[pageSize - 1] as FindingRow | undefined;
  return {
    schemaVersion: 1,
    availability: "available",
    evidenceDigest: snapshot.facts.evidenceDigest,
    headCommitSha: snapshot.facts.headCommitSha,
    findings,
    nextCursor: rows.length > pageSize ? (last?.id ?? null) : null,
  };
}
