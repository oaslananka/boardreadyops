import type { SqlQueryExecutor } from "@boardreadyops/db";
import { loadRunPcbFootprintSummary } from "@boardreadyops/db";
import {
  type CheckLiveRepositoryPermission,
  loadAuthorizedRemoteReviewSnapshot,
  type RemoteMcpPrincipal,
  sameAuthorizedRemoteReviewSnapshot,
} from "./remote-mcp-access.js";
import { remoteFootprintFacts } from "./remote-mcp-foundation.js";

/**
 * Report previously consented, client-asserted PCB footprint counts only for the
 * current authorized Review revision. A missing summary is not a zero-change claim.
 * Re-check live GitHub access AND Review source identity after the async DB read.
 */
export async function loadAuthorizedRemoteFootprintSummary(
  db: Pick<SqlQueryExecutor, "query">,
  principal: RemoteMcpPrincipal,
  reviewId: string,
  checkCurrentPermission: CheckLiveRepositoryPermission,
): Promise<ReturnType<typeof remoteFootprintFacts> | null> {
  if (!principal.scopes.includes("review:read")) return null;
  const before = await loadAuthorizedRemoteReviewSnapshot(db, principal, reviewId, checkCurrentPermission);
  if (!before?.facts.headCommitSha) return null;
  const summary = await loadRunPcbFootprintSummary(
    db,
    before.repositoryId,
    before.headRunId,
    before.baseCommitSha,
    before.facts.headCommitSha,
  );
  const current = await loadAuthorizedRemoteReviewSnapshot(db, principal, reviewId, checkCurrentPermission);
  if (!sameAuthorizedRemoteReviewSnapshot(before, current)) return null;
  return remoteFootprintFacts(summary);
}
