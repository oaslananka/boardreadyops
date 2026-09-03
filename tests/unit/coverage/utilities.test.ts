import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadBom, parseDelimited } from "../../../src/bom/loader.js";
import { normalizeBomRows } from "../../../src/bom/normalizer.js";
import { isRuleEnabled, loadConfig, ruleConfig, ruleSeverity, validateConfig } from "../../../src/core/config.js";
import type { RuleContext } from "../../../src/core/context.js";
import { discoverProjects } from "../../../src/core/discovery.js";
import { createLogger } from "../../../src/core/logger.js";
import { runPipeline } from "../../../src/core/pipeline.js";
import { listRules, type Rule, registerRule } from "../../../src/core/rule-registry.js";
import { loadPinmap } from "../../../src/pinmap/loader.js";
import { readCsvPinmap } from "../../../src/pinmap/resolvers/csv.js";
import { readJsonPinmap } from "../../../src/pinmap/resolvers/json.js";
import { kicadSeverityToFindingSeverity } from "../../../src/rules/drc/severity-map.js";
import { configuredSeverity, filtered, globLike, refIgnored, shouldRun } from "../../../src/rules/helpers.js";
import { pinmapFormat } from "../../../src/rules/pinmap/format-detect.js";

describe("support utilities", () => {
  it("parses quoted delimited files and pinmap formats", async () => {
    expect(parseDelimited('Reference,Value\n"R1,R2","10k"\n')[0]?.Reference).toBe("R1,R2");
    expect(parseDelimited('Reference,Value\n"R1","10""k"\n')[0]?.Value).toBe('10"k');
    expect(parseDelimited("Reference,Value\nR1\n\n")[0]?.Value).toBe("");
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-pinmap-"));
    const tsvBom = path.join(temp, "bom.tsv");
    await fs.writeFile(tsvBom, "Reference\tMPN\tDNP\nR1\tABC-123\tno\n", "utf8");
    expect((await loadBom(tsvBom))[0]).toMatchObject({ reference: "R1", mpn: "ABC-123", dnp: false });
    const jsonFile = path.join(temp, "pins.json");
    const csvFile = path.join(temp, "pins.csv");
    await fs.writeFile(
      jsonFile,
      JSON.stringify({ version: 1, pins: [{ designator: "U1", pin: "1", net: "N1" }] }),
      "utf8",
    );
    await fs.writeFile(csvFile, "designator,pin,net,firmware\nU1,1,N1,gpio\n", "utf8");
    const invalidFile = path.join(temp, "invalid.json");
    await fs.writeFile(invalidFile, JSON.stringify({ version: 2, pins: [] }), "utf8");
    expect((await readJsonPinmap(jsonFile)).pins[0]?.net).toBe("N1");
    expect((await readCsvPinmap(csvFile)).pins[0]?.firmware).toBe("gpio");
    expect((await loadPinmap(jsonFile)).errors).toEqual([]);
    expect((await loadPinmap(csvFile)).errors).toEqual([]);
    expect((await loadPinmap(invalidFile)).errors.length).toBeGreaterThan(0);
    expect((await loadPinmap(path.join(temp, "missing.yml"))).errors.length).toBeGreaterThan(0);
    expect(pinmapFormat(jsonFile)).toBe("json");
    expect(pinmapFormat(csvFile)).toBe("csv");
    expect(pinmapFormat("pins.yml")).toBe("yaml");
  });

  it("covers pinmap CSV fallback headers and BOM normalization branches", async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-fallbacks-"));
    const designator = path.join(temp, "designator.csv");
    const ref = path.join(temp, "ref.csv");
    const upperRef = path.join(temp, "upper-ref.csv");
    const empty = path.join(temp, "empty.csv");
    await fs.writeFile(designator, "Designator,Pin,Net,Firmware\nU1,PA0,N1,gpio\n", "utf8");
    await fs.writeFile(ref, "ref,pin,net\nU2,PA1,N2\n", "utf8");
    await fs.writeFile(upperRef, "Ref,Pin,Net\nU3,PA2,N3\n", "utf8");
    await fs.writeFile(empty, "other\nvalue\n", "utf8");
    expect((await readCsvPinmap(designator)).pins[0]).toMatchObject({
      designator: "U1",
      pin: "PA0",
      net: "N1",
      firmware: "gpio",
    });
    expect((await readCsvPinmap(ref)).pins[0]).toMatchObject({ designator: "U2", pin: "PA1", net: "N2" });
    expect((await readCsvPinmap(upperRef)).pins[0]).toMatchObject({ designator: "U3", pin: "PA2", net: "N3" });
    expect((await readCsvPinmap(empty)).pins[0]).toMatchObject({ designator: "", pin: "", net: "" });

    const rows = normalizeBomRows(
      [
        { References: "R1 R2", Qty: "2", Populate: "no", Vendor: "DigiKey" },
        { References: "", Qty: "nan" },
        { Reference: "C1", DNP: "yes" },
      ],
      "bom.tsv",
    );
    expect(rows.map((row) => row.reference)).toEqual(["R1", "R2", "C1"]);
    expect(rows[0]?.quantity).toBe(2);
    expect(rows[0]?.dnp).toBe(false);
    expect(rows[0]?.suppliers).toEqual(["DigiKey"]);
    expect(rows[2]?.dnp).toBe(true);
  });

  it("maps KiCad severities and logs text/json", () => {
    expect(kicadSeverityToFindingSeverity("critical")).toBe("critical");
    expect(kicadSeverityToFindingSeverity("fatal")).toBe("critical");
    expect(kicadSeverityToFindingSeverity("error")).toBe("high");
    expect(kicadSeverityToFindingSeverity("warning")).toBe("medium");
    expect(kicadSeverityToFindingSeverity("other")).toBe("low");
    let text = "";
    const stream = {
      write(value: string) {
        text += value;
        return true;
      },
    } as NodeJS.WritableStream;
    createLogger("debug", false, stream).debug("debug", { a: 1 });
    createLogger("info", true, stream).info("json");
    createLogger("error", false, stream).warn("hidden");
    createLogger("error", false, stream).error("err");
    createLogger("silent", false, stream).error("silent");
    expect(text).toContain("debug");
    expect(text).toContain('"message":"json"');
    expect(text).toContain("err");
    expect(text).not.toContain("hidden");
    expect(text).not.toContain("silent");
  });

  it("covers config and discovery edge branches", async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-edge-"));
    expect(
      (await runPipeline({ path: temp, failOn: "never" })).findings.some(
        (finding) => finding.ruleId === "manifest.project-discovery",
      ),
    ).toBe(true);
    await fs.writeFile(path.join(temp, "edge.kicad_pro"), "{}", "utf8");
    const projects = await discoverProjects(temp, "edge.kicad_pro");
    expect(projects[0]?.boardFiles).toEqual([]);
    expect(validateConfig(false).length).toBeGreaterThan(0);
    expect(validateConfig({ version: 1, rules: { "x.y": true }, report: { json: false } })).toEqual([]);
    expect((await loadConfig(temp, "missing.yml")).errors.join("\n")).toContain("config file not found");
    await fs.writeFile(path.join(temp, "valid.yml"), "version: 1\nmode: enforce\n", "utf8");
    expect((await loadConfig(temp, "valid.yml")).config.mode).toBe("enforce");
    await fs.writeFile(path.join(temp, "broken.yml"), "version: [\n", "utf8");
    expect((await loadConfig(temp, "broken.yml")).errors.length).toBeGreaterThan(0);
    expect(isRuleEnabled({ version: 1, rules: { "x.y": false } }, "x.y")).toBe(false);
    expect(ruleSeverity({ version: 1, rules: { "x.y": { severity: "low" } } }, "x.y", "high")).toBe("low");
    expect(ruleConfig({ version: 1, rules: { "x.y": true } }, "x.y")).toEqual({});
  });

  it("covers rule helper filtering and matching branches", () => {
    const context = {
      root: process.cwd(),
      projects: [],
      config: { version: 1, rules: { "sample.rule": { severity: "medium" } } },
      options: { rules: ["other.rule"], skips: ["skipped.rule"] },
      logger: createLogger("silent"),
    } as unknown as RuleContext;
    expect(filtered(context, "sample.rule")).toBe(false);
    expect(shouldRun(context, "sample.rule")).toBe(false);
    expect(configuredSeverity(context, "sample.rule", "high")).toBe("medium");
    expect(refIgnored("TP1", undefined)).toBe(false);
    expect(refIgnored("TP1", ["TP*"])).toBe(true);
    expect(globLike("R?.*", "R?.1")).toBe(true);
  });

  it("rejects duplicate rule registration", async () => {
    const sample: Rule = {
      meta: {
        id: "sample.rule",
        title: "sample",
        description: "Synthetic rule.",
        rationale: "Exercises duplicate registration.",
        defaultSeverity: "info" as const,
        appliesTo: [],
        configKeys: [],
        kicadVersions: ["future"],
        tags: ["test"],
        category: "unclassified",
        evidenceType: "unclassified",
        fixability: "unclassified",
        vendorDependence: "unclassified",
      },
      run: async () => [],
    };
    registerRule(sample);
    expect(listRules().some((rule) => rule.meta.id === "sample.rule")).toBe(true);
    expect(() => registerRule(sample)).toThrow("Duplicate rule id");
    await runPipeline({ path: path.resolve("tests/fixtures/projects/safe-basic"), failOn: "never" });
  });
});
