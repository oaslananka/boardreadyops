import type { Stats } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ArtifactObjectDeletionError,
  deleteLocalArtifactObject,
  type LocalArtifactFilesystem,
  processArtifactDeletion,
} from "../../../apps/web/lib/artifact-deletion-worker.js";
import type {
  ArtifactDeletionStore,
  ClaimedArtifactDeletion,
} from "../../../packages/db/src/artifact-deletion-store.js";

const roots: string[] = [];

async function storageRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "boardreadyops-artifact-delete-"));
  roots.push(root);
  return root;
}

const job: ClaimedArtifactDeletion = {
  deletionJobId: "job-1",
  artifactId: "artifact-1",
  installationId: "installation-1",
  repositoryId: "repository-1",
  releaseRunId: "run-1",
  storageDriver: "local",
  storagePath: "run-1/artifact-1.bin",
  deletionReason: "result_replaced",
  attemptCount: 1,
};

function store(): ArtifactDeletionStore {
  return {
    claimDeletions: vi.fn(),
    completeDeletion: vi.fn(async () => "completed" as const),
    failDeletion: vi.fn(async () => "retry" as const),
    collectMetrics: vi.fn(),
  };
}

function filesystem(overrides: Partial<LocalArtifactFilesystem> = {}): LocalArtifactFilesystem {
  return { lstat, realpath, unlink, ...overrides };
}

