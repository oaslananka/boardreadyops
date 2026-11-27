import { lstat, mkdir, mkdtemp, open, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RunnerClaimedJob } from "../../packages/contracts/src/index.js";
import { assertRunnerWorkspaceDirectories } from "./source.js";
import { readVerifiedRunnerArtifact } from "./verified-artifact.js";

type CustomerRunnerArtifact = {
  kind: string;
  name: string;
  role: string;
  filePath: string;
  bytes: number;
  sha256: string;
};

const maximumLocalArtifactBytes = 64 * 1024 * 1024;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function inside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function privateDirectory(directory: string): Promise<void> {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("customer artifact directory is not a regular directory");
  }
  if (process.platform !== "win32" && (info.mode & 0o077) !== 0) {
    throw new Error("customer artifact directory must not be accessible by group or others");
  }
}

type StagedArtifact = Omit<CustomerRunnerArtifact, "filePath"> & { filename: string };

async function stageArtifact(
  workspace: string,
  staging: string,
  artifact: CustomerRunnerArtifact,
  index: number,
): Promise<StagedArtifact> {
  const realSource = await realpath(artifact.filePath);
  if (!inside(workspace, realSource)) throw new Error("runner artifact escaped the source workspace");
  const content = await readVerifiedRunnerArtifact(
    artifact.filePath,
    artifact.bytes,
    artifact.sha256,
    maximumLocalArtifactBytes,
  );
  const filename = `artifact-${String(index + 1).padStart(3, "0")}.bin`;
  try {
    await writeFile(path.join(staging, filename), content, { flag: "wx", mode: 0o600 });
  } finally {
    content.fill(0);
  }
  return {
    filename,
    kind: artifact.kind,
    name: artifact.name,
    role: artifact.role,
    bytes: artifact.bytes,
    sha256: artifact.sha256,
  };
}

/**
 * Keep report bytes entirely within a customer-controlled directory.
 * This is a local filesystem handoff, not a cloud storage provider integration
 * or a signed source-to-output attestation.
 */
export async function persistCustomerRunnerArtifacts(input: {
  root: string;
  workspace: string;
  job: RunnerClaimedJob;
  artifacts: readonly CustomerRunnerArtifact[];
  signal?: AbortSignal;
}): Promise<number> {
  input.signal?.throwIfAborted();
  if (!uuidPattern.test(input.job.runId) || !uuidPattern.test(input.job.executionAttemptId)) {
    throw new Error("customer artifact destination requires canonical run and attempt UUIDs");
  }
  if (input.artifacts.length > 100) throw new Error("too many customer artifacts");
  const root = path.resolve(input.root);
  const workspace = await realpath(input.workspace);
  // A symlinked ancestor must not redirect the configured retained root before
  // mkdir can create files outside the operator-selected directory tree.
  await assertRunnerWorkspaceDirectories(root);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await assertRunnerWorkspaceDirectories(root);
  await privateDirectory(root);
  const realRoot = await realpath(root);
  if (inside(realRoot, workspace) || inside(workspace, realRoot)) {
    throw new Error("customer artifact root must not overlap the temporary source workspace");
  }

  const runRoot = path.join(root, input.job.runId);
  await mkdir(runRoot, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  await privateDirectory(runRoot);
  // Exclusive create serializes concurrent attempts using the same customer root.
  // An orphaned claim after a host crash is an explicit operator-recovery barrier.
  const claimPath = path.join(runRoot, `.claim-${input.job.executionAttemptId}`);
  let claim: Awaited<ReturnType<typeof open>>;
  try {
    claim = await open(claimPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("customer artifact attempt is already claimed; inspect before retrying");
    }
    throw error;
  }
  try {
    await claim.close();
    const destination = path.join(runRoot, input.job.executionAttemptId);
    const existing = await lstat(destination).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (existing) throw new Error("customer artifacts for this run attempt already exist");

    const staging = await mkdtemp(path.join(runRoot, ".pending-"));
    try {
      // Stage one artifact at a time to preserve the per-file memory bound.
      const manifestArtifacts = await input.artifacts.reduce<Promise<StagedArtifact[]>>(
        async (previous, artifact, index) => {
          const entries = await previous;
          input.signal?.throwIfAborted();
          entries.push(await stageArtifact(workspace, staging, artifact, index));
          return entries;
        },
        Promise.resolve([]),
      );
      const manifest = {
        version: 1,
        repository: `${input.job.repository.owner}/${input.job.repository.name}`,
        commitSha: input.job.repository.commitSha,
        runId: input.job.runId,
        executionAttemptId: input.job.executionAttemptId,
        artifacts: manifestArtifacts,
      };
      await writeFile(path.join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
        flag: "wx",
        mode: 0o600,
      });
      input.signal?.throwIfAborted();
      await rename(staging, destination);
      return input.artifacts.length;
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
  } finally {
    await rm(claimPath, { force: true });
  }
}
