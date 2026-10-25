import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gitPcbFootprintEvidence } from "../../../src/kicad/git-footprint-evidence.js";

const uuidA = "bf7f5122-bc89-413e-aa3e-f19064ff92f7";
const uuidB = "c71b2196-ae56-4853-92ac-5497683704cd";
const file = "hardware/main board.kicad_pcb";
const footprint = (uuid: string, reference: string, at: string) =>
  `(footprint "Resistor_SMD:R_0603" (layer "F.Cu") (at ${at}) (uuid "${uuid}") (property "Reference" "${reference}"))`;
const board = (...items: string[]) => `(kicad_pcb (version 20250114) ${items.join(" ")})`;

describe("local Git-commit-backed KiCad footprint evidence", () => {
  let root: string;
  const run = (...args: string[]) =>
    execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  const write = (text: string, name = file) => {
    const filename = path.join(root, name);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, text, "utf8");
  };
  const commit = (message: string): string => {
    run("add", "-A");
    run("commit", "-qm", message);
    return run("rev-parse", "HEAD");
  };
  const evidence = (baseRef: string, headRef: string, sourcePath = file) =>
    gitPcbFootprintEvidence({ repositoryRoot: root, sourcePath, baseRef, headRef });

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "bro-git-source-facts-"));
    run("init", "-q", "-b", "main");
    run("config", "user.name", "Local Evidence Test");
    run("config", "user.email", "tests@example.test");
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("compares immutable commit blobs, not changed working-tree content, with exact source/commit digests", () => {
    const baseText = board(footprint(uuidA, "R1", "100 100"));
    const headText = board(footprint(uuidA, "R1", "101 100"));
    write(baseText);
    const base = commit("base");
    const baseBlob = run("rev-parse", `${base}:${file}`);
    write(headText);
    const head = commit("head");
    const headBlob = run("rev-parse", `${head}:${file}`);
    write("malformed-uncommitted-content");

    const result = evidence(base, head);
    expect(result).toMatchObject({
      status: "complete",
      sourcePath: file,
      baseCommitSha: base,
      headCommitSha: head,
      baseBlobSha: baseBlob,
      headBlobSha: headBlob,
      riskAssessment: "not-evaluated",
      facts: {
        status: "complete",
        baseSourceSha256: createHash("sha256").update(baseText).digest("hex"),
        headSourceSha256: createHash("sha256").update(headText).digest("hex"),
        changes: [
          {
            sourceUuid: uuidA,
            status: "footprint-modified",
            changedFields: ["positionMm"],
            base: { positionMm: { x: 100, y: 100 } },
            head: { positionMm: { x: 101, y: 100 } },
          },
        ],
      },
    });
    expect(fs.readFileSync(path.join(root, file), "utf8")).toBe("malformed-uncommitted-content");
  });

  it("reports additions and removals only when both complete committed PCB sources exist", () => {
    write(board(footprint(uuidA, "R1", "1 2")));
    const base = commit("base");
    write(board(footprint(uuidB, "R2", "2 3")));
    const head = commit("head");
    const result = evidence(base, head);
    expect(result.status).toBe("complete");
    if (result.status !== "complete") return;
    expect(result.facts.changes.map((change) => [change.sourceUuid, change.status])).toEqual([
      [uuidA, "footprint-removed"],
      [uuidB, "footprint-added"],
    ]);
  });

  it("refuses missing revision, missing file and mismatched path instead of inventing a change", () => {
    run("commit", "--allow-empty", "-qm", "empty base");
    const absent = run("rev-parse", "HEAD");
    write(board(footprint(uuidA, "R1", "1 2")));
    const present = commit("has board");
    expect(evidence(absent, present)).toEqual({ status: "unavailable", reason: "base-source-missing" });
    expect(evidence(present, absent)).toEqual({ status: "unavailable", reason: "head-source-missing" });
    expect(evidence("nonexistent-ref", present)).toEqual({ status: "unavailable", reason: "unresolved-commit" });
    expect(evidence("--upload-pack=attacker", present)).toEqual({ status: "unavailable", reason: "unresolved-commit" });
    expect(evidence(present, present, "hardware/not-there.kicad_pcb")).toEqual({
      status: "unavailable",
      reason: "base-source-missing",
    });
  });

  it.each([
    "../secrets.kicad_pcb",
    "/tmp/absolute.kicad_pcb",
    "hardware/../secrets.kicad_pcb",
    "hardware//layout.kicad_pcb",
    "hardware/.git/payload.kicad_pcb",
    "hardware/./layout.kicad_pcb",
    "hardware\\layout.kicad_pcb",
    "hardware/pcb:kicad_pcb",
    "hardware/pcb\n.kicad_pcb",
    "hardware/readme.txt",
  ])("rejects unsafe or non-PCB Git source paths (%s)", (sourcePath) => {
    expect(evidence("main", "main", sourcePath)).toEqual({
      status: "unavailable",
      reason: "invalid-source-path",
    });
  });

  it("fails closed on malformed and duplicate UUID inventory without publishing partial facts", () => {
    write(board(footprint(uuidA, "R1", "1 2")));
    const base = commit("valid source");
    write(board(footprint(uuidA, "R1", "1 2"), footprint(uuidA, "R2", "3 4")));
    const duplicate = commit("duplicate UUID");
    expect(evidence(base, duplicate)).toEqual({
      status: "unavailable",
      side: "head",
      reason: "duplicate-uuid",
    });
    write("(kicad_pcb");
    const malformed = commit("malformed source");
    expect(evidence(duplicate, malformed)).toEqual({
      status: "unavailable",
      side: "base",
      reason: "duplicate-uuid",
    });
    expect(evidence(base, malformed)).toEqual({
      status: "unavailable",
      side: "head",
      reason: "malformed-source",
    });
  });

  it("produces stable evidence for the same committed files regardless of branch names", () => {
    write(board(footprint(uuidA, "R1", "1 2")));
    const base = commit("base");
    write(board(footprint(uuidA, "R1", "1 2"), footprint(uuidB, "R2", "3 4")));
    const head = commit("head");
    const fromRefs = evidence("HEAD~1", "HEAD");
    const fromHashes = evidence(base, head);
    expect(fromRefs).toEqual(fromHashes);
    expect(fromHashes).toMatchObject({ status: "complete", riskAssessment: "not-evaluated" });
  });
});
