interface VendorEvidenceRequirement {
  output: "gerber" | "drill" | "bom" | "position" | "pdf" | "step";
  requiredFor: "fabrication" | "assembly" | "documentation";
  rationale: string;
  importance?: "required" | "recommended" | undefined;
}

interface VendorBoardAssumptions {
  layers?: number[] | undefined;
  thicknessMm?: number[] | undefined;
  finish?: string[] | undefined;
}

interface VendorAssemblyAssumptions {
  sides?: Array<"top" | "bottom" | "both"> | undefined;
  requiresFiducials?: boolean | undefined;
}

interface VendorFabricationLimits {
  minTrackMm?: number | undefined;
  minSpaceMm?: number | undefined;
  minDrillMm?: number | undefined;
  minAnnularRingMm?: number | undefined;
  minBoardEdgeClearanceMm?: number | undefined;
  maxLayers?: number | undefined;
}

/**
 * How much a profile's capability values can be trusted, and on what basis.
 *
 * Without this a profile is nine numbers in a TypeScript file, and "is this board ready for
 * JLCPCB?" means "does it satisfy some values a developer typed at an unknown time from an
 * unrecorded source". That answer cannot carry a production decision, and #754 makes the point
 * that a stale profile which *looks* authoritative is worse than an honest one.
 *
 * `source`, `verifiedAt` and `verifiedBy` are optional because for the profiles shipped today
 * there is no truthful value to put in them. Inventing a verification date would fabricate the
 * very record this type exists to provide.
 */
/*
 * Not exported: `VendorProfile` and `vendorProfileAssurance` name it, and no external author
 * constructs a profile today -- `VendorProfileConfig` has no provenance field. Export it when a
 * caller exists, per #752.
 */
interface VendorProfileProvenance {
  /** Bumped whenever a capability value changes, so a release can cite the profile it was judged against. */
  revision: string;
  /**
   * - "verified": a person checked these values against the vendor's published capabilities on `verifiedAt`.
   * - "derived": computed from observed outcomes -- accepted and rejected packages -- rather than a document.
   * - "unverified": entered from an unrecorded source at an unknown time. Advisory only.
   */
  confidence: "verified" | "derived" | "unverified";
  /** The vendor capability page, quote, or document the values came from. */
  source?: string | undefined;
  /** ISO date a person last checked `source` against these values. */
  verifiedAt?: string | undefined;
  /** Who checked. A profile with a `verifiedAt` and nobody attached to it is not verified. */
  verifiedBy?: string | undefined;
}

/**
 * What the profiles in this file carry today.
 *
 * Every value here was typed into source from a vendor page at some point nobody recorded. That
 * is worth stating rather than dressing up: a rule may cite these numbers, and it may warn on
 * them, but nothing should block a production release on a capability limit whose provenance is
 * "someone wrote it down". Replacing this with a real `verified` provenance is per-profile work
 * that needs a person and a date, not a code change.
 */
const unverifiedProvenance: VendorProfileProvenance = {
  revision: "unverified-0",
  confidence: "unverified",
};

/** Beyond this, a verified profile is old enough that the vendor may have changed capability. */
const stalenessHorizonDays = 180;

export type VendorProfileAssurance =
  | { state: "verified"; ageDays: number; mayBlock: true }
  | { state: "stale"; ageDays: number; mayBlock: false }
  | { state: "unverified"; mayBlock: false };

/**
 * Whether a profile's values are current enough to stop a release.
 *
 * `mayBlock` is the field that matters, and it is false in two of the three states. A finding
 * derived from an unverified or lapsed capability limit can be wrong about a board that is fine,
 * and two of those and a team switches the gate off -- after which every other check here is
 * worth nothing.
 */
