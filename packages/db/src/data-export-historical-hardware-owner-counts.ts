import { historicalOwnerCtes } from "./data-export-historical-inventory.js";
import type { PgQueryExecutor } from "./pg-executor.js";

const idIsUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(value);

const sourceNames = [
  "boards",
  "boardBomSnapshots",
  "boardBomComponents",
  "firmwareSnapshots",
  "firmwareDependencies",
  "firmwareAdvisoryWatch",
  "runPcbFootprintSummaries",
  "boardSupplyWatch",
  "boardSupplyFindings",
  "productionBatches",
  "productionBatchDefects",
  "releaseRunAttempts",
  "releaseRunResults",
  "releaseRunTransitionEvents",
  "supplyFindingSuppressions",
  "protectedReleaseIntentCandidates",
  "protectedReleaseExecutionSeals",
  "signedManufacturingExportEvidence",
  "manufacturingShareAuthorizations",
] as const;
export const historicalUserHardwareSourceNames: readonly HardwareSourceName[] = sourceNames;
type HardwareSourceName = (typeof sourceNames)[number];

/**
 * Source-only, owner-bound per-class COUNTS; never an export, disclosure,
 * customer ZIP, row-ID list, legal evidence of rights, or eligibility grant.
 * Underlying rows can contain design IP, BOM values and collaborators' data.
 * No mutable/recycled GitHub login can be the sole ownership evidence.
 */
export type HistoricalUserHardwareOwnerCounts = {
  scope: "original-numeric-user-retained-suspended-installation-only";
  releaseDecision: "NO_GO";
  completeCustomerExport: false;
  customerDeliveryAllowed: false;
  rowCounts: Record<HardwareSourceName, number>;
  // Server-side hashes; raw private rows never returned to Node.
  rowDigests: Record<HardwareSourceName, string>;
  // All nineteen classes remain unverified for customer or third-party disclosure.
  sourceRightsVerified: false;
  thirdPartyDisclosureRightsVerified: false;
};

/** Fixed owner-joined rows, bounded by the companion count limit.
 * SHA-256 entire JSONB record server-side, then hash sorted row digests.
 * Avoid returning any raw original-USER BOM/IP rows to the application.
 */
const boundedRowDigest = (relation: string, rowAlias: string): string =>
  `(SELECT encode(digest(COALESCE(string_agg(row_hash, ':' ORDER BY row_hash), ''), 'sha256'), 'hex')
            FROM (SELECT encode(digest(to_jsonb(${rowAlias})::text, 'sha256'), 'hex') AS row_hash
                    FROM ${relation} LIMIT 101) AS bounded_source)`;

const bounded = (relation: string): string =>
  `(SELECT count(*)::integer FROM (SELECT 1 FROM ${relation} LIMIT 101) AS bounded_rows)`;

/**
 * All tables and joins below are fixed, non-user-provided SQL. Explicitly
 * reject cross-repository run/snapshot links, even if PostgreSQL accepts the
 * separate FKs. Failing to reject such a link could launder another tenant's
 * design data into an original USER review candidate.
 */
