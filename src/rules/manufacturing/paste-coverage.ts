import { type Severity, severityRankValue } from "../../core/findings.js";
import { RULE_CLASSIFICATIONS } from "../../core/rule-registry.js";
import type { PcbFootprint } from "../../kicad/pcb.js";
import type { LayerIdentitySummary } from "../../multicad/gerber-normalizer.js";
import { globFiles } from "../../util/glob.js";
import { configuredSeverity, finding, rule, shouldRun } from "../helpers.js";
import {
  assemblyFootprints,
  DEFAULT_GERBER_PATTERNS,
  footprintSide,
  loadGerberStackup,
  parsedBoards,
} from "./shared.js";

/**
 * A stencil is required by the side's *assembly*, not by the board existing.
 *
 * The side is decided from `PcbFootprint.mountType`, which is what separates an SMD pad from a
 * drilled one: a through-hole part is soldered from the underside of the board and needs no paste,
 * so a THT-only side is not a finding however thin the package is. Mount type `unknown` -- neither
 * pads nor `(attr ...)` stated one -- is not a synonym for through-hole. It is an absence of
 * evidence, and treating it as a negative is how a side of surface-mount parts ends up declared
 * paste-free. An unknown mount type therefore keeps the side in scope and is reported as unproven.
 *
 * The other half is whether the *package* can be believed to be missing a layer. Gerber X2 carries
 * `%TF.FileFunction,...*%` inside each file; where every artwork file states what it is, a package
 * with no paste layer for a side genuinely has no paste layer for it, and the finding may block.
 * Where any layer identity came from a filename, or a file in the package could not be placed at
 * all, the absence is an inference about names, so the finding is advisory: `manufacturing.
 * mask-coverage` makes the same distinction for the same reason, and the authority of a filename
 * is the argument #753 exists to settle.
 *
 * The cap is a deliberate override of a configured severity, so it is never applied quietly. The
 * finding says what is unproven instead of asserting the absence, reports `confidence: "low"`,
 * and carries `details.severityCapped` next to the severity that was configured. The alternative
 * -- honouring `severity: high` on an absence read from filenames -- is a false blocking verdict,
 * which is the one outcome the acceptance criteria for this issue rule out.
 *
 * Part of #770, split out as #848.
 */

const sides = ["top", "bottom"] as const;
type Side = (typeof sides)[number];

/** How many references of each mount type a side carries, which is what puts it in scope. */
interface SideAssembly {
  smd: string[];
  throughHole: string[];
  unknown: string[];
}

/** Enough references to name what was found without turning every finding into a parts list. */
const referenceSampleLimit = 20;

export const pasteCoverageRule = rule(
  {
    id: "manufacturing.paste-coverage",
    title: "An assembly side with SMT components has no solder paste layer",
    description:
      "Checks that each side carrying surface-mount assembly in the Gerber package has a matching solder paste layer.",
    rationale:
      "Surface-mount assembly requires a stencil layer to apply solder paste to pads before component placement. A missing layer may only block when every file in the package declares its own TF.FileFunction; otherwise the finding is advisory, its severity is capped at low, and the severity that was configured is reported in details.configuredSeverity.",
    defaultSeverity: "medium",
    appliesTo: ["pcb"],
    configKeys: ["rules.manufacturing.paste-coverage.enabled"],
    kicadVersions: ["9", "10", "future"],
    tags: ["assembly", "dfa", "fabrication", "gerber", "manufacturing", "paste"],
    ...RULE_CLASSIFICATIONS.manufacturabilityPresence,
  },
  async (context) => {
    if (!shouldRun(context, "manufacturing.paste-coverage")) {
      return [];
    }

    const files = await globFiles(context.root, DEFAULT_GERBER_PATTERNS);
    if (files.length === 0) {
      return [];
    }

    const boards = await parsedBoards(context);
    const footprints = boards.flatMap((board) => board.footprints);
    // A side with neither SMD parts nor an unproven mount type has nothing to stencil: through-hole
    // parts are soldered from the far side of the board, and a virtual footprint is not placed.
    const inScope = sides
      .map((side) => ({ side, evidence: sideAssembly(footprints, side) }))
      .filter(({ evidence }) => evidence.smd.length > 0 || evidence.unknown.length > 0);
    if (inScope.length === 0) {
      return [];
    }

    const { entries, stackup } = await loadGerberStackup(context.root, files);
    const identity = stackup.identity;
    const pasteLayers = stackup.layers.filter((layer) => layer.role === "solderpaste");
    const configured = configuredSeverity(context, "manufacturing.paste-coverage", "medium");

    const output = [];
    for (const { side, evidence } of inScope) {
      if (pasteLayers.some((layer) => layer.side === side)) continue;

      const reasons = unprovenReasons(evidence, identity, side);
      const blocking = reasons.length === 0;
      const severity = blocking ? configured : advisorySeverity(configured);
      output.push(
        finding(context, {
          ruleId: "manufacturing.paste-coverage",
          severity,
          message: coverageMessage(side, evidence, blocking),
          // The absence is read from the files when `blocking`, and is an inference about names
          // when it is not. Reporting it as equally certain either way is the reporting half of the
          // same mistake, so the finding carries the difference rather than leaving it in `details`.
          confidence: blocking ? "high" : "low",
          path: entries[0]?.filename ?? ".",
          kind: "pcb",
          details: {
            side,
            severity,
            configuredSeverity: configured,
            severityCapped: severity !== configured,
            blocking,
            rationale: blocking
              ? `Every Gerber file in the package declares TF.FileFunction, so the absence of a ${side} solder paste layer is read from the files.`
              : reasons.join(" "),
            smdFootprints: evidence.smd.length,
            throughHoleFootprints: evidence.throughHole.length,
            unknownMountTypeFootprints: evidence.unknown.length,
            smdReferences: evidence.smd.slice(0, referenceSampleLimit),
            unknownMountTypeReferences: evidence.unknown.slice(0, referenceSampleLimit),
            pasteLayers: pasteLayers.length,
            pasteLayerFiles: pasteLayers.map((layer) => layer.filename),
            layerIdentity: layerIdentity(identity),
            unidentifiedFiles: identity.unidentified,
            assumedIdentityFiles: identity.assumed,
          },
          fix: {
            description: `Export the ${side} solder paste layer (${side === "top" ? "F.Paste" : "B.Paste"}) and include it in the Gerber package.`,
            steps: [
              "In KiCad, open File > Fabrication Outputs > Gerbers.",
              `Tick ${side === "top" ? "F.Paste" : "B.Paste"} in the layer list.`,
              "Re-export and update the package.",
            ],
          },
        }),
      );
    }

    return output;
  },
);