export function vendorProfileAssurance(profile: VendorProfile, now: Date = new Date()): VendorProfileAssurance {
  const { confidence, verifiedAt, verifiedBy } = profile.provenance;
  if (confidence === "unverified" || !verifiedAt || !verifiedBy) return { state: "unverified", mayBlock: false };

  const verified = new Date(verifiedAt);
  if (Number.isNaN(verified.getTime())) return { state: "unverified", mayBlock: false };

  const ageDays = Math.floor((now.getTime() - verified.getTime()) / 86_400_000);
  return ageDays > stalenessHorizonDays
    ? { state: "stale", ageDays, mayBlock: false }
    : { state: "verified", ageDays, mayBlock: true };
}

export interface VendorProfile {
  id: string;
  name: string;
  service: "fabrication" | "assembly" | "fabrication+assembly";
  summary: string;
  evidence: VendorEvidenceRequirement[];
  board?: VendorBoardAssumptions | undefined;
  assembly?: VendorAssemblyAssumptions | undefined;
  fabrication?: VendorFabricationLimits | undefined;
  caveats: string[];
  provenance: VendorProfileProvenance;
}

export interface VendorProfileConfig {
  profile?: string | undefined;
  service?: "fabrication" | "assembly" | "fabrication+assembly" | undefined;
  required?: string[] | undefined;
  board?: VendorBoardAssumptions | undefined;
  assembly?: VendorAssemblyAssumptions | undefined;
  fabrication?: VendorFabricationLimits | undefined;
}

export interface ResolvedVendorProfile {
  profile: VendorProfile;
  requiredOutputs: string[];
  recommendedOutputs: string[];
  assumptions: string[];
}