function filesystemError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`filesystem ${code}`), { code });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("artifact deletion worker", () => {
  it("deletes a regular object inside the configured root", async () => {
    const root = await storageRoot();
    await mkdir(path.join(root, "run-1"));
    const target = path.join(root, job.storagePath);
    await writeFile(target, "evidence");

    await expect(deleteLocalArtifactObject(root, job.storagePath)).resolves.toBe("deleted");
    await expect(readFile(target)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("treats a missing object as idempotent success", async () => {
    const root = await storageRoot();
    await mkdir(path.join(root, "run-1"));

    await expect(deleteLocalArtifactObject(root, job.storagePath)).resolves.toBe("missing");
  });

  it("rejects paths outside the configured root permanently", async () => {
    const root = await storageRoot();

    await expect(deleteLocalArtifactObject(root, "../escape.bin")).rejects.toMatchObject({
      name: "ArtifactObjectDeletionError",
      retryable: false,
    });
  });

  it("classifies an unavailable storage root as retryable", async () => {
    const root = path.join(tmpdir(), "boardreadyops-missing-artifact-root");
    const localFilesystem = filesystem({
      realpath: vi.fn(async () => {
        throw filesystemError("EIO");
      }),
    });

    await expect(deleteLocalArtifactObject(root, job.storagePath, localFilesystem)).rejects.toMatchObject({
      name: "ArtifactObjectDeletionError",
      message: "artifact storage root is unavailable",
      retryable: true,
      cause: expect.objectContaining({ code: "EIO" }),
    });
  });

  it("treats a missing parent directory as idempotent success", async () => {
    const root = await storageRoot();

    await expect(deleteLocalArtifactObject(root, job.storagePath)).resolves.toBe("missing");
  });

  it("classifies an unreadable parent directory as retryable", async () => {
    const root = await storageRoot();
    const resolvedRoot = await realpath(root);
    const localFilesystem = filesystem({
      realpath: vi.fn(async (target) => {
        if (target === path.resolve(root)) return resolvedRoot;
        throw filesystemError("EACCES");
      }),
    });

    await expect(deleteLocalArtifactObject(root, job.storagePath, localFilesystem)).rejects.toMatchObject({
      message: "artifact object parent is unavailable",
      retryable: true,
      cause: expect.objectContaining({ code: "EACCES" }),
    });
  });

  it("rejects a parent directory that resolves outside the storage root", async () => {
    const root = await storageRoot();
    const resolvedRoot = await realpath(root);
    const localFilesystem = filesystem({
      realpath: vi.fn(async (target) => (target === path.resolve(root) ? resolvedRoot : path.resolve(tmpdir()))),
    });

    await expect(deleteLocalArtifactObject(root, job.storagePath, localFilesystem)).rejects.toMatchObject({
      message: "artifact object parent resolves outside the storage root",
      retryable: false,
    });
  });

  it("classifies unavailable artifact metadata as retryable", async () => {
    const root = await storageRoot();
    await mkdir(path.join(root, "run-1"));
    const localFilesystem = filesystem({
      lstat: vi.fn(async () => {
        throw filesystemError("EACCES");
      }),
    });

    await expect(deleteLocalArtifactObject(root, job.storagePath, localFilesystem)).rejects.toMatchObject({
      message: "artifact object metadata is unavailable",
      retryable: true,
      cause: expect.objectContaining({ code: "EACCES" }),
    });
  });

  it("rejects directory deletion targets permanently", async () => {
    const root = await storageRoot();
    await mkdir(path.join(root, job.storagePath), { recursive: true });

    await expect(deleteLocalArtifactObject(root, job.storagePath)).rejects.toMatchObject({
      message: "artifact deletion target is not a file",
      retryable: false,
    });
  });

  it("treats an object removed before realpath as idempotent success", async () => {
    const root = await storageRoot();
    await mkdir(path.join(root, "run-1"));
    const target = path.join(root, job.storagePath);
    await writeFile(target, "evidence");
    const localFilesystem = filesystem({
      realpath: vi.fn(async (candidate) => {
        if (candidate === target) throw filesystemError("ENOENT");
        return realpath(candidate);
      }),
    });

    await expect(deleteLocalArtifactObject(root, job.storagePath, localFilesystem)).resolves.toBe("missing");
  });

  it("classifies an unresolvable artifact path as retryable", async () => {
    const root = await storageRoot();
    await mkdir(path.join(root, "run-1"));
    const target = path.join(root, job.storagePath);
    await writeFile(target, "evidence");
    const localFilesystem = filesystem({
      realpath: vi.fn(async (candidate) => {
        if (candidate === target) throw filesystemError("EIO");
        return realpath(candidate);
      }),
    });

    await expect(deleteLocalArtifactObject(root, job.storagePath, localFilesystem)).rejects.toMatchObject({
      message: "artifact object path cannot be resolved",
      retryable: true,
      cause: expect.objectContaining({ code: "EIO" }),
    });
  });

  it("rejects an artifact object that resolves outside the storage root", async () => {
    const root = await storageRoot();
    await mkdir(path.join(root, "run-1"));
    const target = path.join(root, job.storagePath);
    await writeFile(target, "evidence");
    const localFilesystem = filesystem({
      realpath: vi.fn(async (candidate) =>
        candidate === target ? path.join(tmpdir(), "escaped.bin") : realpath(candidate),
      ),
    });

    await expect(deleteLocalArtifactObject(root, job.storagePath, localFilesystem)).rejects.toMatchObject({
      message: "artifact object resolves outside the storage root",
      retryable: false,
    });
  });

  it("unlinks symbolic-link entries without resolving their targets", async () => {
    const root = await storageRoot();
    await mkdir(path.join(root, "run-1"));
    const target = path.join(root, job.storagePath);
    await writeFile(target, "link-entry");
    const localFilesystem = filesystem({
      lstat: vi.fn(async () => ({ isDirectory: () => false, isSymbolicLink: () => true }) as Stats),
      realpath: vi.fn(async (candidate) => {
        if (candidate === target) throw new Error("symbolic-link target must not be resolved");
        return realpath(candidate);
      }),
    });

    await expect(deleteLocalArtifactObject(root, job.storagePath, localFilesystem)).resolves.toBe("deleted");
    await expect(readFile(target)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("treats an object removed before unlink as idempotent success", async () => {
    const root = await storageRoot();
    await mkdir(path.join(root, "run-1"));
    const target = path.join(root, job.storagePath);
    await writeFile(target, "evidence");
    const localFilesystem = filesystem({
      unlink: vi.fn(async () => {
        throw filesystemError("ENOENT");
      }),
    });

    await expect(deleteLocalArtifactObject(root, job.storagePath, localFilesystem)).resolves.toBe("missing");
  });

  it("classifies unlink failures as retryable", async () => {
    const root = await storageRoot();
    await mkdir(path.join(root, "run-1"));
    const target = path.join(root, job.storagePath);
    await writeFile(target, "evidence");
    const localFilesystem = filesystem({
      unlink: vi.fn(async () => {
        throw filesystemError("EIO");
      }),
    });

    await expect(deleteLocalArtifactObject(root, job.storagePath, localFilesystem)).rejects.toMatchObject({
      message: "artifact object could not be deleted",
      retryable: true,
      cause: expect.objectContaining({ code: "EIO" }),
    });
  });

  it("constructs permanent deletion errors without an implicit cause", () => {
    const error = new ArtifactObjectDeletionError("unsafe", { retryable: false });

    expect(error).toMatchObject({ name: "ArtifactObjectDeletionError", message: "unsafe", retryable: false });
    expect(error.cause).toBeUndefined();
  });

  it("persists completion without exposing the storage path", async () => {
    const deletionStore = store();
    const deleteLocalObject = vi.fn(async () => "deleted" as const);

    await expect(
      processArtifactDeletion(job, {
        workerId: "worker-1",
        storageRoot: "/data/artifacts",
        store: deletionStore,
        deleteLocalObject,
      }),
    ).resolves.toEqual({ deletionJobId: "job-1", artifactId: "artifact-1", status: "completed", outcome: "deleted" });
    expect(deletionStore.completeDeletion).toHaveBeenCalledWith({
      deletionJobId: "job-1",
      workerId: "worker-1",
      outcome: "deleted",
    });
  });

  it("retries a local deletion when the storage root is not configured", async () => {
    const deletionStore = store();
    const deleteLocalObject = vi.fn();

    await expect(
      processArtifactDeletion(job, {
        workerId: "worker-1",
        store: deletionStore,
        deleteLocalObject,
      }),
    ).resolves.toMatchObject({ status: "retry" });
    expect(deleteLocalObject).not.toHaveBeenCalled();
    expect(deletionStore.failDeletion).toHaveBeenCalledWith(
      expect.objectContaining({
        retryable: true,
        errorClass: "missing_storage_root",
        errorMessage: "Artifact deletion requires the configured local storage root.",
      }),
    );
  });

  it("dead-letters permanent path failures", async () => {
    const deletionStore = store();
    vi.mocked(deletionStore.failDeletion).mockResolvedValue("dead_letter");

    await expect(
      processArtifactDeletion(job, {
        workerId: "worker-1",
        storageRoot: "/data/artifacts",
        store: deletionStore,
        deleteLocalObject: async () => {
          throw new ArtifactObjectDeletionError("outside", { retryable: false });
        },
      }),
    ).resolves.toMatchObject({ status: "dead_letter" });
    expect(deletionStore.failDeletion).toHaveBeenCalledWith(
      expect.objectContaining({
        retryable: false,
        errorMessage: "Artifact object deletion did not reach a terminal state.",
      }),
    );
  });

  it("uses the local filesystem implementation and preserves stale completion", async () => {
    const root = await storageRoot();
    await mkdir(path.join(root, "run-1"));
    await writeFile(path.join(root, job.storagePath), "evidence");
    const deletionStore = store();
    vi.mocked(deletionStore.completeDeletion).mockResolvedValue("stale");

    await expect(
      processArtifactDeletion(job, { workerId: "worker-1", storageRoot: root, store: deletionStore }),
    ).resolves.toEqual({ deletionJobId: "job-1", artifactId: "artifact-1", status: "stale" });
  });

  it("retries generic and non-Error deletion failures without leaking messages", async () => {
    const genericStore = store();
    await processArtifactDeletion(job, {
      workerId: "worker-1",
      storageRoot: "/data/artifacts",
      store: genericStore,
      deleteLocalObject: async () => {
        throw new Error("sensitive path detail");
      },
    });
    expect(genericStore.failDeletion).toHaveBeenCalledWith(
      expect.objectContaining({
        retryable: true,
        errorClass: "Error",
        errorMessage: "Artifact object deletion did not reach a terminal state.",
      }),
    );

    const unknownStore = store();
    await processArtifactDeletion(job, {
      workerId: "worker-1",
      storageRoot: "/data/artifacts",
      store: unknownStore,
      deleteLocalObject: async () => {
        throw "non-error failure";
      },
    });
    expect(unknownStore.failDeletion).toHaveBeenCalledWith(
      expect.objectContaining({ retryable: true, errorClass: "UnknownError" }),
    );
  });

  it("dead-letters unsupported storage drivers without touching an object", async () => {
    const deletionStore = store();
    vi.mocked(deletionStore.failDeletion).mockResolvedValue("dead_letter");
    const deleteLocalObject = vi.fn();

    await expect(
      processArtifactDeletion(
        { ...job, storageDriver: "object-store" },
        { workerId: "worker-1", storageRoot: "/data/artifacts", store: deletionStore, deleteLocalObject },
      ),
    ).resolves.toMatchObject({ status: "dead_letter" });
    expect(deleteLocalObject).not.toHaveBeenCalled();
  });
});
