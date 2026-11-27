import { createHash, generateKeyPairSync } from "node:crypto";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunnerClaimedJob } from "../../../packages/contracts/src/index.js";
import { boardReadyVersion } from "../../../src/generated/version.js";
import { RunnerControlPlaneClient } from "../../../src/runner/client.js";
import { persistCustomerRunnerArtifacts } from "../../../src/runner/customer-artifacts.js";

vi.mock("node:fs/promises", { spy: true });

const roots: string[] = [];
const runId = "22222222-2222-4222-8222-222222222222";
const executionAttemptId = "33333333-3333-4333-8333-333333333333";
const job: RunnerClaimedJob = {
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

afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(fs.open).mockReset();
  vi.mocked(fs.stat).mockReset();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-runner-read-race-"));
  roots.push(base);
  const workspace = path.join(base, "workspace");
  const root = path.join(base, "retained");
  await fs.mkdir(workspace, { mode: 0o700 });
  await fs.mkdir(root, { mode: 0o700 });
  const filePath = path.join(workspace, "report.json");
  const content = Buffer.from("hello");
  await fs.writeFile(filePath, content);
  const artifact = {
    kind: "report/json",
    name: "report.json",
    role: "primary",
    filePath,
    bytes: content.length,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
  const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
  const client = new RunnerControlPlaneClient({
    baseUrl: "https://control.example",
    runnerId: job.leaseId,
    runnerVersion: boardReadyVersion,
    privateKey: generateKeyPairSync("ed25519").privateKey,
    fetch: fetchMock as typeof fetch,
  });
  return { root, workspace, artifact, fetchMock, client };
}

function transfer(f: Awaited<ReturnType<typeof fixture>>, mode: "cloud" | "customer") {
  return mode === "cloud"
    ? f.client.uploadArtifact(
        "https://control.example/upload?cap=x",
        f.artifact.filePath,
        f.artifact.bytes,
        f.artifact.sha256,
      )
    : persistCustomerRunnerArtifacts({ root: f.root, workspace: f.workspace, job, artifacts: [f.artifact] });
}

async function assertNoTransfer(f: Awaited<ReturnType<typeof fixture>>, mode: "cloud" | "customer") {
  expect(f.fetchMock).not.toHaveBeenCalled();
  if (mode === "customer") expect(await fs.readdir(path.join(f.root, runId))).toEqual([]);
}

describe("runner artifact reads", () => {
  it.each(["cloud", "customer"] as const)("transfers exact empty and multi-chunk artifacts: %s", async (mode) => {
    for (const content of [Buffer.alloc(0), Buffer.alloc(128 * 1024 + 1, 65)]) {
      const f = await fixture();
      await fs.writeFile(f.artifact.filePath, content);
      f.artifact.bytes = content.length;
      f.artifact.sha256 = createHash("sha256").update(content).digest("hex");
      await transfer(f, mode);
      if (mode === "cloud") {
        expect(f.fetchMock).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ body: content }));
      } else {
        expect(await fs.readFile(path.join(f.root, runId, executionAttemptId, "artifact-001.bin"))).toEqual(content);
        expect(f.fetchMock).not.toHaveBeenCalled();
      }
    }
  });

  it.each(["cloud", "customer"] as const)("rejects growth after stat without a full-file read: %s", async (mode) => {
    const f = await fixture();
    const original = await vi.importActual<typeof fs>("node:fs/promises");
    let grew = false;
    const grow = async () => {
      if (grew) return;
      await fs.appendFile(f.artifact.filePath, Buffer.alloc(128 * 1024, 65));
      grew = true;
    };
    // Exercise the former path-based cloud preflight too. The new reader
    // uses lstat and a descriptor; the old reader used stat and readFile.
    vi.mocked(fs.stat).mockImplementationOnce(async (...args) => {
      const before = await original.stat(...args);
      await grow();
      return before;
    });
    let fullRead: ReturnType<typeof vi.spyOn> | undefined;
    let boundedRead: ReturnType<typeof vi.spyOn> | undefined;
    vi.mocked(fs.open).mockImplementation(async (...args) => {
      const handle = await original.open(...args);
      if (args[0] === f.artifact.filePath) {
        const stat = handle.stat.bind(handle);
        vi.spyOn(handle, "stat").mockImplementationOnce(async () => {
          const before = await stat();
          await grow();
          return before;
        });
        fullRead = vi.spyOn(handle, "readFile");
        boundedRead = vi.spyOn(handle, "read");
      }
      return handle;
    });
    await expect(transfer(f, mode)).rejects.toThrow(/artifact size changed/u);
    expect(grew).toBe(true);
    expect(fs.readFile).not.toHaveBeenCalledWith(f.artifact.filePath);
    expect(fullRead).toBeDefined();
    expect(fullRead).not.toHaveBeenCalled();
    expect(boundedRead?.mock.calls.map((call: unknown[]) => call[2])).toEqual([5, 1]);
    const touched = boundedRead?.mock.calls[0]?.[0];
    expect(touched).toEqual(Buffer.alloc(5));
    await assertNoTransfer(f, mode);
  });

  it.each(["cloud", "customer"] as const)(
    "rejects a short read or failed descriptor close without transferring bytes: %s",
    async (mode) => {
      for (const failure of ["short read", "close"] as const) {
        const f = await fixture();
        const original = await vi.importActual<typeof fs>("node:fs/promises");
        let boundedRead: ReturnType<typeof vi.spyOn> | undefined;
        vi.mocked(fs.open).mockImplementation(async (...args) => {
          const handle = await original.open(...args);
          if (args[0] === f.artifact.filePath) {
            const stat = handle.stat.bind(handle);
            const close = handle.close.bind(handle);
            if (failure === "short read") {
              vi.spyOn(handle, "stat").mockImplementationOnce(async () => {
                const before = await stat();
                await fs.truncate(f.artifact.filePath, 2);
                return before;
              });
            } else {
              vi.spyOn(handle, "close").mockImplementationOnce(async () => {
                await close();
                throw new Error("simulated descriptor close failure");
              });
            }
            boundedRead = vi.spyOn(handle, "read");
          }
          return handle;
        });
        await expect(transfer(f, mode)).rejects.toThrow(
          failure === "short read" ? /artifact size changed/u : /simulated descriptor close failure/u,
        );
        expect(boundedRead?.mock.calls.length).toBeGreaterThan(0);
        expect(boundedRead?.mock.calls[0]?.[0]).toEqual(Buffer.alloc(5));
        await assertNoTransfer(f, mode);
      }
    },
  );
});