const profiles: VendorProfile[] = [
  {
    id: "jlcpcb",
    name: "JLCPCB",
    service: "fabrication+assembly",
    summary: "Conservative profile for JLCPCB PCB fabrication and SMT assembly handoff packages.",
    evidence: [
      {
        output: "gerber",
        requiredFor: "fabrication",
        rationale: "Fabrication requires complete Gerber layer outputs.",
      },
      {
        output: "drill",
        requiredFor: "fabrication",
        rationale: "Drill files are required to manufacture plated and non-plated holes.",
      },
      {
        output: "bom",
        requiredFor: "assembly",
        rationale: "Assembly review requires a BOM with populated manufacturer part data.",
      },
      { output: "position", requiredFor: "assembly", rationale: "SMT assembly requires component placement/CPL data." },
      {
        output: "pdf",
        requiredFor: "documentation",
        importance: "recommended",
        rationale: "An assembly drawing or fabrication PDF helps the reviewer confirm intent.",
      },
      {
        output: "step",
        requiredFor: "documentation",
        importance: "recommended",
        rationale: "A STEP model helps verify mechanical fit and component placement.",
      },
    ],
    board: { layers: [2, 4, 6], thicknessMm: [1.0, 1.2, 1.6], finish: ["HASL", "ENIG"] },
    assembly: { sides: ["top", "bottom", "both"], requiresFiducials: true },
    fabrication: {
      minTrackMm: 0.15,
      minSpaceMm: 0.15,
      minDrillMm: 0.3,
      minAnnularRingMm: 0.13,
      minBoardEdgeClearanceMm: 0.2,
      maxLayers: 6,
    },
    provenance: unverifiedProvenance,
    caveats: [
      "This profile validates package evidence only; always confirm current vendor capabilities before ordering.",
    ],
  },
  {
    id: "pcbway",
    name: "PCBWay",
    service: "fabrication+assembly",
    summary: "Conservative profile for PCBWay fabrication plus assembly evidence packages.",
    evidence: [
      { output: "gerber", requiredFor: "fabrication", rationale: "Fabrication requires current Gerber outputs." },
      { output: "drill", requiredFor: "fabrication", rationale: "Drill outputs are required for board fabrication." },
      { output: "bom", requiredFor: "assembly", rationale: "Assembly quote/review needs a BOM." },
      { output: "position", requiredFor: "assembly", rationale: "Assembly quote/review needs pick-and-place data." },
      {
        output: "pdf",
        requiredFor: "documentation",
        rationale: "A drawing or stackup PDF helps reviewers confirm fabrication assumptions.",
      },
      {
        output: "step",
        requiredFor: "documentation",
        importance: "recommended",
        rationale: "A STEP model helps verify mechanical fit before assembly.",
      },
    ],
    board: { layers: [2, 4, 6, 8], thicknessMm: [1.0, 1.2, 1.6, 2.0], finish: ["HASL", "ENIG", "OSP"] },
    assembly: { sides: ["top", "bottom", "both"], requiresFiducials: true },
    fabrication: {
      minTrackMm: 0.15,
      minSpaceMm: 0.15,
      minDrillMm: 0.3,
      minAnnularRingMm: 0.13,
      minBoardEdgeClearanceMm: 0.25,
      maxLayers: 8,
    },
    provenance: unverifiedProvenance,
    caveats: ["Profile defaults are intentionally conservative and should be overridden for the exact service tier."],
  },
  {
    id: "oshpark",
    name: "OSH Park",
    service: "fabrication",
    summary: "Conservative profile for OSH Park fabrication-only release packages.",
    evidence: [
      { output: "gerber", requiredFor: "fabrication", rationale: "Fabrication requires board layer Gerbers." },
      { output: "drill", requiredFor: "fabrication", rationale: "Fabrication requires drill data for holes and vias." },
      {
        output: "pdf",
        requiredFor: "documentation",
        importance: "recommended",
        rationale: "A fabrication drawing PDF documents stackup and finish expectations.",
      },
    ],
    board: { layers: [2, 4], thicknessMm: [0.8, 1.6], finish: ["ENIG"] },
    fabrication: {
      minTrackMm: 0.15,
      minSpaceMm: 0.15,
      minDrillMm: 0.25,
      minAnnularRingMm: 0.13,
      minBoardEdgeClearanceMm: 0.25,
      maxLayers: 4,
    },
    provenance: unverifiedProvenance,
    caveats: ["OSH Park is treated as fabrication-only; assembly evidence is not required by this profile."],
  },
  {
    id: "aisler",
    name: "Aisler",
    service: "fabrication+assembly",
    summary: "Conservative profile for Aisler fabrication and assembly evidence packages.",
    evidence: [
      { output: "gerber", requiredFor: "fabrication", rationale: "Fabrication requires complete Gerber outputs." },
      { output: "drill", requiredFor: "fabrication", rationale: "Fabrication requires drill data." },
      { output: "bom", requiredFor: "assembly", rationale: "Assembly review requires a populated BOM." },
      { output: "position", requiredFor: "assembly", rationale: "Assembly review requires component placement data." },
      {
        output: "pdf",
        requiredFor: "documentation",
        importance: "recommended",
        rationale: "A drawing PDF helps reviewers confirm stackup and assembly intent.",
      },
    ],
    board: { layers: [2, 4], thicknessMm: [1.0, 1.6], finish: ["ENIG", "HAL lead-free"] },
    assembly: { sides: ["top", "bottom", "both"], requiresFiducials: true },
    fabrication: {
      minTrackMm: 0.15,
      minSpaceMm: 0.15,
      minDrillMm: 0.3,
      minAnnularRingMm: 0.15,
      minBoardEdgeClearanceMm: 0.25,
      maxLayers: 4,
    },
    provenance: unverifiedProvenance,
    caveats: ["Use project overrides for exact Aisler pool/service constraints before ordering."],
  },
  {
    id: "seeed-fusion",
    name: "Seeed Fusion",
    service: "fabrication+assembly",
    summary: "Conservative profile for Seeed Fusion PCB fabrication and assembly handoff packages.",
    evidence: [
      { output: "gerber", requiredFor: "fabrication", rationale: "Fabrication requires Gerber layer outputs." },
      { output: "drill", requiredFor: "fabrication", rationale: "Fabrication requires drill files." },
      { output: "bom", requiredFor: "assembly", rationale: "Assembly review requires a BOM." },
      { output: "position", requiredFor: "assembly", rationale: "Assembly review requires pick-and-place data." },
      {
        output: "step",
        requiredFor: "documentation",
        importance: "recommended",
        rationale: "A STEP model helps reviewers check mechanical fit.",
      },
    ],
    board: { layers: [2, 4, 6], thicknessMm: [0.8, 1.0, 1.2, 1.6], finish: ["HASL", "ENIG", "OSP"] },
    assembly: { sides: ["top", "bottom", "both"], requiresFiducials: true },
    fabrication: {
      minTrackMm: 0.15,
      minSpaceMm: 0.15,
      minDrillMm: 0.3,
      minAnnularRingMm: 0.13,
      minBoardEdgeClearanceMm: 0.25,
      maxLayers: 6,
    },
    provenance: unverifiedProvenance,
    caveats: ["Profile limits are conservative defaults; override them for Seeed Fusion advanced capabilities."],
  },
  {
    id: "eurocircuits",
    name: "Eurocircuits",
    service: "fabrication",
    summary: "Conservative profile for Eurocircuits fabrication evidence packages.",
    evidence: [
      { output: "gerber", requiredFor: "fabrication", rationale: "Fabrication requires layer artwork outputs." },
      { output: "drill", requiredFor: "fabrication", rationale: "Fabrication requires drill outputs." },
      {
        output: "pdf",
        requiredFor: "documentation",
        rationale: "Fabrication drawings document stackup, finish, and controlled assumptions.",
      },
    ],
    board: { layers: [2, 4, 6, 8], thicknessMm: [0.8, 1.0, 1.55, 1.6, 2.0], finish: ["ENIG", "HAL lead-free"] },
    fabrication: {
      minTrackMm: 0.15,
      minSpaceMm: 0.15,
      minDrillMm: 0.3,
      minAnnularRingMm: 0.15,
      minBoardEdgeClearanceMm: 0.25,
      maxLayers: 8,
    },
    provenance: unverifiedProvenance,
    caveats: ["Treat as fabrication-only unless a separate assembly profile is selected."],
  },
  {
    id: "generic-prototype",
    name: "Generic Prototype Fab",
    service: "fabrication",
    summary:
      "Minimal evidence preset for fast prototype fabrication. Requires only Gerbers and drill files; BOM and documentation are recommended but not required.",
    evidence: [
      {
        output: "gerber",
        requiredFor: "fabrication",
        rationale: "Fabrication requires Gerber layer artwork to produce PCB copper layers.",
      },
      {
        output: "drill",
        requiredFor: "fabrication",
        rationale: "Drill files define hole sizes and locations for all plated and non-plated holes.",
      },
      {
        output: "bom",
        requiredFor: "documentation",
        importance: "recommended",
        rationale: "A BOM is recommended even for prototypes to facilitate sourcing review.",
      },
      {
        output: "pdf",
        requiredFor: "documentation",
        importance: "recommended",
        rationale: "Assembly or fabrication drawings help catch stackup and finish issues early.",
      },
    ],
    provenance: unverifiedProvenance,
    caveats: [
      "Generic preset — not tuned to a specific vendor. Select a named vendor profile for production.",
      "Recommended outputs (BOM, PDF) are surfaced as warnings only.",
    ],
  },
  {
    id: "generic-assembly-ready",
    name: "Generic Assembly-Ready Package",
    service: "fabrication+assembly",
    summary:
      "Evidence preset for a complete fabrication and assembly handoff. Requires Gerbers, drill, BOM, and CPL/position; STEP and documentation are recommended.",
    evidence: [
      {
        output: "gerber",
        requiredFor: "fabrication",
        rationale: "Assembly-ready packages require complete Gerber layer artwork for board fabrication.",
      },
      {
        output: "drill",
        requiredFor: "fabrication",
        rationale: "Assembly-ready packages require drill files covering all plated and non-plated holes.",
      },
      {
        output: "bom",
        requiredFor: "assembly",
        rationale: "Assembly review requires a BOM with manufacturer part data for component sourcing.",
      },
      {
        output: "position",
        requiredFor: "assembly",
        rationale: "SMT assembly requires a CPL/position file mapping designators to placement coordinates.",
      },
      {
        output: "step",
        requiredFor: "documentation",
        importance: "recommended",
        rationale: "A STEP model enables mechanical interference and fit checks.",
      },
      {
        output: "pdf",
        requiredFor: "documentation",
        importance: "recommended",
        rationale: "Fabrication and assembly drawings document stackup, finish, and controlled assumptions.",
      },
    ],
    provenance: unverifiedProvenance,
    caveats: [
      "Generic preset — not tuned to a specific vendor. Select a named vendor profile for production.",
      "STEP and PDF are recommended; their absence lowers the readiness score but does not block.",
    ],
  },
  {
    id: "generic-production",
    name: "Generic Production Fab",
    service: "fabrication+assembly",
    summary:
      "Comprehensive evidence preset for production releases. Requires Gerbers, drill, BOM, CPL/position, STEP, and documentation PDF.",
    evidence: [
      {
        output: "gerber",
        requiredFor: "fabrication",
        rationale: "Production fabrication requires complete, reviewed Gerber outputs.",
      },
      {
        output: "drill",
        requiredFor: "fabrication",
        rationale: "Production drill files must cover all plated and non-plated holes.",
      },
      {
        output: "bom",
        requiredFor: "assembly",
        rationale: "Production assembly requires a fully reviewed BOM with approved part numbers.",
      },
      {
        output: "position",
        requiredFor: "assembly",
        rationale: "Production SMT assembly requires a validated CPL/position file.",
      },
      {
        output: "step",
        requiredFor: "documentation",
        rationale: "A STEP model is required for production mechanical integration and DFM review.",
      },
      {
        output: "pdf",
        requiredFor: "documentation",
        rationale:
          "Production fabrication and assembly drawings are required to document controlled assumptions and sign-off.",
      },
    ],
    fabrication: {
      minTrackMm: 0.1,
      minSpaceMm: 0.1,
      minDrillMm: 0.2,
      minAnnularRingMm: 0.1,
      minBoardEdgeClearanceMm: 0.2,
    },
    provenance: unverifiedProvenance,
    caveats: [
      "Generic preset — not tuned to a specific vendor. Select a named vendor profile for your manufacturer.",
      "All evidence kinds are required; missing any item blocks the release readiness score.",
    ],
  },
];

