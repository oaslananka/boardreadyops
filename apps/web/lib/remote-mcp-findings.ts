import { createHash } from "node:crypto";
import { findingSeveritySchema } from "@boardreadyops/contracts";
import type { SqlQueryExecutor } from "@boardreadyops/db";
import {
  type CheckLiveRepositoryPermission,
  loadAuthorizedRemoteReviewSnapshot,
  type RemoteMcpPrincipal,
} from "./remote-mcp-access.js";

const pageSize = 30;
const allowedId = /^[A-Za-z0-9_-]{1,120}$/u;
const allowedRule = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const allowedKind = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;
const allowedFingerprint = /^[A-Za-z0-9_-]{1,128}$/u;
/** Versioned, bounded page token; its run tag is a one-way digest, not a DB ID. */
export const remoteFindingCursorFormat = /^v1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{1,160}$/u;

function runCursorTag(reviewId: string, headRunId: string): string {
  return createHash("sha256").update(reviewId).update("\0").update(headRunId).digest("base64url");
}

function makeCursor(reviewId: string, headRunId: string, lastId: string): string {
  return `v1.${runCursorTag(reviewId, headRunId)}.${Buffer.from(lastId, "utf8").toString("base64url")}`;
}

function readCursor(cursor: string, reviewId: string, headRunId: string): string | null {
  const match = remoteFindingCursorFormat.exec(cursor);
  if (!match) return null;
  const parts = cursor.split(".");
  if (parts.length !== 3 || parts[1] !== runCursorTag(reviewId, headRunId)) return null;
  const encodedId = parts[2];
  if (!encodedId) return null;
  const decodedId = Buffer.from(encodedId, "base64url").toString("utf8");
  if (!allowedId.test(decodedId) || Buffer.from(decodedId, "utf8").toString("base64url") !== encodedId) return null;
  return decodedId;
}

type FindingSeverity = "error" | "high" | "medium" | "low" | "info";
type PublicFinding = {
  ruleId: string;
  severity: FindingSeverity;
  kind: string | null;
  fingerprint: string | null;
};
type FindingRow = {
  id: string;
  rule_id: string;
  severity: string;
  kind: string | null;
  fingerprint: string | null;
};

/** No finding text, paths, source coordinates or arbitrary object fields cross this boundary. */
function optionalIdentifier(value: unknown, format: RegExp): value is string | null {
  return value === null || (typeof value === "string" && format.test(value));
}

function allowlistedFinding(value: unknown): { id: string; finding: PublicFinding } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Partial<FindingRow>;
  if (typeof row.id !== "string" || !allowedId.test(row.id)) return null;
  if (typeof row.rule_id !== "string" || !allowedRule.test(row.rule_id)) return null;
  const severity = findingSeveritySchema.safeParse(row.severity);
  if (!severity.success) return null;
  if (!optionalIdentifier(row.kind, allowedKind) || !optionalIdentifier(row.fingerprint, allowedFingerprint))
    return null;
  return {
    id: row.id,
    finding: {
      ruleId: row.rule_id,
      severity: severity.data,
      kind: row.kind,
      fingerprint: row.fingerprint,
    },
  };
}

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
  findings: PublicFinding[];
  nextCursor: string | null;
} | null> {
  if (!principal.scopes.includes("review:read") || (cursor !== undefined && !remoteFindingCursorFormat.test(cursor)))
    return null;
  const snapshot = await loadAuthorizedRemoteReviewSnapshot(db, principal, reviewId, checkCurrentPermission);
  if (!snapshot?.facts.headCommitSha || !snapshot.facts.evidenceDigest) return null;
  const afterId = cursor === undefined ? null : readCursor(cursor, reviewId, snapshot.headRunId);
  // An old cursor must never be applied to a new head run after a Review update.
  if (cursor !== undefined && afterId === null) return null;

  const result = await db.query(
    `select id, rule_id, severity, kind, fingerprint
       from findings
      where run_id = $1 and ($2::text is null or id > $2)
      order by id asc
      limit $3`,
    [snapshot.headRunId, afterId, pageSize + 1],
  );
  const rows: unknown = (result as { rows?: unknown }).rows;
  if (!Array.isArray(rows) || rows.length > pageSize + 1) return null;
  const findings: PublicFinding[] = [];
  let lastId: string | null = null;
  // Validate the lookahead record as well: it must not make a malformed
  // next page appear available to the caller.
  for (const [index, input] of rows.entries()) {
    const row = allowlistedFinding(input);
    if (!row) return null;
    if (index < pageSize) {
      findings.push(row.finding);
      lastId = row.id;
    }
  }
  return {
    schemaVersion: 1,
    availability: "available",
    evidenceDigest: snapshot.facts.evidenceDigest,
    headCommitSha: snapshot.facts.headCommitSha,
    findings,
    nextCursor: rows.length > pageSize && lastId ? makeCursor(reviewId, snapshot.headRunId, lastId) : null,
  };
}
