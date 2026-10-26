import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pcbFootprintSummarySchema } from "../../../packages/contracts/src/pcb-footprint-summary.js";
import { reviewFootprintDiffCommand } from "../../../src/cli/commands/review-footprint-diff.js";

function capture() {
  let content = "";
  const stream = {
    write(chunk: string) {
      content += chunk;
      return true;
    },
  } as unknown as NodeJS.WritableStream;
  return {
    stream,
    get content() {
      return content;
    },
  };
}

describe("offline review footprint-diff CLI output", () => {
  let root: string;
  let baseSha: string;
  let headSha: string;
  const execute = (...args: string[]) =>
    execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  const options = (format = "json") => ({ base: baseSha, head: headSha, pcb: "board.kicad_pcb", format });
  const command = (overrides: Partial<ReturnType<typeof options>> = {}) => {
    const stdout = capture();
    const stderr = capture();
    const code = reviewFootprintDiffCommand(
      root,
      { ...options(), ...overrides },
      {
        stdout: stdout.stream,
        stderr: stderr.stream,
      },
    );
    return { code, out: stdout.content, err: stderr.content };
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "bro-cli-git-facts-"));
    execute("init", "-q", "-b", "main");
    execute("config", "user.name", "Offline Test");
    execute("config", "user.email", "review@example.test");
    const write = (pos: string) =>
      fs.writeFileSync(
        path.join(root, "board.kicad_pcb"),
        `(kicad_pcb (version 20250114) (footprint "Resistor_SMD:R_0603" (layer "F.Cu") (at ${pos}) (uuid "bf7f5122-bc89-413e-aa3e-f19064ff92f7") (property "Reference" "R1")))`,
      );
    write("1 2");
    execute("add", "-A");
    execute("commit", "-qm", "base");
    baseSha = execute("rev-parse", "HEAD");
    write("2 2");
    execute("add", "-A");
    execute("commit", "-qm", "head");
    headSha = execute("rev-parse", "HEAD");
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("emits bounded versioned JSON with source digests, facts and an explicitly unevaluated risk", () => {
    const result = command();
    expect(result.code).toBe(0);
    expect(result.err).toBe("");
    expect(JSON.parse(result.out)).toMatchObject({
      schemaVersion: 1,
      status: "complete",
      baseCommitSha: baseSha,
      headCommitSha: headSha,
      riskAssessment: "not-evaluated",
      facts: { changes: [{ status: "footprint-modified", changedFields: ["positionMm"] }] },
    });
    expect(result.out).not.toContain("BOARDREADYOPS_TOKEN");
  });

  it("emits only bounded counts, source digests and explicit non-assessment in summary-json", () => {
    const result = command({ format: "summary-json" });
    expect(result.code).toBe(0);
    expect(result.err).toBe("");
    const parsed = JSON.parse(result.out) as unknown;
    expect(pcbFootprintSummarySchema.safeParse(parsed).success).toBe(true);
    expect(parsed).toMatchObject({
      schemaVersion: 1,
      scope: "pcb-footprints-only",
      disclosure: "counts-and-digests-only",
      baseCommitSha: baseSha,
      headCommitSha: headSha,
      changes: {
        added: 0,
        removed: 0,
        modified: 1,
        byField: { reference: 0, libraryId: 0, layer: 0, positionMm: 1, rotationDeg: 0 },
      },
      riskAssessment: "not-evaluated",
    });
    // A summary must not disclose the full original object facts or the board's filename.
    for (const sensitive of [
      "board.kicad_pcb",
      "bf7f5122-bc89-413e-aa3e-f19064ff92f7",
      "R_0603",
      "R1",
      "F.Cu",
      "sourceUuid",
      "positionDeg",
      'x":',
      'y":',
    ]) {
      expect(result.out).not.toContain(sensitive);
    }
  });

  it("fails closed when summary is unavailable instead of emitting success facts", () => {
    const result = command({ format: "summary-json", pcb: "missing.kicad_pcb" });
    expect(result.code).toBe(1);
    expect(JSON.parse(result.out)).toEqual({
      schemaVersion: 1,
      status: "unavailable",
      reason: "base-source-missing",
    });
    expect(result.err).toBe("");
  });

  it("describes exact facts in text without claiming a full PCB or risk check", () => {
    const result = command({ format: "text" });
    expect(result.code).toBe(0);
    expect(result.out).toContain("Footprints: 0 added, 0 removed, 1 modified.");
    expect(result.out).toContain("Risk/policy/DRC assessment: not evaluated.");
    expect(result.out).toContain("no source files or results were uploaded");
  });

  it("does not disguise unavailable evidence or invalid format as successful review", () => {
    const missing = command({ pcb: "missing.kicad_pcb" });
    expect(missing.code).toBe(1);
    expect(JSON.parse(missing.out)).toEqual({
      schemaVersion: 1,
      status: "unavailable",
      reason: "base-source-missing",
    });
    const unsafe = command({ pcb: "../private.kicad_pcb", format: "text" });
    expect(unsafe.code).toBe(1);
    expect(unsafe.err).toContain("invalid-source-path");
    const invalidFormat = command({ format: "xml" });
    expect(invalidFormat.code).toBe(2);
    expect(invalidFormat.err).toContain("choose text, json or summary-json");
    expect(invalidFormat.out).toBe("");
  });
});