export function listVendorProfiles(): VendorProfile[] {
  return profiles.map((profile) => cloneProfile(profile));
}

export function findVendorProfile(id: string | undefined): VendorProfile | undefined {
  if (!id) {
    return undefined;
  }
  const normalized = id.trim().toLowerCase();
  const profile = profiles.find(
    (candidate) => candidate.id === normalized || candidate.name.toLowerCase() === normalized,
  );
  return profile ? cloneProfile(profile) : undefined;
}

export function resolveVendorProfile(config: VendorProfileConfig | undefined): ResolvedVendorProfile | undefined {
  const profile = findVendorProfile(config?.profile);
  if (!profile) {
    return undefined;
  }
  const service = config?.service ?? profile.service;
  const requiredOutputs = new Set<string>();
  const recommendedOutputs = new Set<string>();
  for (const requirement of profile.evidence) {
    if (!serviceMatches(service, requirement.requiredFor)) {
      continue;
    }
    if (requirement.importance === "recommended") {
      recommendedOutputs.add(requirement.output);
    } else {
      requiredOutputs.add(requirement.output);
    }
  }
  for (const output of config?.required ?? []) {
    if (output.trim().length > 0) {
      requiredOutputs.add(output.trim());
    }
  }
  // A user-required output overrides any recommended classification.
  for (const output of requiredOutputs) {
    recommendedOutputs.delete(output);
  }
  const assumptions = [...profile.caveats, ...formatAssumptions(config ?? profileConfigFromProfile(profile))];
  return {
    profile,
    requiredOutputs: [...requiredOutputs].sort(),
    recommendedOutputs: [...recommendedOutputs].sort(),
    assumptions,
  };
}

