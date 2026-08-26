import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error Native ESM operations script intentionally has no declaration file.
import * as postUpgrade from "../../../scripts/renovate-post-upgrade.mjs";

// Destructured rather than named in the import so the directive above stays on the line it
// suppresses; the formatter wraps a named list this long across lines and separates the two.
const { admitQuarantinedVersions, createRenovateEnvironment, main, parseQuarantinedVersions, renovateCommandPlan } =
  postUpgrade;

type RunOptions = { cwd: string; env: NodeJS.ProcessEnv };
type RunCall = { command: string; args: string[]; options: RunOptions };
type RemoveCall = { target: string; options: { recursive: boolean; force: boolean } };

describe("Renovate post-upgrade isolation", () => {
  it("uses a dedicated pnpm store for every child command", () => {
    const env = createRenovateEnvironment("/tmp/boardreadyops-renovate-store", {
      PATH: "/usr/bin",
    });

    expect(env.PATH).toBe("/usr/bin");
    expect(env.pnpm_config_store_dir).toBe("/tmp/boardreadyops-renovate-store");
  });

  it("keeps frozen install, native rebuild, NOTICE, and dist generation in order", () => {
    expect(renovateCommandPlan()).toEqual([
      ["corepack", ["pnpm", "install", "--frozen-lockfile", "--ignore-scripts"]],
      ["corepack", ["pnpm", "rebuild", "@prisma/engines", "esbuild", "prisma", "sharp"]],
      ["corepack", ["pnpm", "run", "notice"]],
      ["corepack", ["pnpm", "run", "build"]],
    ]);
  });

  it("cleans the temporary store after a successful run", async () => {
    const calls: RunCall[] = [];
    const removals: RemoveCall[] = [];

    await main("/repo", {
      makeTemp: async () => "/tmp/isolated-store",
      remove: async (target: string, options: RemoveCall["options"]) => {
        removals.push({ target, options });
      },
      run: async (command: string, args: string[], options: RunOptions) => {
        calls.push({ command, args, options });
      },
      baseEnv: { PATH: "/usr/bin" },
    });

    expect(calls).toHaveLength(4);
    for (const call of calls) {
      expect(call.options.env.pnpm_config_store_dir).toBe("/tmp/isolated-store");
    }
    expect(removals).toEqual([
      { target: join("/repo", "node_modules"), options: { recursive: true, force: true } },
      { target: "/tmp/isolated-store", options: { recursive: true, force: true } },
    ]);
  });

  it("cleans the temporary store when a child command fails", async () => {
    const failure = new Error("boom");
    const removals: RemoveCall[] = [];

    await expect(
      main("/repo", {
        makeTemp: async () => "/tmp/isolated-store",
        remove: async (target: string, options: RemoveCall["options"]) => {
          removals.push({ target, options });
        },
        run: async () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);

    expect(removals).toEqual([
      { target: join("/repo", "node_modules"), options: { recursive: true, force: true } },
      { target: "/tmp/isolated-store", options: { recursive: true, force: true } },
    ]);
  });
});

describe("release quarantine", () => {
  const refusal = `[ERR_PNPM_NO_MATURE_MATCHING_VERSION] 2 versions do not meet the minimumReleaseAge constraint:
  fast-uri@3.1.6 was published at 2026-08-23T01:42:00.349Z, within the minimumReleaseAge cutoff (2026-08-19T04:07:54.231Z)
  fast-uri@3.1.6 was published at 2026-08-23T01:42:00.349Z, within the minimumReleaseAge cutoff (2026-08-19T04:07:54.231Z)`;

  it("takes the refused versions from what pnpm actually named", () => {
    // Reported once per workspace project, so the same version arrives more than once.
    expect(parseQuarantinedVersions(refusal)).toEqual(["fast-uri@3.1.6"]);
  });

  it("admits nothing when the install failed for some other reason", () => {
    // A lockfile mismatch is a different problem, and widening a security allowlist is never
    // the right response to a failure that did not ask for it.
    expect(parseQuarantinedVersions("[ERR_PNPM_LOCKFILE_CONFIG_MISMATCH] overrides changed")).toEqual([]);
  });

  it("adds the refused version to the allowlist and leaves the rest alone", () => {
    const workspace = [
      "minimumReleaseAge: 10080",
      "minimumReleaseAgeExclude:",
      "  # OSV security update: nanoid",
      "  - 'nanoid@3.3.17 || 3.3.18'",
      "  - 'fast-uri@3.1.5'",
      "trustPolicy: no-downgrade",
      "",
    ].join("\n");

    const admitted = admitQuarantinedVersions(workspace, ["fast-uri@3.1.6"]);

    expect(admitted.split("\n")).toEqual([
      "minimumReleaseAge: 10080",
      "minimumReleaseAgeExclude:",
      "  # OSV security update: nanoid",
      "  - 'nanoid@3.3.17 || 3.3.18'",
      "  - 'fast-uri@3.1.5'",
      "  - 'fast-uri@3.1.6'",
      "trustPolicy: no-downgrade",
      "",
    ]);
  });

  it("never rewrites or drops an entry that is already there", () => {
    // 'nanoid@3.3.17 || 3.3.18' admits two versions deliberately, and deciding one is no longer
    // trusted is a judgement rather than something to infer from a bump.
    const workspace = ["minimumReleaseAgeExclude:", "  - 'nanoid@3.3.17 || 3.3.18'", ""].join("\n");

    expect(admitQuarantinedVersions(workspace, [])).toBe(workspace);
    expect(admitQuarantinedVersions(workspace, ["nanoid@3.3.17 || 3.3.18"])).toBe(workspace);
  });

  it("retries the install once after admitting, then runs the rest of the plan", async () => {
    const calls: string[][] = [];
    let written = "";
    const failure = Object.assign(new Error("install failed"), { stderr: refusal });
    let firstAttempt = true;

    await main("/repo", {
      makeTemp: async () => "/tmp/store",
      remove: async () => {},
      readWorkspace: async () => "minimumReleaseAgeExclude:\n  - 'fast-uri@3.1.5'\n",
      writeWorkspace: async (_target: string, contents: string) => {
        written = contents;
      },
      run: async (command: string, args: string[]) => {
        calls.push([command, ...args]);
        if (args[1] === "install" && firstAttempt) {
          firstAttempt = false;
          throw failure;
        }
      },
    });

    expect(written).toContain("- 'fast-uri@3.1.6'");
    // Install, the retry, then rebuild, notice and build.
    expect(calls.filter((call) => call[2] === "install")).toHaveLength(2);
    expect(calls.at(-1)).toEqual(["corepack", "pnpm", "run", "build"]);
  });

  it("gives up when the second install is refused as well", async () => {
    const failure = Object.assign(new Error("install failed"), { stderr: refusal });

    await expect(
      main("/repo", {
        makeTemp: async () => "/tmp/store",
        remove: async () => {},
        readWorkspace: async () => "minimumReleaseAgeExclude:\n",
        writeWorkspace: async () => {},
        run: async () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
  });
});
