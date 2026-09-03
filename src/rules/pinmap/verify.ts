import path from "node:path";
import { parseSchematic } from "../../kicad/schematic.js";
import { loadPinmap } from "../../pinmap/loader.js";
import { configuredSeverity, finding, rule, shouldRun } from "../helpers.js";
import { resolvePinmap, schematicNetGraph } from "./shared.js";

export const pinmapVerifyRule = rule(
  {
    id: "pinmap.verify",
    title: "Pinmap net is not present in schematic",
    description: "Checks configured pinmap nets against parsed schematic net labels.",
    rationale: "A pinmap that references absent nets cannot safely guide firmware integration.",
    defaultSeverity: "high",
    appliesTo: ["pinmap", "schematic"],
    configKeys: ["pinmap", "projects.pinmap"],
    kicadVersions: ["9", "10", "future"],
    tags: ["firmware", "pinmap", "schematic"],
    category: "electrical",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "none",
  },
  async (context) => {
    if (!shouldRun(context, "pinmap.verify")) {
      return [];
    }
    const pinmapPath = resolvePinmap(context);
    if (!pinmapPath) {
      return [];
    }
    const loaded = await loadPinmap(pinmapPath);
    const output = loaded.errors.map((error) =>
      finding(context, {
        ruleId: "pinmap.verify",
        severity: configuredSeverity(context, "pinmap.verify", "high"),
        message: `Pinmap could not be parsed: ${error}`,
        path: pinmapPath,
        kind: "pinmap",
        line: 1,
      }),
    );
    const graph = await schematicNetGraph(context);
    const labels = graph.visibleNetLabels;
    for (const missing of graph.missingSheets) {
      output.push(
        finding(context, {
          ruleId: "pinmap.verify",
          severity: configuredSeverity(context, "pinmap.verify", "high"),
          message: `Hierarchical sheet ${missing.fileName} referenced by ${path.relative(context.root, missing.parentFile)} was not found.`,
          path: path.relative(context.root, missing.parentFile),
          kind: "schematic",
          details: { ...missing },
        }),
      );
    }
    for (const unresolved of graph.unresolvedSheetPins) {
      output.push(
        finding(context, {
          ruleId: "pinmap.verify",
          severity: configuredSeverity(context, "pinmap.verify", "high"),
          message: `Sheet pin ${unresolved.pin} on ${path.relative(context.root, unresolved.parentFile)} has no matching hierarchical label in ${path.relative(context.root, unresolved.childFile)}.`,
          path: path.relative(context.root, unresolved.parentFile),
          kind: "schematic",
          details: { ...unresolved },
        }),
      );
    }
    for (const entry of loaded.document?.pins ?? []) {
      if (!labels.has(entry.net)) {
        output.push(
          finding(context, {
            ruleId: "pinmap.verify",
            severity: configuredSeverity(context, "pinmap.verify", "high"),
            message: `Pinmap net ${entry.net} for ${entry.designator}.${entry.pin} was not found in schematic labels.`,
            path: pinmapPath,
            kind: "pinmap",
            line: 1,
            details: { entry },
          }),
        );
      }
    }
    return output;
  },
);

export const pinmapCollisionRule = rule(
  {
    id: "pinmap.collision",
    title: "Pinmap contains duplicate pin or net entries",
    description: "Checks pinmap files for duplicate pin and net assignments.",
    rationale: "Pinmap collisions make hardware-to-firmware mappings ambiguous.",
    defaultSeverity: "high",
    appliesTo: ["pinmap"],
    configKeys: ["pinmap", "projects.pinmap"],
    kicadVersions: ["9", "10", "future"],
    tags: ["firmware", "pinmap", "validation"],
    category: "electrical",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "none",
  },
  async (context) => {
    if (!shouldRun(context, "pinmap.collision")) {
      return [];
    }
    const pinmapPath = resolvePinmap(context);
    if (!pinmapPath) {
      return [];
    }
    const loaded = await loadPinmap(pinmapPath);
    const seenPins = new Set<string>();
    const seenNets = new Set<string>();
    const output = [];
    for (const entry of loaded.document?.pins ?? []) {
      const pinKey = `${entry.designator}.${entry.pin}`;
      if (seenPins.has(pinKey) || seenNets.has(entry.net)) {
        output.push(
          finding(context, {
            ruleId: "pinmap.collision",
            severity: configuredSeverity(context, "pinmap.collision", "high"),
            message: `Pinmap collision for ${pinKey} / ${entry.net}.`,
            path: pinmapPath,
            kind: "pinmap",
            line: 1,
            details: { entry },
          }),
        );
      }
      seenPins.add(pinKey);
      seenNets.add(entry.net);
    }
    return output;
  },
);

export const pinmapUnmappedPinRule = rule(
  {
    id: "pinmap.unmapped-pin",
    title: "Connected schematic pin is missing from the pinmap",
    description: "Checks connected schematic pins for matching pinmap entries.",
    rationale: "Connected pins omitted from a pinmap leave firmware-facing interfaces undocumented.",
    defaultSeverity: "medium",
    appliesTo: ["pinmap", "schematic"],
    configKeys: ["pinmap", "projects.pinmap"],
    kicadVersions: ["9", "10", "future"],
    tags: ["firmware", "pinmap", "schematic"],
    category: "electrical",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "none",
  },
  async (context) => {
    if (!shouldRun(context, "pinmap.unmapped-pin")) {
      return [];
    }
    const pinmapPath = resolvePinmap(context);
    if (!pinmapPath) {
      return [];
    }
    const loaded = await loadPinmap(pinmapPath);
    const mapped = new Set((loaded.document?.pins ?? []).map((entry) => `${entry.designator}.${entry.pin}`));
    const output = [];
    for (const project of context.projects) {
      for (const schematic of project.schematicFiles) {
        const parsed = await parseSchematic(path.resolve(context.root, schematic));
        for (const pin of parsed.connectedPins) {
          const key = `${pin.designator}.${pin.pin}`;
          if (!mapped.has(key)) {
            output.push(
              finding(context, {
                ruleId: "pinmap.unmapped-pin",
                severity: configuredSeverity(context, "pinmap.unmapped-pin", "medium"),
                message: `${key} is connected to ${pin.net} but has no pinmap entry.`,
                path: schematic,
                kind: "schematic",
                details: pin,
              }),
            );
          }
        }
      }
    }
    return output;
  },
);
