import { DataExportPreparationStore } from "../../../packages/db/src/data-export-preparation-store.js";
import type { PgQueryExecutor } from "../../../packages/db/src/pg-executor.js";
import { stageClaimedDurableLocalArchiveCommitment } from "./data-export-local-archive.js";
import { ensurePrivateLocalExportArchiveDirectory } from "./data-export-local-archive-storage.js";

type ArchiveDb = Pick<PgQueryExecutor, "query" | "withTransaction">;

export type ExportArchivePreparationOutcome = "disabled" | "invalid_storage" | "idle" | "staged" | "quarantined";

/**
 * Single opt-in bounded worker pass for one installation. Only a valid private
 * archive directory may be provisioned before acquiring the SKIP LOCKED claim.
 * A failed attempt remains quarantined, never automatically re-claimed.
 */
export async function runOptInExportArchivePreparationPass(input: {
  db: ArchiveDb;
  installationId?: string | undefined;
  workerId: string;
  storageDriver: string;
  storageRoot?: string | undefined;
  privateArchiveRoot?: string | undefined;
}): Promise<ExportArchivePreparationOutcome> {
  if (!input.installationId && !input.privateArchiveRoot) return "disabled";
  if (
    !input.installationId ||
    !input.privateArchiveRoot ||
    !input.storageRoot ||
    input.storageDriver !== "local" ||
    !input.db
  )
    return "invalid_storage";
  const storageReady = await ensurePrivateLocalExportArchiveDirectory({
    storageRoot: input.storageRoot,
    privateArchiveRoot: input.privateArchiveRoot,
  });
  if (!storageReady) return "invalid_storage";
  const claim = await new DataExportPreparationStore(input.db).claimNext({
    installationId: input.installationId,
    workerId: input.workerId,
  });
  if (!claim) return "idle";
  try {
    const staged = await stageClaimedDurableLocalArchiveCommitment({
      db: input.db,
      claim,
      storageDriver: input.storageDriver,
      storageRoot: input.storageRoot,
      privateArchiveRoot: input.privateArchiveRoot,
    });
    return staged ? "staged" : "quarantined";
  } catch {
    // A failed claim remains reserved for explicit inspection, not auto-retry.
    return "quarantined";
  }
}
