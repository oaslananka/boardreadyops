import fs from "node:fs/promises";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { releaseHandoffCommand } from "../../../src/cli/commands/release.js";
import {
  buildHandoffManifest,
  type HandoffProfileSummary,
  planHandoffPackage,
  renderHandoffReadme,
} from "../../../src/release/handoff.js";
import { writeFixture } from "../rules/helpers.js";

const profile: HandoffProfileSummary = {
  id: "jlcpcb",
  name: "JLCPCB",
  service: "fabrication+assembly",
  requiredOutputs: ["bom", "drill", "gerber", "position"],
  assumptions: ["service=fabrication+assembly"],
  caveats: ["Always confirm vendor capabilities before ordering."],
};

function collectStreams() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    streams: {
      stdout: { write: (text: string) => out.push(text) } as unknown as NodeJS.WritableStream,
      stderr: { write: (text: string) => err.push(text) } as unknown as NodeJS.WritableStream,
    },
  };
}

describe("manufacturer handoff package", () => {
  it("lays out files deterministically, dedupes sources, and reports missing outputs", () => {
    const plan = planHandoffPackage(
      {
        gerber: ["fab/board.gbl", "fab/board.gtl"],
        drill: ["fab/board.drl"],
        bom: ["fab/data.csv"],
        position: ["fab/data.csv"], // same source matched by two kinds; assigned once to the first required kind
        pdf: ["docs/drawing.pdf"],
        step: [],
      },
      profile,
    );

    expect(plan.files.map((file) => file.target)).toEqual([
      "bom/data.csv",
      "documentation/drawing.pdf",
      "drill/board.drl",
      "gerbers/board.gbl",
      "gerbers/board.gtl",
    ]);
    expect(plan.files.filter((file) => file.source === "fab/data.csv")).toHaveLength(1);
    expect(plan.includedOutputs).toEqual(["bom", "drill", "gerber", "pdf"]);
    expect(plan.missingOutputs).toEqual(["position"]);
  });

  it("marks the manifest decision ready only when no required output is missing", () => {
    const ready = planHandoffPackage(
      { gerber: ["a.gtl"], drill: ["a.drl"], bom: ["bom.csv"], position: ["cpl.csv"] },
      profile,
    );
    const manifest = buildHandoffManifest(profile, ready, [], "2026-06-22T00:00:00.000Z");
    expect(manifest.decision).toEqual({ status: "ready", missingOutputs: [] });
    expect(manifest.schemaVersion).toBe(1);

    const incomplete = planHandoffPackage({ gerber: ["a.gtl"] }, profile);
    expect(buildHandoffManifest(profile, incomplete, [], "2026-06-22T00:00:00.000Z").decision.status).toBe(
      "incomplete",
    );
  });

  it("renders a receiver README with contents and missing-output warnings", () => {
    const plan = planHandoffPackage({ gerber: ["a.gtl"] }, profile);
    const readme = renderHandoffReadme(profile, plan, "2026-06-22T00:00:00.000Z");
    expect(readme).toContain("# JLCPCB manufacturer handoff package");
    expect(readme).toContain("| gerber | `gerbers/a.gtl` |");
    expect(readme).toContain("## Missing required outputs");
    expect(readme).toContain("- bom");
  });

  it("writes a complete JLCPCB package and exits 0 when all required outputs are present", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "fab/board.gtl": "gerber-top",
      "fab/board.gbl": "gerber-bottom",
      "fab/board.drl": "drill",
      "fab/bom.csv": "Designator,MPN\nU1,ABC\n",
      "fab/positions.csv": "Designator,Mid X,Mid Y\nU1,1,2\n",
    });
    const { out, streams } = collectStreams();

    const code = await releaseHandoffCommand(root, { output: "handoff" }, streams);

    expect(code).toBe(0);
    const manifest = JSON.parse(await fs.readFile(path.join(root, "handoff", "handoff-manifest.json"), "utf8"));
    expect(manifest.vendor.id).toBe("jlcpcb");
    expect(manifest.decision.status).toBe("ready");
    expect(manifest.files.every((file: { sha256: string }) => /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true);
    await expect(fs.readFile(path.join(root, "handoff", "README.md"), "utf8")).resolves.toContain(
      "manufacturer handoff package",
    );
    await expect(fs.readFile(path.join(root, "handoff", "gerbers", "board.gtl"), "utf8")).resolves.toBe("gerber-top");
    expect(out.join("")).toContain("status: ready");
  });

  it("excludes its own output directory so re-runs stay idempotent", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "fab/board.gtl": "gerber-top",
      "fab/board.drl": "drill",
      "fab/bom.csv": "Designator,MPN\nU1,ABC\n",
      "fab/positions.csv": "Designator,Mid X,Mid Y\nU1,1,2\n",
    });
    const first = collectStreams();
    await releaseHandoffCommand(root, { output: "handoff" }, first.streams);
    const firstCount = JSON.parse(await fs.readFile(path.join(root, "handoff", "handoff-manifest.json"), "utf8")).files
      .length;

    const second = collectStreams();
    await releaseHandoffCommand(root, { output: "handoff" }, second.streams);
    const secondCount = JSON.parse(await fs.readFile(path.join(root, "handoff", "handoff-manifest.json"), "utf8")).files
      .length;

    expect(secondCount).toBe(firstCount);
  });

  it("exits 1 and reports missing outputs when required outputs are absent", async () => {
    const root = await writeFixture({ "board.kicad_pro": "{}", "fab/board.gtl": "gerber-top" });
    const { out, streams } = collectStreams();

    const code = await releaseHandoffCommand(root, { output: "handoff" }, streams);

    expect(code).toBe(1);
    expect(out.join("")).toContain("Missing required outputs: bom, drill, position");
  });

  it("rejects an unknown vendor profile", async () => {
    const root = await writeFixture({ "board.kicad_pro": "{}" });
    const { err, streams } = collectStreams();

    const code = await releaseHandoffCommand(root, { profile: "nope" }, streams);

    expect(code).toBe(2);
    expect(err.join("")).toContain("Unknown vendor profile: nope");
  });
});

describe("release-manifest.schema.json", () => {
  it("validates a well-formed handoff manifest", async () => {
    const schemaPath = path.resolve("schemas/release-manifest.schema.json");
    const schema = JSON.parse(await fs.readFile(schemaPath, "utf8"));
    const ajv = new Ajv2020({ strict: true });

    const plan = planHandoffPackage(
      { gerber: ["fab/board.gtl"], drill: ["fab/board.drl"], bom: ["fab/bom.csv"], position: ["fab/cpl.csv"] },
      profile,
    );
    const files = plan.files.map((file) => ({ ...file, sha256: "a".repeat(64), bytes: 100 }));
    const manifest = buildHandoffManifest(profile, plan, files, "2026-06-22T00:00:00.000Z");

    const validate = ajv.compile(schema);
    const valid = validate(manifest);
    if (!valid) {
      throw new Error(`Schema validation failed: ${JSON.stringify(validate.errors, null, 2)}`);
    }
    expect(valid).toBe(true);
  });
});
