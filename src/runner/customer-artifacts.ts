import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RunnerClaimedJob } from "../../packages/contracts/src/index.js";

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
  await mkdir(root, { recursive: true, mode: 0o700 });
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
  const destination = path.join(runRoot, input.job.executionAttemptId);
  const existing = await lstat(destination).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (existing) throw new Error("customer artifacts for this run attempt already exist");

  const staging = await mkdtemp(path.join(runRoot, ".pending-"));
  try {
    const manifestArtifacts = [];
    for (const [index, artifact] of input.artifacts.entries()) {
      input.signal?.throwIfAborted();
      const realSource = await realpath(artifact.filePath);
      if (!inside(workspace, realSource)) throw new Error("runner artifact escaped the source workspace");
      const handle = await open(artifact.filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      let content: Buffer;
      try {
        const stats = await handle.stat();
        if (!stats.isFile() || stats.size > maximumLocalArtifactBytes) {
          throw new Error("runner artifact is not a bounded regular file");
        }
        content = await handle.readFile();
      } finally {
        await handle.close();
      }
      const digest = createHash("sha256").update(content).digest("hex");
      if (content.length !== artifact.bytes || digest !== artifact.sha256) {
        throw new Error("runner artifact bytes do not match its declaration");
      }
      const filename = `artifact-${String(index + 1).padStart(3, "0")}.bin`;
      await writeFile(path.join(staging, filename), content, { flag: "wx", mode: 0o600 });
      manifestArtifacts.push({
        filename,
        kind: artifact.kind,
        name: artifact.name,
        role: artifact.role,
        bytes: artifact.bytes,
        sha256: artifact.sha256,
      });
    }
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
}
