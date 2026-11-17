import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import * as yaml from "js-yaml";
import { describe, expect, it, vi } from "vitest";

const workflow = new URL("../../../.github/workflows/readiness-runner.yml", import.meta.url);
const sha = "a".repeat(40);
const config = Buffer.from("version: 1\nmode: enforce\n", "utf8");

type Entry = { path: string; mode: string; type: string; sha: string; size?: number };
type FixtureOptions = {
  configPath?: string;
  fileContent?: Buffer;
  rootEntries?: Entry[];
  nestedEntries?: Entry[];
  blobSize?: number;
  decodedOverride?: string;
  commitSha?: string;
  contextSha?: string;
};

async function runProbe(options: FixtureOptions = {}) {
  const source = await readFile(workflow, "utf8");
  const parsed = yaml.load(source) as {
    jobs: Record<string, { steps: Array<{ name?: string; uses?: string; with?: { script?: string } }> }>;
  };
  const steps = parsed.jobs["setup-probe"]?.steps;
  const inspection = steps?.find((step) => step.name === "Read configuration from authenticated GitHub commit");
  expect(inspection?.uses).toMatch(/^actions\/github-script@[0-9a-f]{40}$/u);
  expect(steps?.some((step) => step.name === "Check out default branch")).toBe(false);
  const script = inspection?.with?.script;
  expect(script).toBeTypeOf("string");

  const bytes = options.fileContent ?? config;
  const entry = {
    path: options.configPath ?? "boardreadyops.yml",
    mode: "100644",
    type: "blob",
    sha: "c".repeat(40),
    size: bytes.length,
  };
  const rootEntries = options.rootEntries ?? [
    entry,
    { path: "lib", type: "tree", mode: "040000", sha: "e".repeat(40) },
  ];
  const trees = new Map([
    ["root", rootEntries],
    ["nested", options.nestedEntries ?? [entry]],
  ]);
  const getCommit = vi.fn().mockResolvedValue({ data: { tree: { sha: "root" } } });
  const getTree = vi.fn().mockImplementation(async ({ tree_sha }: { tree_sha: string }) => ({
    data: { tree: trees.get(tree_sha) ?? [], truncated: false },
  }));
  const getBlob = vi.fn().mockResolvedValue({
    data: {
      content: options.decodedOverride ?? bytes.toString("base64"),
      encoding: "base64",
      size: options.blobSize ?? bytes.length,
    },
  });
  const setOutput = vi.fn();
  const folder = await mkdtemp(join(tmpdir(), "boardreadyops-setup-probe-"));
  try {
    const env = { CONFIG_PATH: options.configPath ?? "boardreadyops.yml", RUNNER_TEMP: folder };
    const sandbox = {
      require: createRequire(import.meta.url),
      Buffer,
      process: { env },
      core: { setOutput },
      github: { rest: { git: { getCommit, getTree, getBlob } } },
      context: {
        repo: { owner: "owner", repo: "board" },
        sha: options.contextSha ?? sha,
        ref: "refs/heads/main",
      },
    };
    const evaluate = () => runInNewContext(`(async () => {\n${script}\n})()`, sandbox) as Promise<void>;
    return {
      evaluate,
      setOutput,
      getCommit,
      getTree,
      getBlob,
      folder,
      readConfig: () => readFile(join(folder, "boardreadyops-setup-probe", "boardreadyops.yml"), "utf8"),
      close: () => rm(folder, { recursive: true, force: true }),
      isConfigPresent: () =>
        stat(join(folder, "boardreadyops-setup-probe", "boardreadyops.yml")).then(
          () => true,
          () => false,
        ),
    };
  } catch (error) {
    await rm(folder, { recursive: true, force: true });
    throw error;
  }
}

describe("source-free OIDC setup probe", () => {
  it("reads only the exact GitHub commit configuration despite unrelated malformed gitlinks", async () => {
    const subject = await runProbe();
    try {
      await subject.evaluate();
      expect(subject.getCommit).toHaveBeenCalledWith({ owner: "owner", repo: "board", commit_sha: sha });
      expect(subject.getTree).toHaveBeenCalledTimes(1);
      expect(subject.getBlob).toHaveBeenCalledWith({ owner: "owner", repo: "board", file_sha: "c".repeat(40) });
      expect(await subject.readConfig()).toBe(config.toString("utf8"));
      expect(subject.setOutput).toHaveBeenCalledWith("observed_sha", sha);
      expect(subject.setOutput).toHaveBeenCalledWith("config_status", "found");
    } finally {
      await subject.close();
    }
  });

  it("returns a specific missing configuration status without an entire repository checkout", async () => {
    const subject = await runProbe({ rootEntries: [{ path: "lib", type: "commit", mode: "160000", sha }] });
    try {
      await subject.evaluate();
      expect(subject.getBlob).not.toHaveBeenCalled();
      expect(subject.setOutput).toHaveBeenCalledWith("config_status", "missing");
      expect(await subject.isConfigPresent()).toBe(false);
    } finally {
      await subject.close();
    }
  });

  it("follows nested tracked config paths without resolving unrelated gitlinks", async () => {
    const subject = await runProbe({
      configPath: ".boardreadyops/release.yml",
      rootEntries: [{ path: ".boardreadyops", type: "tree", mode: "040000", sha: "nested" }],
      nestedEntries: [{ path: "release.yml", type: "blob", mode: "100644", sha: "c".repeat(40), size: config.length }],
    });
    try {
      await subject.evaluate();
      expect(subject.getTree).toHaveBeenCalledTimes(2);
      expect(await subject.readConfig()).toBe(config.toString());
    } finally {
      await subject.close();
    }
  });

  it.each([
    ["symlink", { rootEntries: [{ path: "boardreadyops.yml", type: "blob", mode: "120000", sha: "c".repeat(40) }] }],
    ["gitlink", { rootEntries: [{ path: "boardreadyops.yml", type: "commit", mode: "160000", sha: "c".repeat(40) }] }],
    ["invalid path", { configPath: "../boardreadyops.yml" }],
    ["oversize", { blobSize: 100_000 }],
    ["wrong size", { blobSize: 5 }],
    ["wrong source identity", { contextSha: "invalid" }],
  ])("rejects %s with no trusted source configuration", async (_kind, options) => {
    const subject = await runProbe(options);
    try {
      await expect(subject.evaluate()).rejects.toThrow();
      expect(subject.setOutput).not.toHaveBeenCalledWith("config_status", "found");
    } finally {
      await subject.close();
    }
  });
});