function serviceMatches(
  service: NonNullable<VendorProfileConfig["service"]>,
  requiredFor: VendorEvidenceRequirement["requiredFor"],
): boolean {
  return requiredFor === "documentation" || service === "fabrication+assembly" || service === requiredFor;
}

function profileConfigFromProfile(profile: VendorProfile): VendorProfileConfig {
  return {
    profile: profile.id,
    service: profile.service,
    board: profile.board,
    assembly: profile.assembly,
    fabrication: profile.fabrication,
  };
}

function formatAssumptions(config: VendorProfileConfig): string[] {
  const output: string[] = [];
  if (config.service) {
    output.push(`service=${config.service}`);
  }
  if (config.board?.layers?.length) {
    output.push(`layers=${config.board.layers.join("/")}`);
  }
  if (config.board?.thicknessMm?.length) {
    output.push(`thicknessMm=${config.board.thicknessMm.join("/")}`);
  }
  if (config.board?.finish?.length) {
    output.push(`finish=${config.board.finish.join("/")}`);
  }
  if (config.assembly?.sides?.length) {
    output.push(`assemblySides=${config.assembly.sides.join("/")}`);
  }
  if (config.assembly?.requiresFiducials !== undefined) {
    output.push(`requiresFiducials=${config.assembly.requiresFiducials}`);
  }
  if (config.fabrication?.minTrackMm !== undefined) {
    output.push(`minTrackMm=${config.fabrication.minTrackMm}`);
  }
  if (config.fabrication?.minSpaceMm !== undefined) {
    output.push(`minSpaceMm=${config.fabrication.minSpaceMm}`);
  }
  if (config.fabrication?.minDrillMm !== undefined) {
    output.push(`minDrillMm=${config.fabrication.minDrillMm}`);
  }
  if (config.fabrication?.minAnnularRingMm !== undefined) {
    output.push(`minAnnularRingMm=${config.fabrication.minAnnularRingMm}`);
  }
  if (config.fabrication?.minBoardEdgeClearanceMm !== undefined) {
    output.push(`minBoardEdgeClearanceMm=${config.fabrication.minBoardEdgeClearanceMm}`);
  }
  if (config.fabrication?.maxLayers !== undefined) {
    output.push(`maxLayers=${config.fabrication.maxLayers}`);
  }
  return output;
}

function cloneProfile(profile: VendorProfile): VendorProfile {
  return {
    ...profile,
    evidence: profile.evidence.map((entry) => ({ ...entry })),
    ...(profile.board
      ? {
          board: {
            ...profile.board,
            layers: profile.board.layers ? [...profile.board.layers] : undefined,
            thicknessMm: profile.board.thicknessMm ? [...profile.board.thicknessMm] : undefined,
            finish: profile.board.finish ? [...profile.board.finish] : undefined,
          },
        }
      : {}),
    ...(profile.assembly
      ? {
          assembly: {
            ...profile.assembly,
            sides: profile.assembly.sides ? [...profile.assembly.sides] : undefined,
          },
        }
      : {}),
    ...(profile.fabrication ? { fabrication: { ...profile.fabrication } } : {}),
    // Copied, not defaulted: hardcoding `unverifiedProvenance` here would discard a real
    // verification record every time a profile was cloned.
    provenance: { ...profile.provenance },
    caveats: [...profile.caveats],
  };
}
