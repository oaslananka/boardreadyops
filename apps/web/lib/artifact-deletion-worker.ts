import type { Stats } from "node:fs";
import { lstat, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import type { ArtifactDeletionStore, ClaimedArtifactDeletion } from "@boardreadyops/db/artifact-deletion-store";
import { safeLocalArtifactPath } from "./artifact-downloads.js";

export type ArtifactObjectDeletionOutcome = "deleted" | "missing";

export type LocalArtifactFilesystem = {
  lstat(target: string): Promise<Stats>;
  realpath(target: string): Promise<string>;
  unlink(target: string): Promise<void>;
};

const nodeArtifactFilesystem: LocalArtifactFilesystem = { lstat, realpath, unlink };

export class ArtifactObjectDeletionError extends Error {
  readonly retryable: boolean;

  constructor(message: string, options: { retryable: boolean; cause?: unknown }) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ArtifactObjectDeletionError";
    this.retryable = options.retryable;
  }
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

async function resolveStorageRoot(storageRoot: string, filesystem: LocalArtifactFilesystem): Promise<string> {
  try {
    return await filesystem.realpath(path.resolve(storageRoot));
  } catch (error) {
    throw new ArtifactObjectDeletionError("artifact storage root is unavailable", { retryable: true, cause: error });
  }
}

async function resolveArtifactParent(
  lexicalPath: string,
  filesystem: LocalArtifactFilesystem,
): Promise<string | undefined> {
  try {
    return await filesystem.realpath(path.dirname(lexicalPath));
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw new ArtifactObjectDeletionError("artifact object parent is unavailable", { retryable: true, cause: error });
  }
}

async function readArtifactStat(lexicalPath: string, filesystem: LocalArtifactFilesystem): Promise<Stats | undefined> {
  try {
    return await filesystem.lstat(lexicalPath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw new ArtifactObjectDeletionError("artifact object metadata is unavailable", { retryable: true, cause: error });
  }
}

async function resolveArtifactObject(
  lexicalPath: string,
  filesystem: LocalArtifactFilesystem,
): Promise<string | undefined> {
  try {
    return await filesystem.realpath(lexicalPath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw new ArtifactObjectDeletionError("artifact object path cannot be resolved", { retryable: true, cause: error });
  }
}

function assertInsideStorageRoot(root: string, candidate: string, message: string): void {
  if (!isInside(root, candidate)) {
    throw new ArtifactObjectDeletionError(message, { retryable: false });
  }
}

async function unlinkArtifactObject(
  lexicalPath: string,
  filesystem: LocalArtifactFilesystem,
): Promise<ArtifactObjectDeletionOutcome> {
  try {
    await filesystem.unlink(lexicalPath);
    return "deleted";
  } catch (error) {
    if (errorCode(error) === "ENOENT") return "missing";
    throw new ArtifactObjectDeletionError("artifact object could not be deleted", { retryable: true, cause: error });
  }
}

export async function deleteLocalArtifactObject(
  storageRoot: string,
  storagePath: string,
  filesystem: LocalArtifactFilesystem = nodeArtifactFilesystem,
): Promise<ArtifactObjectDeletionOutcome> {
  const lexicalPath = safeLocalArtifactPath(storageRoot, storagePath);
  if (!lexicalPath) {
    throw new ArtifactObjectDeletionError("artifact object path is outside the configured storage root", {
      retryable: false,
    });
  }

  const resolvedRoot = await resolveStorageRoot(storageRoot, filesystem);
  const resolvedParent = await resolveArtifactParent(lexicalPath, filesystem);
  if (!resolvedParent) return "missing";
  assertInsideStorageRoot(resolvedRoot, resolvedParent, "artifact object parent resolves outside the storage root");

  const fileStat = await readArtifactStat(lexicalPath, filesystem);
  if (!fileStat) return "missing";
  if (fileStat.isDirectory()) {
    throw new ArtifactObjectDeletionError("artifact deletion target is not a file", { retryable: false });
  }

  if (!fileStat.isSymbolicLink()) {
    const resolvedObject = await resolveArtifactObject(lexicalPath, filesystem);
    if (!resolvedObject) return "missing";
    assertInsideStorageRoot(resolvedRoot, resolvedObject, "artifact object resolves outside the storage root");
  }

  return unlinkArtifactObject(lexicalPath, filesystem);
}

export type ArtifactDeletionWorkerDependencies = {
  workerId: string;
  storageRoot?: string;
  store: ArtifactDeletionStore;
  deleteLocalObject?: (storageRoot: string, storagePath: string) => Promise<ArtifactObjectDeletionOutcome>;
};

export type ArtifactDeletionWorkerResult = {
  deletionJobId: string;
  artifactId: string;
  status: "completed" | "dead_letter" | "retry" | "stale";
  outcome?: ArtifactObjectDeletionOutcome;
};

export async function processArtifactDeletion(
  job: ClaimedArtifactDeletion,
  dependencies: ArtifactDeletionWorkerDependencies,
): Promise<ArtifactDeletionWorkerResult> {
  const base = { deletionJobId: job.deletionJobId, artifactId: job.artifactId };
  if (job.storageDriver !== "local") {
    const status = await dependencies.store.failDeletion({
      deletionJobId: job.deletionJobId,
      workerId: dependencies.workerId,
      attemptCount: job.attemptCount,
      retryable: false,
      errorClass: "unsupported_storage_driver",
      errorMessage: "Artifact deletion requires a supported storage driver.",
    });
    return { ...base, status };
  }

  if (!dependencies.storageRoot) {
    const status = await dependencies.store.failDeletion({
      deletionJobId: job.deletionJobId,
      workerId: dependencies.workerId,
      attemptCount: job.attemptCount,
      retryable: true,
      errorClass: "missing_storage_root",
      errorMessage: "Artifact deletion requires the configured local storage root.",
    });
    return { ...base, status };
  }

  try {
    const outcome = await (dependencies.deleteLocalObject ?? deleteLocalArtifactObject)(
      dependencies.storageRoot,
      job.storagePath,
    );
    const status = await dependencies.store.completeDeletion({
      deletionJobId: job.deletionJobId,
      workerId: dependencies.workerId,
      outcome,
    });
    return { ...base, status, ...(status === "completed" ? { outcome } : {}) };
  } catch (error) {
    const retryable = error instanceof ArtifactObjectDeletionError ? error.retryable : true;
    const status = await dependencies.store.failDeletion({
      deletionJobId: job.deletionJobId,
      workerId: dependencies.workerId,
      attemptCount: job.attemptCount,
      retryable,
      errorClass: error instanceof Error ? error.name : "UnknownError",
      errorMessage: "Artifact object deletion did not reach a terminal state.",
    });
    return { ...base, status };
  }
}
