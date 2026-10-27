import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCliRunner } from "../../../packages/mcp-server/src/cli-runner.js";
import { runFootprintSummaryTool } from "../../../packages/mcp-server/src/tools.js";

const roots: string[] = [];
// The CLI intentionally suppresses top-level execution when Vitest is running.
// Clear that test-runner guard only for subprocesses exercising the real binary.
beforeEach(() => vi.stubEnv("VITEST", ""));
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function repository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bro-mcp-real-cli-"));
  roots.push(root);
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.name", "MCP Integration Test");
  git("config", "user.email", "mcp-test@example.test");
  const pcb = "hardware/test.kicad_pcb";
  fs.mkdirSync(path.join(root, "hardware"));
  const write = (position: string) =>
    fs.writeFileSync(
      path.join(root, pcb),
      `(kicad_pcb (version 20250114) (footprint "Resistor_SMD:R_0603" (layer "F.Cu") (at ${position}) (uuid "bf7f5122-bc89-413e-aa3e-f19064ff92f7") (property "Reference" "R1")))`,
    );
  write("1 2");
  git("add", "-A");
  git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD");
  write("2 2");
  git("add", "-A");
  git("commit", "-qm", "head");
  const head = git("rev-parse", "HEAD");
  return { root, pcb, base, head };
}

describe("MCP offline review tool with the real installed CLI bundle", () => {
  const runner = createCliRunner(path.resolve("dist/cli/index.cjs"));

  it("returns only committed footprint counts and digests despite an uncommitted working-tree edit", async () => {
    const { root, pcb, base, head } = repository();
    fs.writeFileSync(path.join(root, pcb), "not-a-valid-board secret-source-text");
    const result = await runFootprintSummaryTool({ path: root, base, head, pcb }, runner);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result).toMatchObject({
      schemaVersion: 1,
      scope: "pcb-footprints-only",
      disclosure: "counts-and-digests-only",
      baseCommitSha: base,
      headCommitSha: head,
      changes: { added: 0, removed: 0, modified: 1, byField: { positionMm: 1 } },
      riskAssessment: "not-evaluated",
    });
    const text = JSON.stringify(result.result);
    for (const secret of [
      "test.kicad_pcb",
      "secret-source-text",
      "R_0603",
      "R1",
      "sourceUuid",
      "bf7f5122-bc89-413e-aa3e-f19064ff92f7",
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it("preserves missing PCB evidence as unavailable, not a hardware pass", async () => {
    const { root, base, head } = repository();
    const result = await runFootprintSummaryTool({ path: root, base, head, pcb: "hardware/missing.kicad_pcb" }, runner);
    expect(result).toEqual({
      ok: true,
      result: { schemaVersion: 1, status: "unavailable", reason: "base-source-missing" },
    });
  });
});
