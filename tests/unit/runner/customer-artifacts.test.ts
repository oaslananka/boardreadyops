import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RunnerClaimedJob } from "../../../packages/contracts/src/index.js";
import { persistCustomerRunnerArtifacts } from "../../../src/runner/customer-artifacts.js";

const roots: string[] = [];
const runId = "22222222-2222-4222-8222-222222222222";
const executionAttemptId = "33333333-3333-4333-8333-333333333333";

function job(): RunnerClaimedJob {
  return {
    runId,
    executionAttemptId,
    leaseId: "44444444-4444-4444-8444-444444444444",
    leaseToken: "l".repeat(43),
    leaseExpiresAt: "2026-07-14T02:05:00.000Z",
    maximumLeaseExpiresAt: "2026-07-14T02:30:00.000Z",
    sourceMode: "customer_checkout",
    repository: { owner: "octo-org", name: "private-board", private: true, commitSha: "a".repeat(40) },
    safeMode: { enabled: true, reasons: ["private-repository"] },
  };
}
async function fixture() {
  const base = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-local-artifacts-"));
  roots.push(base);
  const workspace = path.join(base, "workspace");
  const root = path.join(base, "customer-storage");
  await mkdir(workspace, { mode: 0o700 });
  await mkdir(root, { mode: 0o700 });
  const filePath = path.join(workspace, "result.json");
  const bytes = Buffer.from("sample report");
  await writeFile(filePath, bytes);
  const artifact = {
    kind: "report/json",
    name: "../hostile-name.json",
    role: "primary",
    filePath,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  return { base, root, workspace, filePath, artifact };
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
describe("persistCustomerRunnerArtifacts", () => {
  it("keeps report bytes local, uses generated filenames and records verified provenance metadata", async () => {
    const f = await fixture();
    expect(
      await persistCustomerRunnerArtifacts({
        root: f.root,
        workspace: f.workspace,
        job: job(),
        artifacts: [f.artifact],
      }),
    ).toBe(1);
    const dest = path.join(f.root, runId, executionAttemptId);
    const manifest = JSON.parse(await readFile(path.join(dest, "manifest.json"), "utf8"));
    expect(manifest).toMatchObject({
      version: 1,
      repository: "octo-org/private-board",
      commitSha: "a".repeat(40),
      runId,
      executionAttemptId,
      artifacts: [{ filename: "artifact-001.bin", name: "../hostile-name.json", sha256: f.artifact.sha256 }],
    });
    await expect(readFile(path.join(dest, "artifact-001.bin"), "utf8")).resolves.toBe("sample report");
    expect(await readdir(dest)).toEqual(["artifact-001.bin", "manifest.json"]);
    if (process.platform !== "win32") {
      expect((await lstat(path.join(dest, "artifact-001.bin"))).mode & 0o077).toBe(0);
    }
  });
  it("never overwrites an existing attempt", async () => {
    const f = await fixture();
    const input = { root: f.root, workspace: f.workspace, job: job(), artifacts: [f.artifact] };
    await persistCustomerRunnerArtifacts(input);
    await expect(persistCustomerRunnerArtifacts(input)).rejects.toThrow(/already exist/u);
    expect(await readdir(path.join(f.root, runId))).toEqual([executionAttemptId]);
  });
  it("rejects a digest mismatch and removes uncommitted staging files", async () => {
    const f = await fixture();
    const bad = { ...f.artifact, sha256: "0".repeat(64) };
    await expect(
      persistCustomerRunnerArtifacts({
        root: f.root,
        workspace: f.workspace,
        job: job(),
        artifacts: [bad],
      }),
    ).rejects.toThrow(/do not match/u);
    expect(await readdir(path.join(f.root, runId))).toEqual([]);
  });
  it("rejects local artifact roots that overlap the ephemeral workspace", async () => {
    const f = await fixture();
    await expect(
      persistCustomerRunnerArtifacts({
        root: path.join(f.workspace, "retained"),
        workspace: f.workspace,
        job: job(),
        artifacts: [f.artifact],
      }),
    ).rejects.toThrow(/overlap/u);
  });
  it("rejects an artifact pointing outside its workspace", async () => {
    const f = await fixture();
    const foreign = path.join(f.root, "external");
    await writeFile(foreign, "outside");
    await expect(
      persistCustomerRunnerArtifacts({
        root: f.root,
        workspace: f.workspace,
        job: job(),
        artifacts: [{ ...f.artifact, filePath: foreign }],
      }),
    ).rejects.toThrow(/escaped/u);
    expect(await readdir(path.join(f.root, runId))).toEqual([]);
  });
  it("refuses a symlinked artifact root", async () => {
    const f = await fixture();
    const alias = path.join(f.base, "storage-alias");
    await symlink(f.root, alias, "dir");
    await expect(
      persistCustomerRunnerArtifacts({
        root: alias,
        workspace: f.workspace,
        job: job(),
        artifacts: [f.artifact],
      }),
    ).rejects.toThrow(/not a regular directory/u);
  });
  it("refuses pre-aborted storage without creating an attempt", async () => {
    const f = await fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(
      persistCustomerRunnerArtifacts({
        root: f.root,
        workspace: f.workspace,
        job: job(),
        artifacts: [f.artifact],
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(await readdir(f.root)).toEqual([]);
  });
});
