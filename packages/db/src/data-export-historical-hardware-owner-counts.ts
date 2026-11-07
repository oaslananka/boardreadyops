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
] as const;
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
  // All eighteen classes remain under independent provenance and IP review; manufacturing shares are withheld.
  sourceRightsVerified: false;
  thirdPartyDisclosureRightsVerified: false;
};

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
    SELECT run.id,run.repository_id
      FROM public.release_runs run
      JOIN owned_repositories r ON r.id=run.repository_id
  )
  SELECT owner_export.id AS export_id,
   ${bounded("public.boards b JOIN owned_repositories r ON r.id=b.repository_id")} AS "boards",
   ${bounded("public.board_bom_snapshots s JOIN public.boards b ON b.id=s.board_id JOIN owned_repositories r ON r.id=b.repository_id JOIN owned_runs run ON run.id=s.run_id AND run.repository_id=b.repository_id")} AS "boardBomSnapshots",
   ${bounded("public.board_bom_components c JOIN public.board_bom_snapshots s ON s.id=c.snapshot_id JOIN public.boards b ON b.id=s.board_id JOIN owned_repositories r ON r.id=b.repository_id JOIN owned_runs run ON run.id=s.run_id AND run.repository_id=b.repository_id")} AS "boardBomComponents",
   ${bounded("public.repository_firmware_snapshots s JOIN owned_repositories r ON r.id=s.repository_id JOIN owned_runs run ON run.id=s.run_id AND run.repository_id=s.repository_id")} AS "firmwareSnapshots",
   ${bounded("public.repository_firmware_dependencies d JOIN public.repository_firmware_snapshots s ON s.id=d.snapshot_id JOIN owned_repositories r ON r.id=s.repository_id JOIN owned_runs run ON run.id=s.run_id AND run.repository_id=s.repository_id")} AS "firmwareDependencies",
   ${bounded("public.repository_firmware_advisory_watch w JOIN owned_repositories r ON r.id=w.repository_id")} AS "firmwareAdvisoryWatch",
   ${bounded("public.run_pcb_footprint_summaries f JOIN owned_repositories r ON r.id=f.repository_id JOIN owned_runs run ON run.id=f.run_id AND run.repository_id=f.repository_id")} AS "runPcbFootprintSummaries",
   ${bounded("public.board_supply_watch w JOIN public.boards b ON b.id=w.board_id JOIN owned_repositories r ON r.id=b.repository_id")} AS "boardSupplyWatch",
   ${bounded("public.board_supply_findings f JOIN public.boards b ON b.id=f.board_id JOIN owned_repositories r ON r.id=b.repository_id")} AS "boardSupplyFindings",
   ${bounded("public.production_batches b JOIN owned_runs run ON run.id=b.release_run_id")} AS "productionBatches",
   ${bounded("public.production_batch_defects d JOIN public.production_batches b ON b.id=d.production_batch_id JOIN owned_runs run ON run.id=b.release_run_id")} AS "productionBatchDefects",
   ${bounded("public.release_run_attempts a JOIN owned_runs run ON run.id=a.run_id")} AS "releaseRunAttempts",
   ${bounded("public.release_run_results res JOIN owned_runs run ON run.id=res.run_id")} AS "releaseRunResults",
   ${bounded("public.release_run_transition_events e JOIN owned_runs run ON run.id=e.release_run_id JOIN public.repositories repo ON repo.id=run.repository_id AND e.repository_id=repo.id AND e.installation_id=repo.installation_id")} AS "releaseRunTransitionEvents",
   ${bounded("public.supply_finding_suppressions sup JOIN public.board_supply_findings f ON f.id=sup.finding_id JOIN public.boards b ON b.id=f.board_id JOIN owned_repositories r ON r.id=b.repository_id")} AS "supplyFindingSuppressions",
   ${bounded("public.protected_release_intent_candidates c JOIN owned_repositories r ON r.id=c.repository_id JOIN public.repositories repo ON repo.id=r.id AND repo.installation_id=c.installation_id AND repo.github_repo_id=c.github_repository_id")} AS "protectedReleaseIntentCandidates",
   ${bounded("public.protected_release_execution_seals seal JOIN public.protected_release_intent_candidates c ON c.id=seal.candidate_id JOIN owned_repositories r ON r.id=c.repository_id JOIN public.repositories repo ON repo.id=r.id AND repo.installation_id=c.installation_id AND repo.github_repo_id=c.github_repository_id AND seal.installation_id=c.installation_id AND seal.repository_id=c.repository_id AND seal.github_repository_id=c.github_repository_id AND seal.actor_github_user_id=c.actor_github_user_id AND seal.ref=c.ref AND seal.commit_sha=c.commit_sha AND seal.evidence_digest=c.evidence_digest AND seal.github_owner_id IS NOT DISTINCT FROM c.github_owner_id")} AS "protectedReleaseExecutionSeals",
   ${bounded("public.signed_manufacturing_export_evidence e JOIN owned_runs run ON run.id=e.run_id JOIN public.repositories repo ON repo.id=run.repository_id AND e.repository_id=repo.id AND e.installation_id=repo.installation_id AND e.github_repository_id=repo.github_repo_id JOIN public.release_run_attempts a ON a.id=e.execution_attempt_id AND a.run_id=e.run_id JOIN public.artifacts artifact ON artifact.id=e.artifact_id AND artifact.run_id=e.run_id AND artifact.execution_attempt_id=e.execution_attempt_id")} AS "signedManufacturingExportEvidence",
   ${bounded("public.board_bom_snapshots s JOIN public.boards b ON b.id=s.board_id JOIN owned_repositories r ON r.id=b.repository_id JOIN public.release_runs run ON run.id=s.run_id AND run.repository_id<>b.repository_id")} AS "foreignBomRunMismatch",
   ${bounded("public.repository_firmware_snapshots s JOIN owned_repositories r ON r.id=s.repository_id JOIN public.release_runs run ON run.id=s.run_id AND run.repository_id<>s.repository_id")} AS "foreignFirmwareRunMismatch",
   ${bounded("public.run_pcb_footprint_summaries f JOIN owned_repositories r ON r.id=f.repository_id JOIN public.release_runs run ON run.id=f.run_id AND run.repository_id<>f.repository_id")} AS "foreignFootprintRunMismatch",
   ${bounded("public.release_run_results res JOIN owned_runs run ON run.id=res.run_id WHERE res.execution_attempt_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.release_run_attempts a WHERE a.id=res.execution_attempt_id AND a.run_id=res.run_id)")} AS "foreignResultAttemptMismatch",
   ${bounded("public.release_run_transition_events e JOIN owned_runs run ON run.id=e.release_run_id JOIN public.repositories repo ON repo.id=run.repository_id WHERE e.repository_id<>run.repository_id OR e.installation_id<>repo.installation_id OR (e.execution_attempt_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.release_run_attempts a WHERE a.id=e.execution_attempt_id AND a.run_id=e.release_run_id))")} AS "foreignTransitionScopeMismatch",
   ${bounded("public.protected_release_intent_candidates c JOIN owned_repositories r ON r.id=c.repository_id JOIN public.repositories repo ON repo.id=r.id WHERE c.installation_id<>repo.installation_id OR c.github_repository_id<>repo.github_repo_id")} AS "foreignProtectedIntentMismatch",
   ${bounded("public.protected_release_execution_seals seal JOIN public.protected_release_intent_candidates c ON c.id=seal.candidate_id JOIN owned_repositories r ON r.id=c.repository_id WHERE seal.installation_id IS DISTINCT FROM c.installation_id OR seal.repository_id IS DISTINCT FROM c.repository_id OR seal.github_repository_id IS DISTINCT FROM c.github_repository_id OR seal.actor_github_user_id IS DISTINCT FROM c.actor_github_user_id OR seal.ref IS DISTINCT FROM c.ref OR seal.commit_sha IS DISTINCT FROM c.commit_sha OR seal.evidence_digest IS DISTINCT FROM c.evidence_digest OR seal.github_owner_id IS DISTINCT FROM c.github_owner_id")} AS "foreignProtectedSealMismatch",
   ${bounded("public.signed_manufacturing_export_evidence e JOIN owned_runs run ON run.id=e.run_id JOIN public.repositories repo ON repo.id=run.repository_id WHERE e.repository_id IS DISTINCT FROM repo.id OR e.installation_id IS DISTINCT FROM repo.installation_id OR e.github_repository_id IS DISTINCT FROM repo.github_repo_id OR NOT EXISTS (SELECT 1 FROM public.release_run_attempts a WHERE a.id=e.execution_attempt_id AND a.run_id=e.run_id) OR NOT EXISTS (SELECT 1 FROM public.artifacts artifact WHERE artifact.id=e.artifact_id AND artifact.run_id=e.run_id AND artifact.execution_attempt_id=e.execution_attempt_id)")} AS "foreignSignedManufacturingMismatch"
   FROM owner_export
  WHERE EXISTS (SELECT 1 FROM former_installations)
  LIMIT 2`;

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
          !sourceNames.every((name) => validBoundedCount(record[name]))
        )
          return null;

        const rowCounts = Object.fromEntries(sourceNames.map((name) => [name, record[name]])) as Record<
          HardwareSourceName,
          number
        >;
        return {
          scope: "original-numeric-user-retained-suspended-installation-only",
          releaseDecision: "NO_GO",
          completeCustomerExport: false,
          customerDeliveryAllowed: false,
          sourceRightsVerified: false,
          thirdPartyDisclosureRightsVerified: false,
          rowCounts,
        };
      },
      { consistentRead: true, statementTimeoutMs: 5000 },
    );
  } catch {
    return null;
  }
}
