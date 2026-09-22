import path from "node:path";
import { RULE_CLASSIFICATIONS } from "../../core/rule-registry.js";
import { parseGerber } from "../../multicad/gerber-parser.js";
import { readTextFile } from "../../util/fs.js";
import { globFiles } from "../../util/glob.js";
import { findVendorProfile } from "../../vendor/profiles.js";
import { configFor, configuredSeverity, finding, rule, shouldRun } from "../helpers.js";
import { DEFAULT_GERBER_PATTERNS } from "./shared.js";

export const boardEdgeClearanceRule = rule(
  {
    id: "manufacturing.board-edge-clearance",
    title: "Copper features are too close to the board edge",
    description:
      "Checks that copper features in the Gerber package maintain the required minimum clearance from the board edge.",
    rationale:
      "Copper placed too close to the PCB boundary risks exposure, burrs, or shorts during board routing or V-scoring.",
    defaultSeverity: "medium",
    appliesTo: ["pcb"],
    configKeys: [
      "rules.manufacturing.board-edge-clearance.enabled",
      "rules.manufacturing.board-edge-clearance.min-clearance-mm",
    ],
    kicadVersions: ["9", "10", "future"],
    tags: ["dfm", "fabrication", "gerber", "manufacturing", "pcb"],
    ...RULE_CLASSIFICATIONS.manufacturabilityVendorProfile,
  },
  async (context) => {
    if (!shouldRun(context, "manufacturing.board-edge-clearance")) {
      return [];
    }

    const files = await globFiles(context.root, DEFAULT_GERBER_PATTERNS);
    if (files.length === 0) {
      return [];
    }

    const parsedFiles = await Promise.all(
      files.map(async (file) => {
        const relativePath = path.relative(context.root, file);
        const content = await readTextFile(file).catch(() => "");
        const parsed = parseGerber(content, relativePath);
        return { path: relativePath, parsed };
      }),
    );

    const vendorId = typeof context.config.vendor === "string" ? context.config.vendor : context.config.vendor?.profile;
    const profile = findVendorProfile(vendorId) ?? findVendorProfile("generic-prototype");
    const ruleConfig = configFor(context, "manufacturing.board-edge-clearance");
    const configuredMin =
      typeof ruleConfig["min-clearance-mm"] === "number" ? ruleConfig["min-clearance-mm"] : undefined;
    const minClearanceMm = configuredMin ?? profile?.fabrication?.minBoardEdgeClearanceMm ?? 0.2;

    const outlineFile = parsedFiles.find(
      (item) => item.parsed.identity?.role === "outline" || item.path.endsWith(".gko") || item.path.endsWith(".gm1"),
    );

    const output = [];

    if (!outlineFile?.parsed.boundingBoxMm || outlineFile.parsed.openContourCount > 0) {
      output.push(
        finding(context, {
          ruleId: "manufacturing.board-edge-clearance",
          severity: configuredSeverity(context, "manufacturing.board-edge-clearance", "medium"),
          message: "Cannot verify board edge clearance because the Gerber board outline is missing or open.",
          path: parsedFiles[0]?.path ?? ".",
          kind: "pcb",
          details: {
            confidence: "unknown",
            outlineClosed: Boolean(outlineFile?.parsed.hasClosedContour && outlineFile.parsed.openContourCount === 0),
            minClearanceMm,
            profileRevision: profile?.provenance.revision ?? "v1",
            profileSource: profile?.provenance.source ?? "default",
            verifiedAt: profile?.provenance.verifiedAt ?? null,
          },
        }),
      );
      return output;
    }

    const outlineBox = outlineFile.parsed.boundingBoxMm;
    const copperFiles = parsedFiles.filter(
      (item) =>
        item.parsed.identity?.role === "copper" ||
        item.path.endsWith(".gtl") ||
        item.path.endsWith(".gbl") ||
        item.path.endsWith(".gbr"),
    );

    for (const copper of copperFiles) {
      if (!copper.parsed.boundingBoxMm) continue;

      const left = copper.parsed.boundingBoxMm.minX - outlineBox.minX;
      const right = outlineBox.maxX - copper.parsed.boundingBoxMm.maxX;
      const bottom = copper.parsed.boundingBoxMm.minY - outlineBox.minY;
      const top = outlineBox.maxY - copper.parsed.boundingBoxMm.maxY;

      const minMeasured = Math.min(left, right, bottom, top);
      if (minMeasured < minClearanceMm) {
        output.push(
          finding(context, {
            ruleId: "manufacturing.board-edge-clearance",
            severity: configuredSeverity(context, "manufacturing.board-edge-clearance", "medium"),
            message: `Copper layer ${copper.path} clearance to board edge is ${minMeasured.toFixed(3)}mm, which is below the required ${minClearanceMm}mm.`,
            path: copper.path,
            kind: "pcb",
            details: {
              measuredClearanceMm: Number(minMeasured.toFixed(3)),
              minClearanceMm,
              confidence: "exact",
              filename: copper.path,
              profileRevision: profile?.provenance.revision ?? "v1",
              profileSource: profile?.provenance.source ?? "default",
              verifiedAt: profile?.provenance.verifiedAt ?? null,
            },
            fix: {
              description: `Pull copper features back at least ${minClearanceMm}mm from the board outline on ${copper.path}.`,
              steps: [
                "Open PCB Editor in KiCad.",
                `Inspect copper fills and tracks near Edge.Cuts on layer ${copper.path}.`,
                `Set copper clearance to Edge.Cuts to at least ${minClearanceMm}mm in Board Setup > Design Rules.`,
                "Re-fill copper zones and re-export Gerber files.",
              ],
            },
          }),
        );
      }
    }

    return output;
  },
);