const sql = `WITH ${historicalOwnerCtes},
  owned_repositories AS MATERIALIZED (
    SELECT r.id
      FROM public.repositories r
      JOIN former_installations fi ON fi.id=r.installation_id
  ),
  owned_runs AS MATERIALIZED (
    SELECT run.id,run.repository_id,run.commit_sha,run.ref
      FROM public.release_runs run
      JOIN owned_repositories r ON r.id=run.repository_id
  ),
  eligible_manufacturing_shares AS MATERIALIZED (
    SELECT share.*
      FROM public.manufacturing_share_authorizations share
      JOIN owned_runs run ON run.id=share.run_id
      JOIN public.repositories repo ON repo.id=run.repository_id
      JOIN public.revisions rev ON rev.id=share.revision_id AND rev.validation_run_id=run.id
      JOIN public.projects project ON project.id=rev.project_id AND project.workspace_id=share.workspace_id
      JOIN public.artifacts artifact ON artifact.id=share.artifact_id AND artifact.run_id=run.id AND artifact.id=rev.validation_artifact_id
      JOIN public.release_run_attempts attempt ON attempt.id=artifact.execution_attempt_id AND attempt.run_id=run.id
      JOIN public.signed_manufacturing_export_evidence evidence ON evidence.artifact_id=artifact.id AND evidence.run_id=run.id AND evidence.execution_attempt_id=attempt.id AND evidence.repository_id=repo.id AND evidence.installation_id=repo.installation_id AND evidence.github_repository_id=repo.github_repo_id
     WHERE share.authorized_by_github_user_id=(SELECT original_github_user_id FROM owner_export)
       AND lower(project.github_repo_full_name)=lower(repo.owner || '/' || repo.name)
       AND share.commit_sha=run.commit_sha AND rev.commit_sha=run.commit_sha
       AND share.archive_sha256=artifact.sha256 AND rev.bundle_sha256=artifact.sha256
       AND evidence.source_sha=run.commit_sha AND evidence.source_ref=run.ref
     LIMIT 101
  )
  SELECT owner_export.id AS export_id,
   ${bounded("public.boards b JOIN owned_repositories r ON r.id=b.repository_id")} AS "boards",
   ${boundedRowDigest("public.boards b JOIN owned_repositories r ON r.id=b.repository_id", "b")} AS "boardsDigest",
   ${bounded("public.board_bom_snapshots s JOIN public.boards b ON b.id=s.board_id JOIN owned_repositories r ON r.id=b.repository_id JOIN owned_runs run ON run.id=s.run_id AND run.repository_id=b.repository_id")} AS "boardBomSnapshots",
   ${boundedRowDigest("public.board_bom_snapshots s JOIN public.boards b ON b.id=s.board_id JOIN owned_repositories r ON r.id=b.repository_id JOIN owned_runs run ON run.id=s.run_id AND run.repository_id=b.repository_id", "s")} AS "boardBomSnapshotsDigest",
   ${bounded("public.board_bom_components c JOIN public.board_bom_snapshots s ON s.id=c.snapshot_id JOIN public.boards b ON b.id=s.board_id JOIN owned_repositories r ON r.id=b.repository_id JOIN owned_runs run ON run.id=s.run_id AND run.repository_id=b.repository_id")} AS "boardBomComponents",
   ${boundedRowDigest("public.board_bom_components c JOIN public.board_bom_snapshots s ON s.id=c.snapshot_id JOIN public.boards b ON b.id=s.board_id JOIN owned_repositories r ON r.id=b.repository_id JOIN owned_runs run ON run.id=s.run_id AND run.repository_id=b.repository_id", "c")} AS "boardBomComponentsDigest",
   ${bounded("public.repository_firmware_snapshots s JOIN owned_repositories r ON r.id=s.repository_id JOIN owned_runs run ON run.id=s.run_id AND run.repository_id=s.repository_id")} AS "firmwareSnapshots",
   ${boundedRowDigest("public.repository_firmware_snapshots s JOIN owned_repositories r ON r.id=s.repository_id JOIN owned_runs run ON run.id=s.run_id AND run.repository_id=s.repository_id", "s")} AS "firmwareSnapshotsDigest",
   ${bounded("public.repository_firmware_dependencies d JOIN public.repository_firmware_snapshots s ON s.id=d.snapshot_id JOIN owned_repositories r ON r.id=s.repository_id JOIN owned_runs run ON run.id=s.run_id AND run.repository_id=s.repository_id")} AS "firmwareDependencies",
   ${boundedRowDigest("public.repository_firmware_dependencies d JOIN public.repository_firmware_snapshots s ON s.id=d.snapshot_id JOIN owned_repositories r ON r.id=s.repository_id JOIN owned_runs run ON run.id=s.run_id AND run.repository_id=s.repository_id", "d")} AS "firmwareDependenciesDigest",
   ${bounded("public.repository_firmware_advisory_watch w JOIN owned_repositories r ON r.id=w.repository_id")} AS "firmwareAdvisoryWatch",
   ${boundedRowDigest("public.repository_firmware_advisory_watch w JOIN owned_repositories r ON r.id=w.repository_id", "w")} AS "firmwareAdvisoryWatchDigest",
   ${bounded("public.run_pcb_footprint_summaries f JOIN owned_repositories r ON r.id=f.repository_id JOIN owned_runs run ON run.id=f.run_id AND run.repository_id=f.repository_id")} AS "runPcbFootprintSummaries",
   ${boundedRowDigest("public.run_pcb_footprint_summaries f JOIN owned_repositories r ON r.id=f.repository_id JOIN owned_runs run ON run.id=f.run_id AND run.repository_id=f.repository_id", "f")} AS "runPcbFootprintSummariesDigest",
   ${bounded("public.board_supply_watch w JOIN public.boards b ON b.id=w.board_id JOIN owned_repositories r ON r.id=b.repository_id")} AS "boardSupplyWatch",
   ${boundedRowDigest("public.board_supply_watch w JOIN public.boards b ON b.id=w.board_id JOIN owned_repositories r ON r.id=b.repository_id", "w")} AS "boardSupplyWatchDigest",
   ${bounded("public.board_supply_findings f JOIN public.boards b ON b.id=f.board_id JOIN owned_repositories r ON r.id=b.repository_id")} AS "boardSupplyFindings",
   ${boundedRowDigest("public.board_supply_findings f JOIN public.boards b ON b.id=f.board_id JOIN owned_repositories r ON r.id=b.repository_id", "f")} AS "boardSupplyFindingsDigest",
   ${bounded("public.production_batches b JOIN owned_runs run ON run.id=b.release_run_id")} AS "productionBatches",
   ${boundedRowDigest("public.production_batches b JOIN owned_runs run ON run.id=b.release_run_id", "b")} AS "productionBatchesDigest",
   ${bounded("public.production_batch_defects d JOIN public.production_batches b ON b.id=d.production_batch_id JOIN owned_runs run ON run.id=b.release_run_id")} AS "productionBatchDefects",
   ${boundedRowDigest("public.production_batch_defects d JOIN public.production_batches b ON b.id=d.production_batch_id JOIN owned_runs run ON run.id=b.release_run_id", "d")} AS "productionBatchDefectsDigest",
   ${bounded("public.release_run_attempts a JOIN owned_runs run ON run.id=a.run_id")} AS "releaseRunAttempts",
   ${boundedRowDigest("public.release_run_attempts a JOIN owned_runs run ON run.id=a.run_id", "a")} AS "releaseRunAttemptsDigest",
   ${bounded("public.release_run_results res JOIN owned_runs run ON run.id=res.run_id")} AS "releaseRunResults",
   ${boundedRowDigest("public.release_run_results res JOIN owned_runs run ON run.id=res.run_id", "res")} AS "releaseRunResultsDigest",
   ${bounded("public.release_run_transition_events e JOIN owned_runs run ON run.id=e.release_run_id JOIN public.repositories repo ON repo.id=run.repository_id AND e.repository_id=repo.id AND e.installation_id=repo.installation_id")} AS "releaseRunTransitionEvents",
   ${boundedRowDigest("public.release_run_transition_events e JOIN owned_runs run ON run.id=e.release_run_id JOIN public.repositories repo ON repo.id=run.repository_id AND e.repository_id=repo.id AND e.installation_id=repo.installation_id", "e")} AS "releaseRunTransitionEventsDigest",
   ${bounded("public.supply_finding_suppressions sup JOIN public.board_supply_findings f ON f.id=sup.finding_id JOIN public.boards b ON b.id=f.board_id JOIN owned_repositories r ON r.id=b.repository_id")} AS "supplyFindingSuppressions",
   ${boundedRowDigest("public.supply_finding_suppressions sup JOIN public.board_supply_findings f ON f.id=sup.finding_id JOIN public.boards b ON b.id=f.board_id JOIN owned_repositories r ON r.id=b.repository_id", "sup")} AS "supplyFindingSuppressionsDigest",
   ${bounded("public.protected_release_intent_candidates c JOIN owned_repositories r ON r.id=c.repository_id JOIN public.repositories repo ON repo.id=r.id AND repo.installation_id=c.installation_id AND repo.github_repo_id=c.github_repository_id")} AS "protectedReleaseIntentCandidates",
   ${boundedRowDigest("public.protected_release_intent_candidates c JOIN owned_repositories r ON r.id=c.repository_id JOIN public.repositories repo ON repo.id=r.id AND repo.installation_id=c.installation_id AND repo.github_repo_id=c.github_repository_id", "c")} AS "protectedReleaseIntentCandidatesDigest",
   ${bounded("public.protected_release_execution_seals seal JOIN public.protected_release_intent_candidates c ON c.id=seal.candidate_id JOIN owned_repositories r ON r.id=c.repository_id JOIN public.repositories repo ON repo.id=r.id AND repo.installation_id=c.installation_id AND repo.github_repo_id=c.github_repository_id AND seal.installation_id=c.installation_id AND seal.repository_id=c.repository_id AND seal.github_repository_id=c.github_repository_id AND seal.actor_github_user_id=c.actor_github_user_id AND seal.ref=c.ref AND seal.commit_sha=c.commit_sha AND seal.evidence_digest=c.evidence_digest AND seal.github_owner_id IS NOT DISTINCT FROM c.github_owner_id")} AS "protectedReleaseExecutionSeals",
   ${boundedRowDigest("public.protected_release_execution_seals seal JOIN public.protected_release_intent_candidates c ON c.id=seal.candidate_id JOIN owned_repositories r ON r.id=c.repository_id JOIN public.repositories repo ON repo.id=r.id AND repo.installation_id=c.installation_id AND repo.github_repo_id=c.github_repository_id AND seal.installation_id=c.installation_id AND seal.repository_id=c.repository_id AND seal.github_repository_id=c.github_repository_id AND seal.actor_github_user_id=c.actor_github_user_id AND seal.ref=c.ref AND seal.commit_sha=c.commit_sha AND seal.evidence_digest=c.evidence_digest AND seal.github_owner_id IS NOT DISTINCT FROM c.github_owner_id", "seal")} AS "protectedReleaseExecutionSealsDigest",
   ${bounded("public.signed_manufacturing_export_evidence e JOIN owned_runs run ON run.id=e.run_id JOIN public.repositories repo ON repo.id=run.repository_id AND e.repository_id=repo.id AND e.installation_id=repo.installation_id AND e.github_repository_id=repo.github_repo_id JOIN public.release_run_attempts a ON a.id=e.execution_attempt_id AND a.run_id=e.run_id JOIN public.artifacts artifact ON artifact.id=e.artifact_id AND artifact.run_id=e.run_id AND artifact.execution_attempt_id=e.execution_attempt_id")} AS "signedManufacturingExportEvidence",
   ${boundedRowDigest("public.signed_manufacturing_export_evidence e JOIN owned_runs run ON run.id=e.run_id JOIN public.repositories repo ON repo.id=run.repository_id AND e.repository_id=repo.id AND e.installation_id=repo.installation_id AND e.github_repository_id=repo.github_repo_id JOIN public.release_run_attempts a ON a.id=e.execution_attempt_id AND a.run_id=e.run_id JOIN public.artifacts artifact ON artifact.id=e.artifact_id AND artifact.run_id=e.run_id AND artifact.execution_attempt_id=e.execution_attempt_id", "e")} AS "signedManufacturingExportEvidenceDigest",
   ${bounded("eligible_manufacturing_shares")} AS "manufacturingShareAuthorizations",
   ${boundedRowDigest("eligible_manufacturing_shares eligible", "eligible")} AS "manufacturingShareAuthorizationsDigest",
   ${bounded("public.board_bom_snapshots s JOIN public.boards b ON b.id=s.board_id JOIN owned_repositories r ON r.id=b.repository_id JOIN public.release_runs run ON run.id=s.run_id AND run.repository_id<>b.repository_id")} AS "foreignBomRunMismatch",
   ${bounded("public.repository_firmware_snapshots s JOIN owned_repositories r ON r.id=s.repository_id JOIN public.release_runs run ON run.id=s.run_id AND run.repository_id<>s.repository_id")} AS "foreignFirmwareRunMismatch",
   ${bounded("public.run_pcb_footprint_summaries f JOIN owned_repositories r ON r.id=f.repository_id JOIN public.release_runs run ON run.id=f.run_id AND run.repository_id<>f.repository_id")} AS "foreignFootprintRunMismatch",
   ${bounded("public.release_run_results res JOIN owned_runs run ON run.id=res.run_id WHERE res.execution_attempt_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.release_run_attempts a WHERE a.id=res.execution_attempt_id AND a.run_id=res.run_id)")} AS "foreignResultAttemptMismatch",
   ${bounded("public.release_run_transition_events e JOIN owned_runs run ON run.id=e.release_run_id JOIN public.repositories repo ON repo.id=run.repository_id WHERE e.repository_id<>run.repository_id OR e.installation_id<>repo.installation_id OR (e.execution_attempt_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.release_run_attempts a WHERE a.id=e.execution_attempt_id AND a.run_id=e.release_run_id))")} AS "foreignTransitionScopeMismatch",
   ${bounded("public.protected_release_intent_candidates c JOIN owned_repositories r ON r.id=c.repository_id JOIN public.repositories repo ON repo.id=r.id WHERE c.installation_id<>repo.installation_id OR c.github_repository_id<>repo.github_repo_id")} AS "foreignProtectedIntentMismatch",
   ${bounded("public.protected_release_execution_seals seal JOIN public.protected_release_intent_candidates c ON c.id=seal.candidate_id JOIN owned_repositories r ON r.id=c.repository_id WHERE seal.installation_id IS DISTINCT FROM c.installation_id OR seal.repository_id IS DISTINCT FROM c.repository_id OR seal.github_repository_id IS DISTINCT FROM c.github_repository_id OR seal.actor_github_user_id IS DISTINCT FROM c.actor_github_user_id OR seal.ref IS DISTINCT FROM c.ref OR seal.commit_sha IS DISTINCT FROM c.commit_sha OR seal.evidence_digest IS DISTINCT FROM c.evidence_digest OR seal.github_owner_id IS DISTINCT FROM c.github_owner_id")} AS "foreignProtectedSealMismatch",
   ${bounded("public.signed_manufacturing_export_evidence e JOIN owned_runs run ON run.id=e.run_id JOIN public.repositories repo ON repo.id=run.repository_id WHERE e.repository_id IS DISTINCT FROM repo.id OR e.installation_id IS DISTINCT FROM repo.installation_id OR e.github_repository_id IS DISTINCT FROM repo.github_repo_id OR NOT EXISTS (SELECT 1 FROM public.release_run_attempts a WHERE a.id=e.execution_attempt_id AND a.run_id=e.run_id) OR NOT EXISTS (SELECT 1 FROM public.artifacts artifact WHERE artifact.id=e.artifact_id AND artifact.run_id=e.run_id AND artifact.execution_attempt_id=e.execution_attempt_id)")} AS "foreignSignedManufacturingMismatch",
   ${bounded("public.manufacturing_share_authorizations share WHERE (share.run_id IN (SELECT id FROM owned_runs) OR share.artifact_id IN (SELECT artifact.id FROM public.artifacts artifact JOIN owned_runs run ON run.id=artifact.run_id) OR (share.authorized_by_github_user_id=(SELECT original_github_user_id FROM owner_export) AND (share.run_id IS NULL OR share.artifact_id IS NULL))) AND NOT EXISTS (SELECT 1 FROM eligible_manufacturing_shares eligible WHERE eligible.revision_id=share.revision_id)")} AS "unattributableManufacturingShare"
   FROM owner_export
  WHERE EXISTS (SELECT 1 FROM former_installations)
  LIMIT 2`;

