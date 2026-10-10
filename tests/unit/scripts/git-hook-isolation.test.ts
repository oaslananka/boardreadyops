import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("local pre-push hook isolation", () => {
  it("clears Git hook overrides before invoking fixture-producing tests", () => {
    const repositoryRoot = process.cwd();
    const hook = fs.readFileSync(path.join(repositoryRoot, ".husky/pre-push"), "utf8");
    const firstValidation = hook.indexOf("corepack pnpm run typecheck");
    expect(firstValidation).toBeGreaterThan(0);
    const prelude = hook.slice(0, firstValidation);
    expect(prelude).toContain("git rev-parse --local-env-vars");
    expect(prelude).toContain('unset "$name"');
    expect(hook).toContain("vitest run tests/unit --maxWorkers=2");

    const repoGitDir = spawnSync("git", ["rev-parse", "--absolute-git-dir"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
    expect(repoGitDir.status).toBe(0);

    const probe = fs.mkdtempSync(path.join(os.tmpdir(), "brops-hook-isolation-"));
    try {
      // Prove Git cannot treat a foreign directory as the parent worktree after
      // the prelude. Only read-only Git commands are used in this regression.
      const result = spawnSync(
        "sh",
        ["-c", `${prelude}\nif git -C "$PROBE_DIR" rev-parse --show-toplevel >/dev/null 2>&1; then exit 23; fi`],
        {
          cwd: repositoryRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            GIT_DIR: repoGitDir.stdout.trim(),
            GIT_WORK_TREE: repositoryRoot,
            PROBE_DIR: probe,
          },
        },
      );
      expect(result.status).toBe(0);
    } finally {
      fs.rmSync(probe, { recursive: true, force: true });
    }
  });
});