/**
 * Splits a side's assembly footprints by mount type.
 *
 * `virtual` is dropped rather than filed as unknown: a footprint that declares itself virtual says
 * what it is, and a fixture or graphic is not a part a stencil applies paste to. A footprint whose
 * side cannot be read at all belongs to neither side and is left alone -- the same assembly-side
 * semantics `manufacturing.assembly-sides` uses, unchanged here.
 */
function sideAssembly(footprints: PcbFootprint[], side: Side): SideAssembly {
  const evidence: SideAssembly = { smd: [], throughHole: [], unknown: [] };
  for (const footprint of assemblyFootprints(footprints)) {
    if (footprintSide(footprint) !== side) continue;
    if (footprint.mountType === "smd") evidence.smd.push(footprint.reference);
    else if (footprint.mountType === "through_hole") evidence.throughHole.push(footprint.reference);
    else if (footprint.mountType !== "virtual") evidence.unknown.push(footprint.reference);
  }
  for (const references of [evidence.smd, evidence.throughHole, evidence.unknown]) {
    references.sort((left, right) => left.localeCompare(right));
  }
  return evidence;
}

/**
 * How much of the package's layer inventory the files themselves account for, as the three states
 * that are actually distinct.
 *
 * Collapsing them would lose the distinction a reader needs: a file this reader could not place at
 * all is a different problem to go and look at from a file it placed by name, and both were
 * reported as `"assumed"`, sending the reader to a file that was fine.
 */
function layerIdentity(identity: LayerIdentitySummary): "declared" | "assumed" | "unidentified" {
  if (identity.unidentified > 0) return "unidentified";
  // A package where nothing declared is the same evidence as a package where a filename was the
  // only thing to go on: with no declaration, `assumed` necessarily accounts for every file.
  if (identity.assumed > 0 || identity.declared === 0) return "assumed";
  return "declared";
}

/**
 * Why a missing paste layer may not be treated as established. Empty means both halves hold: the
 * side carries declared SMD parts, and the package's own files account for every layer in it.
 */
function unprovenReasons(evidence: SideAssembly, identity: LayerIdentitySummary, side: Side): string[] {
  const reasons: string[] = [];
  if (evidence.smd.length === 0) {
    reasons.push(
      `No footprint on the ${side} side states an SMD mount type, and ${evidence.unknown.length} of them state none at all, so whether that side needs a stencil is unproven.`,
    );
  }
  if (identity.unidentified > 0) {
    reasons.push(
      `${identity.unidentified} file(s) in the package are not a layer this reader can identify at all, and one of them may be the missing stencil.`,
    );
  } else if (identity.assumed > 0) {
    reasons.push(
      `${identity.assumed} layer(s) in the package are identified by filename alone, and a filename cannot prove that a layer is absent.`,
    );
  } else if (identity.declared === 0) {
    reasons.push(
      "No Gerber file in the package declares TF.FileFunction, so every layer identity rests on a filename.",
    );
  }
  return reasons;
}

/**
 * Says what the package looks like, which is not the same sentence either way round.
 *
 * "Lacks" is a statement about the files themselves. Asserting it of a package identified by
 * filename is the inference this rule exists not to make, so an unproven absence is reported as
 * not established rather than as absent, and the `details` carry which half of the evidence failed.
 */
function coverageMessage(side: Side, evidence: SideAssembly, blocking: boolean): string {
  if (evidence.smd.length === 0) {
    return `The board has ${evidence.unknown.length} assembly footprint(s) of unknown mount type on the ${side} side, so the Gerber package may be missing a ${side} solder paste stencil layer.`;
  }
  if (!blocking) {
    return `The board has SMT assembly on the ${side} side, but no ${side} solder paste layer could be established in the Gerber package, so the ${side} side may be missing a stencil.`;
  }
  return `The board has SMT assembly on the ${side} side, but the Gerber package lacks a ${side} solder paste stencil layer.`;
}

/**
 * The most a finding may carry when the evidence behind it is unproven.
 *
 * A configured `high` would turn an inference about filenames into a failing gate, which is the
 * failure mode that gets a manufacturing gate switched off for good. This is a deliberate override
 * of the configured severity, so it is reported rather than silent: the finding carries
 * `details.configuredSeverity` and `details.severityCapped` side by side with the severity it
 * settled on, `confidence: "low"` says which half of the evidence is missing, and the message says
 * the layer could not be established rather than asserting that it is absent.
 */
function advisorySeverity(configured: Severity): Severity {
  return severityRankValue(configured) > severityRankValue("low") ? "low" : configured;
}
