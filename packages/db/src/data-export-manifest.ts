import { createHash } from "node:crypto";
import type { DataExportInventoryStore, PendingExportInventory } from "./data-export-inventory.js";

/** This is an in-memory preparation artifact, never an automatically published export. */
export type PreparedExportManifest = {
  contentType: "application/json";
  bytes: Buffer;
  byteLength: number;
  sha256: string;
};

export class ExportManifestPreparationError extends Error {
  constructor() {
    super("This export cannot be safely prepared as a bounded repository metadata manifest.");
    this.name = "ExportManifestPreparationError";
  }
}

const maxRepositoryCount = 100;
const maxManifestBytes = 64 * 1024;
const textIdentifier = (value: unknown, max = 128): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max && value.trim() === value;

const exclusions = [
  "source-code",
  "finding-content",
  "artifact-contents",
  "storage-paths",
  "secrets",
  "external-github-data",
  "backups-and-platform-logs",
] as const;

/**
 * Deterministic only for the same inventory snapshot: a later database read may
 * differ. The output is NOT a completed customer export or a download capability.
 */
export function buildPendingExportManifest(inventory: PendingExportInventory): PreparedExportManifest {
  if (
    inventory.formatVersion !== 1 ||
    inventory.coverage !== "selected-installation-repositories-only" ||
    !textIdentifier(inventory.exportId) ||
    !textIdentifier(inventory.tenantId) ||
    (inventory.scope !== "organization" && inventory.scope !== "repository") ||
    (inventory.scope === "organization" && inventory.scopeId !== null) ||
    (inventory.scope === "repository" && !textIdentifier(inventory.scopeId)) ||
    !Array.isArray(inventory.repositories) ||
    inventory.repositories.length > maxRepositoryCount
  ) {
    throw new ExportManifestPreparationError();
  }

  const seenIds = new Set<string>();
  const seenGithubIds = new Set<string>();
  const repositories = inventory.repositories.map((row) => {
    if (
      !row ||
      !textIdentifier(row.repositoryId) ||
      !textIdentifier(row.githubRepositoryId, 20) ||
      !/^\d+$/u.test(row.githubRepositoryId) ||
      !textIdentifier(row.owner, 256) ||
      !textIdentifier(row.name, 1024) ||
      typeof row.private !== "boolean" ||
      typeof row.disabled !== "boolean" ||
      seenIds.has(row.repositoryId) ||
      seenGithubIds.has(row.githubRepositoryId)
    ) {
      throw new ExportManifestPreparationError();
    }
    seenIds.add(row.repositoryId);
    seenGithubIds.add(row.githubRepositoryId);
    // Construct an allowlisted object. Never spread raw database rows into an export.
    return {
      repositoryId: row.repositoryId,
      githubRepositoryId: row.githubRepositoryId,
      owner: row.owner,
      name: row.name,
      private: row.private,
      disabled: row.disabled,
    };
  });

  if (
    inventory.scope === "repository" &&
    (repositories.length !== 1 || repositories[0]?.repositoryId !== inventory.scopeId)
  ) {
    throw new ExportManifestPreparationError();
  }

  repositories.sort((a, b) => {
    if (a.repositoryId < b.repositoryId) return -1;
    if (a.repositoryId > b.repositoryId) return 1;
    return 0;
  });
  const bytes = Buffer.from(
    `${JSON.stringify({
      formatVersion: 1,
      kind: "boardreadyops.repository-metadata-export",
      coverage: "selected-installation-repositories-only",
      exportId: inventory.exportId,
      tenantId: inventory.tenantId,
      scope: inventory.scope,
      scopeId: inventory.scopeId,
      exclusions,
      repositories,
    })}\n`,
    "utf8",
  );
  if (bytes.byteLength > maxManifestBytes) throw new ExportManifestPreparationError();

  return {
    contentType: "application/json",
    bytes,
    byteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

/**
 * Read-only, actor-authorized caller preflight; the store independently rejects
 * cross-installation and non-pending requests. No claim, DB write or delivery.
 */
export async function preparePendingExportManifest(
  store: Pick<DataExportInventoryStore, "previewPendingExport">,
  input: { exportId: string; tenantId: string; installationId: string },
): Promise<PreparedExportManifest | null> {
  const inventory = await store.previewPendingExport(input);
  return inventory ? buildPendingExportManifest(inventory) : null;
}

/**
 * Prepare an in-memory snapshot only for the current unexpired reservation.
 * Expiry, lost ownership or a suspended installation returns null, never bytes.
 * Callers must NOT publish a download or mark status completed from this alone.
 */
export async function prepareClaimedExportManifest(
  store: Pick<DataExportInventoryStore, "previewClaimedExport">,
  input: { exportId: string; tenantId: string; installationId: string; workerId: string; token: string },
): Promise<PreparedExportManifest | null> {
  const inventory = await store.previewClaimedExport(input);
  return inventory ? buildPendingExportManifest(inventory) : null;
}
