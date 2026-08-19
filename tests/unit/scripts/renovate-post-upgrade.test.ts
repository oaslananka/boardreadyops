import { describe, expect, it } from "vitest";
// @ts-expect-error Native ESM operations script intentionally has no declaration file.
import { createRenovateEnvironment, main, renovateCommandPlan } from "../../../scripts/renovate-post-upgrade.mjs";

type RunOptions = { cwd: string; env: NodeJS.ProcessEnv };
type RunCall = { command: string; args: string[]; options: RunOptions };
type RemoveCall = { target: string; options: { recursive: boolean; force: boolean } };

describe("Renovate post-upgrade isolation", () => {
  it("uses a dedicated pnpm store for every child command", () => {
    const env = createRenovateEnvironment("/tmp/boardreadyops-renovate-store", {
      PATH: "/usr/bin",
    });

    expect(env.PATH).toBe("/usr/bin");
    expect(env.npm_config_store_dir).toBe("/tmp/boardreadyops-renovate-store");
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
      expect(call.options.env.npm_config_store_dir).toBe("/tmp/isolated-store");
    }
    expect(removals).toEqual([{ target: "/tmp/isolated-store", options: { recursive: true, force: true } }]);
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

    expect(removals).toEqual([{ target: "/tmp/isolated-store", options: { recursive: true, force: true } }]);
  });
});
