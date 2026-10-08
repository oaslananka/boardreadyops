import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runGenerate } from "../../../src/release/generate.js";
import { assertSafeGenerateOutputCleanup } from "../../../src/release/output-cleanup.js";

const roots: string[] = [];
afterEach(async () => {
  while (roots.length) {
    const root = roots.pop();
    if (root) await fs.rm(root, { recursive: true, force: true });
  }
});

async function directory(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "brops-generate-guard-"));
  roots.push(root);
  return root;
}

async function managedOutput(root: string): Promise<{ output: string; artifact: string }> {
  const output = path.join(root, "build", "boardreadyops-generate");
  await fs.mkdir(path.join(output, "gerbers"), { recursive: true });
  const artifact = path.join(output, "gerbers", "F_Cu.gbr");
  const content = "manufacturing bytes";
  await fs.writeFile(artifact, content);
  await fs.writeFile(
    path.join(output, "manifest.json"),
    JSON.stringify({
      kind: "boardreadyops.export-provenance",
      schemaVersion: 1,
      tool: { name: "boardreadyops", version: "test" },
      artifacts: [
        {
          path: "gerbers/F_Cu.gbr",
          sha256: createHash("sha256").update(content).digest("hex"),
          bytes: Buffer.byteLength(content),
        },
      ],
    }),
  );
  return { output, artifact };
}

describe("generator output cleanup safety boundary", () => {
  it("permits a new or empty output directory", async () => {
    const root = await directory();
    const fresh = path.join(root, "build", "output");
    await expect(assertSafeGenerateOutputCleanup(fresh, { gitRoot: root })).resolves.toBeUndefined();
    await fs.mkdir(fresh, { recursive: true });
    await expect(assertSafeGenerateOutputCleanup(fresh, { gitRoot: root })).resolves.toBeUndefined();
  });

  it("rejects project root, parent directory, and source-input overlap without deleting source files", async () => {
    const root = await directory();
    const source = path.join(root, "board.kicad_pcb");
    await fs.writeFile(source, "precious source");
    const inputs = { gitRoot: root, boardFile: source };
    await expect(assertSafeGenerateOutputCleanup(root, inputs)).rejects.toThrow("overlaps the project");
    await expect(assertSafeGenerateOutputCleanup(path.dirname(root), inputs)).rejects.toThrow("overlaps the project");
    await expect(assertSafeGenerateOutputCleanup(path.parse(root).root, inputs)).rejects.toThrow("filesystem root");
    expect(await fs.readFile(source, "utf8")).toBe("precious source");
  });

  it("refuses to replace unrecognized directories, files, Git metadata and symlink outputs", async () => {
    const root = await directory();
    const outside = await directory();
    const unrelated = path.join(root, "build");
    await fs.mkdir(unrelated);
    const marker = path.join(unrelated, "manual.txt");
    await fs.writeFile(marker, "keep");
    await expect(assertSafeGenerateOutputCleanup(unrelated, { gitRoot: root })).rejects.toThrow("identifiable");
    expect(await fs.readFile(marker, "utf8")).toBe("keep");

    await expect(assertSafeGenerateOutputCleanup(marker, {})).rejects.toThrow("real directory");
    await fs.mkdir(path.join(root, ".git"));
    await expect(assertSafeGenerateOutputCleanup(path.join(root, ".git"), { gitRoot: root })).rejects.toThrow(
      "Git metadata",
    );

    if (process.platform !== "win32") {
      const alias = path.join(root, "linked-output");
      await fs.symlink(outside, alias, "dir");
      await expect(assertSafeGenerateOutputCleanup(alias, {})).rejects.toThrow("real directory");
    }
  });

  it("permits an intact previously generated directory and refuses changed or unlisted bytes", async () => {
    const root = await directory();
    const { output, artifact } = await managedOutput(root);
    await expect(assertSafeGenerateOutputCleanup(output, { gitRoot: root })).resolves.toBeUndefined();
    await fs.writeFile(artifact, "changed");
    await expect(assertSafeGenerateOutputCleanup(output, { gitRoot: root })).rejects.toThrow("has changed");
    expect(await fs.readFile(artifact, "utf8")).toBe("changed");

    const second = await managedOutput(await directory());
    await fs.writeFile(path.join(second.output, "gerbers", "extra.gbr"), "not declared");
    await expect(assertSafeGenerateOutputCleanup(second.output, {})).rejects.toThrow("undeclared");
    expect(await fs.readFile(path.join(second.output, "gerbers", "extra.gbr"), "utf8")).toBe("not declared");
  });

  it("prevents the generator itself from invoking the runner or erasing project source", async () => {
    const root = await directory();
    const pcb = path.join(root, "source.kicad_pcb");
    await fs.writeFile(pcb, "never-delete");
    let invoked = false;
    await expect(
      runGenerate(
        { steps: [{ kind: "gerbers" }] },
        {
          outputDir: root,
          boardFile: pcb,
          gitRoot: root,
          runner: async () => {
            invoked = true;
            return { code: 0, stderr: "", stdout: "", timedOut: false };
          },
        },
      ),
    ).rejects.toThrow("overlaps the project");
    expect(invoked).toBe(false);
    expect(await fs.readFile(pcb, "utf8")).toBe("never-delete");
  });

  it("rejects Git metadata even without an explicit gitRoot", async () => {
    const root = await directory();
    const metadata = path.join(root, ".git", "generated");
    await fs.mkdir(metadata, { recursive: true });
    await expect(assertSafeGenerateOutputCleanup(metadata, {})).rejects.toThrow("Git metadata");
  });

  it("rejects malformed or non-BoardReadyOps manifest without removing files", async () => {
    const root = await directory();
    const { output, artifact } = await managedOutput(root);
    const manifestPath = path.join(output, "manifest.json");
    await fs.writeFile(manifestPath, "not-json");
    await expect(assertSafeGenerateOutputCleanup(output, {})).rejects.toThrow("cannot be parsed");
    await fs.writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, tool: { name: "other" }, artifacts: [] }));
    await expect(assertSafeGenerateOutputCleanup(output, {})).rejects.toThrow("no recognizable generated inventory");
    expect(await fs.readFile(artifact, "utf8")).toBe("manufacturing bytes");
  });
});