const hashPattern = /^[0-9a-f]{64}$/u;

function validBoundedCount(value: unknown, maximum = 100): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

/**
 * Strict internal diagnostic. A consistent catalog/row snapshot is not an
 * atomic cross-filesystem snapshot or independent permission to publish.
 * Every query requires a pending original-USER uninstall export, the exact
 * immutable GitHub numeric USER and its suspended installation(s); active
 * legal holds / real erasure block even a count. Wrong/ambiguous/oversized
 * SQL acknowledgements fail closed and return null (no partial results).
 */
export async function assessHistoricalUserHardwareOwnedRowCounts(
  db: Pick<PgQueryExecutor, "withTransaction">,
  input: { exportId: string; verifiedGitHubUserId: number },
): Promise<HistoricalUserHardwareOwnerCounts | null> {
  if (
    !db?.withTransaction ||
    !idIsUuid(input?.exportId) ||
    !Number.isSafeInteger(input?.verifiedGitHubUserId) ||
    input.verifiedGitHubUserId <= 0
  )
    return null;
  try {
    return await db.withTransaction(
      async (tx) => {
        const result: unknown = await tx.query(sql, [input.exportId, input.verifiedGitHubUserId]);
        if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) return null;
        const rows: unknown[] = result.rows;
        if (rows.length !== 1 || !rows[0] || typeof rows[0] !== "object" || Array.isArray(rows[0])) return null;
        const record = rows[0] as Record<string, unknown>;
        if (
          record.export_id !== input.exportId ||
          !validBoundedCount(record.foreignBomRunMismatch, 0) ||
          !validBoundedCount(record.foreignFirmwareRunMismatch, 0) ||
          !validBoundedCount(record.foreignFootprintRunMismatch, 0) ||
          !validBoundedCount(record.foreignResultAttemptMismatch, 0) ||
          !validBoundedCount(record.foreignTransitionScopeMismatch, 0) ||
          !validBoundedCount(record.foreignProtectedIntentMismatch, 0) ||
          !validBoundedCount(record.foreignProtectedSealMismatch, 0) ||
          !validBoundedCount(record.foreignSignedManufacturingMismatch, 0) ||
          !validBoundedCount(record.unattributableManufacturingShare, 0) ||
          !sourceNames.every(
            (name) =>
              validBoundedCount(record[name]) &&
              typeof record[`${name}Digest`] === "string" &&
              hashPattern.test(record[`${name}Digest`] as string),
          )
        )
          return null;

        const rowCounts = Object.fromEntries(sourceNames.map((name) => [name, record[name]])) as Record<
          HardwareSourceName,
          number
        >;
        const rowDigests = Object.fromEntries(sourceNames.map((name) => [name, record[`${name}Digest`]])) as Record<
          HardwareSourceName,
          string
        >;
        return {
          scope: "original-numeric-user-retained-suspended-installation-only",
          releaseDecision: "NO_GO",
          completeCustomerExport: false,
          customerDeliveryAllowed: false,
          sourceRightsVerified: false,
          thirdPartyDisclosureRightsVerified: false,
          rowCounts,
          rowDigests,
        };
      },
      { consistentRead: true, statementTimeoutMs: 5000 },
    );
  } catch {
    return null;
  }
}
