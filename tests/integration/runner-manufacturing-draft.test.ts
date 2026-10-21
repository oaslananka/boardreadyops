import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { RunnerClaimedJob } from "../../packages/contracts/src/index.js";
import { prepareRunnerManufacturingDraft } from "../../src/cli/runner-manufacturing-draft.js";
import { executeRunnerPipeline } from "../../src/cli/runner-pipeline.js";
import { detectKicadCli } from "../../src/kicad/cli.js";

function fakeJob(sha: string): RunnerClaimedJob {
  return {
    leaseId: "11111111-1111-4111-8111-111111111111",
    leaseToken: "l".repeat(43),
    runId: "22222222-2222-4222-8222-222222222222",
    executionAttemptId: "33333333-3333-4333-8333-333333333333",
    leaseExpiresAt: "2026-10-20T16:00:00.000Z",
    maximumLeaseExpiresAt: "2026-10-20T16:30:00.000Z",
    sourceMode: "customer_checkout",
    repository: { owner: "example", name: "fixture", commitSha: sha, private: false },
    safeMode: { enabled: false, reasons: [] },
  };
}

describe("explicit runner manufacturing draft upload", () => {
  it("rejects opt-in for private or safe-mode sources before preparing any archive", async () => {
    const publicJob = fakeJob("a".repeat(40));
    for (const job of [
      { ...publicJob, repository: { ...publicJob.repository, private: true } },
      { ...publicJob, safeMode: { enabled: true, reasons: ["private-repository"] as Array<"private-repository"> } },
    ]) {
      await expect(prepareRunnerManufacturingDraft("/no-checkout", job, { requireKicad: true })).rejects.toThrow(
        /public, non-safe-mode/,
      );
    }
  });

  it("keeps real generated ZIP a non-approving draft and rejects a mismatched checkout SHA", async (context) => {
    const cli = await detectKicadCli();
    if (!process.env.CI) context.skip(!cli.found || !/^10[.]0[.]/u.test(cli.version ?? ""), "KiCad 10 required");
    const root = await mkdtemp(path.join(os.tmpdir(), "bro-runner-manufacturing-"));
    try {
      await cp(path.resolve("tests/fixtures/projects/safe-basic"), root, { recursive: true });
      execFileSync("git", ["init", "--quiet"], { cwd: root });
      execFileSync("git", ["add", "."], { cwd: root });
      execFileSync(
        "git",
        ["-c", "user.email=fixture@example.invalid", "-c", "user.name=Fixture", "commit", "--quiet", "-m", "fixture"],
        { cwd: root },
      );
      const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
      await expect(
        prepareRunnerManufacturingDraft(root, fakeJob("f".repeat(40)), { requireKicad: true }),
      ).rejects.toThrow(/source commit does not match|pinned SHA/);
      const result = await executeRunnerPipeline(root, fakeJob(sha), {
        requireKicad: true,
        manufacturingDraftUpload: true,
      });
      expect(result.exitCode).toBe(0);
      expect(result.report?.readiness?.status).toBe("ready");
      const archives = result.artifacts.filter((a) => a.kind === "archive");
      expect(archives).toHaveLength(1);
      expect(archives[0]?.role).toBe("draft-manufacturing");
      expect(archives[0]?.contentType).toBe("application/zip");
      const archive = archives[0];
      if (!archive) throw new Error("Runner did not emit a draft archive");
      const bytes = await readFile(archive.filePath);
      expect(bytes.subarray(0, 2).toString()).toBe("PK");
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(archives[0]?.sha256);
      // A non-approving draft cannot satisfy the DB's exact role=manufacturing gate.
      expect(archives[0]?.role).not.toBe("manufacturing");
      // A customer checkout does not need a tracked .gitignore for generated files,
      // but genuinely new untracked files must remain visible to source checks.
      await writeFile(path.join(root, "untracked-customer-file.txt"), "not part of the reviewed commit");
      await expect(prepareRunnerManufacturingDraft(root, fakeJob(sha), { requireKicad: true })).rejects.toThrow(
        /clean Git checkout/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});
