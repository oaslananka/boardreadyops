import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertSafeReleaseOutputCleanup } from "../../../src/release/release-output-cleanup.js";

const fixtures: string[] = [];
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bro-release-output-"));
  fixtures.push(root);
  await fs.writeFile(path.join(root, "board.kicad_pcb"), "important design");
  return root;
}
afterEach(async () => {
  for (const root of fixtures.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

describe("release output cleanup safety", () => {
  it("refuses the project root, its ancestors, Git metadata, symlink outputs and unrelated directories", async () => {
    const root = await fixture();
    const source = path.join(root, "board.kicad_pcb");
    await fs.mkdir(path.join(root, ".git"));
    await fs.mkdir(path.join(root, "documents"));
    await fs.writeFile(path.join(root, "documents", "notes.txt"), "preserve me");
    await fs.symlink(path.join(root, "documents"), path.join(root, "alias"));

    for (const target of [
      root,
      path.dirname(root),
      path.join(root, ".git"),
      path.join(root, ".git", "objects"),
      path.join(root, "documents"),
      path.join(root, "alias"),
    ]) {
      await expect(assertSafeReleaseOutputCleanup(root, target, "evidence")).rejects.toThrow();
    }
    await expect(fs.readFile(source, "utf8")).resolves.toBe("important design");
    await expect(fs.readFile(path.join(root, "documents", "notes.txt"), "utf8")).resolves.toBe("preserve me");
  });

  it.each(["evidence", "handoff"] as const)(
    "permits first-time and intact %s reruns but rejects changed or undeclared files",
    async (kind) => {
      const root = await fixture();
      const output = path.join(root, "build", kind);
      await expect(assertSafeReleaseOutputCleanup(root, output, kind)).resolves.toBeUndefined();
      await fs.mkdir(output, { recursive: true });
      const file = kind === "evidence" ? "reports/report.md" : "gerbers/top.gtl";
      await fs.mkdir(path.dirname(path.join(output, file)), { recursive: true });
      await fs.writeFile(path.join(output, file), "artifact");
      const artifact = { sha256: createHash("sha256").update("artifact").digest("hex"), bytes: 8 };
      const manifest =
        kind === "evidence"
          ? { schemaVersion: 2, tool: { name: "boardreadyops" }, artifacts: [{ path: file, ...artifact }] }
          : { schemaVersion: 1, tool: { name: "boardreadyops" }, files: [{ target: file, ...artifact }] };
      const manifestFile = kind === "evidence" ? "manifest.json" : "handoff-manifest.json";
      await fs.writeFile(path.join(output, manifestFile), JSON.stringify(manifest));
      await fs.writeFile(path.join(output, kind === "evidence" ? "checksums.txt" : "README.md"), "metadata");
      await expect(assertSafeReleaseOutputCleanup(root, output, kind)).resolves.toBeUndefined();
      if (kind === "evidence") {
        await fs.writeFile(path.join(output, "manifest.sig"), "{}");
        await expect(assertSafeReleaseOutputCleanup(root, output, kind)).rejects.toThrow(/immutable/);
        await fs.unlink(path.join(output, "manifest.sig"));
      }
      await fs.writeFile(path.join(output, file), "tampered");
      await expect(assertSafeReleaseOutputCleanup(root, output, kind)).rejects.toThrow(/changed/);
      await fs.writeFile(path.join(output, file), "artifact");
      await fs.writeFile(path.join(output, "personal.txt"), "personal");
      await expect(assertSafeReleaseOutputCleanup(root, output, kind)).rejects.toThrow(/undeclared/);
    },
  );
});
