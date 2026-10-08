import type { RuleContext } from "../../core/context.js";
import { type Severity, severityRankValue } from "../../core/findings.js";
import { RULE_CLASSIFICATIONS } from "../../core/rule-registry.js";
import {
  type GerberGeometry,
  pointToSegmentDistanceMm,
  segmentToSegmentDistanceMm,
} from "../../multicad/gerber-geometry.js";
import { type GerberParseResult, parseGerber } from "../../multicad/gerber-parser.js";
import { globFiles } from "../../util/glob.js";
import { findVendorProfile, vendorProfileAssurance } from "../../vendor/profiles.js";
import { configFor, configuredSeverity, finding, rule, shouldRun } from "../helpers.js";
import { DEFAULT_GERBER_PATTERNS, loadGerberStackup } from "./shared.js";

type GerberPrimitive = GerberGeometry["primitives"][number];
type GerberSegment = Extract<GerberPrimitive, { kind: "segment" }>;
type GerberFlash = Extract<GerberPrimitive, { kind: "flash" }>;
type GerberPoint = GerberSegment["from"];
type ModelledAperture = NonNullable<GerberFlash["aperture"]>;
type LayerEvidence = {
  role: string;
  side: string;
  filename: string;
  identitySource: "declared" | "assumed";
};
type ParsedLayer = {
  path: string;
  parsed: GerberParseResult;
  layer: LayerEvidence | undefined;
};
type ApertureCore = {
  points: GerberPoint[];
  roundRadiusMm: number;
};
type FeatureMeasurement = {
  clearanceMm: number;
  kind: "trace" | "flash" | "region";
  location: Record<string, unknown>;
  apertureCode?: number | undefined;
  extentEvidence: string;
};
type RegionMeasurement = {
  measurement: FeatureMeasurement | undefined;
  exact: boolean;
};

const outlineIgnoredUncertainty = new Set(["undefined-aperture", "unsupported-aperture"]);
const pointToleranceMm = 1e-9;

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
    if (!shouldRun(context, "manufacturing.board-edge-clearance")) return [];

    const files = await globFiles(context.root, DEFAULT_GERBER_PATTERNS);
    if (files.length === 0) return [];

    const parsedFiles = await parseLayers(context.root, files);
    const { profile, assurance, minClearanceMm, limitSource, limitMayBlock, configured } = resolveLimit(context);

    const outlineCandidates = parsedFiles.filter((item) => item.layer?.role === "outline");
    const outlineFile =
      outlineCandidates.find((item) => item.layer?.identitySource === "declared") ?? outlineCandidates[0];
    const outlineSegments =
      outlineFile?.parsed.geometry.primitives.filter(
        (primitive): primitive is GerberSegment => primitive.kind === "segment",
      ) ?? [];

    if (
      outlineFile === undefined ||
      outlineSegments.length === 0 ||
      !outlineFile.parsed.hasClosedContour ||
      outlineFile.parsed.openContourCount > 0
    ) {
      return [
        finding(context, {
          ruleId: "manufacturing.board-edge-clearance",
          severity: advisorySeverity(configured),
          confidence: "low",
          message: "Cannot verify board edge clearance because the Gerber board outline is missing or open.",
          path: outlineFile?.path ?? parsedFiles[0]?.path ?? ".",
          kind: "pcb",
          details: {
            minClearanceMm,
            limitSource,
            configuredSeverity: configured,
            severityCapped: advisorySeverity(configured) !== configured,
            blocking: false,
            blockingRationale:
              "A closed measurable board-profile contour is required before feature-to-edge distance can block.",
            outlineClosed: Boolean(outlineFile?.parsed.hasClosedContour && outlineFile.parsed.openContourCount === 0),
            outlineRoleEvidence: outlineFile?.layer?.identitySource ?? "unknown",
            geometryConfidence: "unknown",
            profileAssurance: assurance?.state ?? "none",
            profileMayBlock: assurance?.mayBlock ?? false,
            profileRevision: profile?.provenance.revision ?? null,
            profileSource: profile?.provenance.source ?? null,
            verifiedAt: profile?.provenance.verifiedAt ?? null,
          },
        }),
      ];
    }

    const outlineReasons = outlineEvidenceReasons(outlineFile, outlineSegments);
    const copperFiles = parsedFiles.filter((item) => item.layer?.role === "copper");
    const output = [];

    for (const copper of copperFiles) {
      const { measurements, extentUncertainty } = measureCopperFeatures(copper.parsed, outlineSegments);
      const best = minimumMeasurement(measurements);
      const geometryReasons = [
        ...copper.parsed.geometry.uncertainty.map((reason) => `copper:${reason}`),
        ...extentUncertainty,
      ];
      const evidenceReasons = [
        ...outlineReasons,
        ...copperEvidenceReasons(copper),
        ...geometryReasons,
        ...(limitMayBlock ? [] : [limitBlockingReason(limitSource, assurance?.state ?? "none")]),
      ];
      const blockingEvidence = evidenceReasons.length === 0;

      if (best !== undefined && best.clearanceMm < minClearanceMm) {
        const blocking = blockingEvidence;
        const severity = blocking ? configured : advisorySeverity(configured);
        output.push(
          finding(context, {
            ruleId: "manufacturing.board-edge-clearance",
            severity,
            confidence: blocking ? "definite" : "low",
            message: blocking
              ? `Copper feature on ${copper.path} is ${formatMm(best.clearanceMm)}mm from the board edge, below the required ${minClearanceMm}mm.`
              : `Measured copper feature on ${copper.path} at ${formatMm(best.clearanceMm)}mm from the board edge, below the ${minClearanceMm}mm limit, but the evidence is advisory.`,
            path: copper.path,
            kind: "pcb",
            details: {
              measuredClearanceMm: roundedMm(best.clearanceMm),
              minClearanceMm,
              limitSource,
              layerRole: "copper",
              layerRoleEvidence: copper.layer?.identitySource ?? "unknown",
              outlineRoleEvidence: outlineFile.layer?.identitySource ?? "unknown",
              featureKind: best.kind,
              featureLocation: best.location,
              apertureCode: best.apertureCode ?? null,
              featureExtentEvidence: best.extentEvidence,
              geometryConfidence: geometryReasons.length === 0 && outlineReasons.length === 0 ? "exact" : "partial",
              geometryUncertainty: [...outlineReasons, ...geometryReasons],
              profileAssurance: assurance?.state ?? "none",
              profileMayBlock: assurance?.mayBlock ?? false,
              profileRevision: profile?.provenance.revision ?? null,
              profileSource: profile?.provenance.source ?? null,
              verifiedAt: profile?.provenance.verifiedAt ?? null,
              configuredSeverity: configured,
              severityCapped: severity !== configured,
              blocking,
              blockingRationale: blocking
                ? "Declared layer roles, declared coordinate evidence, complete modelled geometry, and the selected limit all support a blocking measurement."
                : evidenceReasons.join(" "),
            },
            fix: {
              description: `Pull copper features back at least ${minClearanceMm}mm from the board outline on ${copper.path}.`,
              steps: [
                "Open PCB Editor in KiCad.",
                `Inspect copper fills, pads, and tracks near Edge.Cuts on layer ${copper.path}.`,
                `Set copper clearance to Edge.Cuts to at least ${minClearanceMm}mm in Board Setup > Design Rules.`,
                "Re-fill copper zones and re-export Gerber files.",
              ],
            },
          }),
        );
        continue;
      }

      if (geometryReasons.length > 0) {
        const severity = advisorySeverity(configured);
        output.push(
          finding(context, {
            ruleId: "manufacturing.board-edge-clearance",
            severity,
            confidence: "low",
            message: `Cannot fully verify board edge clearance for ${copper.path} because some copper geometry is incomplete or has an unmodelled extent.`,
            path: copper.path,
            kind: "pcb",
            details: {
              measuredClearanceMm: best === undefined ? null : roundedMm(best.clearanceMm),
              minClearanceMm,
              limitSource,
              layerRole: "copper",
              layerRoleEvidence: copper.layer?.identitySource ?? "unknown",
              outlineRoleEvidence: outlineFile.layer?.identitySource ?? "unknown",
              geometryConfidence: "partial",
              geometryUncertainty: geometryReasons,
              profileAssurance: assurance?.state ?? "none",
              profileMayBlock: assurance?.mayBlock ?? false,
              configuredSeverity: configured,
              severityCapped: severity !== configured,
              blocking: false,
              blockingRationale:
                "Incomplete or unmodelled copper geometry cannot establish an exact production verdict even when measured primitives are clear.",
            },
          }),
        );
      }
    }

    return output;
  },
);

async function parseLayers(root: string, files: string[]): Promise<ParsedLayer[]> {
  const { entries, stackup } = await loadGerberStackup(root, files);
  const layersByFilename = new Map<string, LayerEvidence>(
    stackup.layers.map((layer) => [
      layer.filename.replaceAll("\\", "/"),
      {
        role: layer.role,
        side: layer.side,
        filename: layer.filename,
        identitySource: layer.identitySource,
      },
    ]),
  );
  return entries.map((entry) => ({
    path: entry.filename,
    parsed: parseGerber(entry.content ?? "", entry.filename),
    layer: layersByFilename.get(entry.filename.replaceAll("\\", "/")),
  }));
}

function resolveLimit(context: RuleContext) {
  const vendorId = typeof context.config.vendor === "string" ? context.config.vendor : context.config.vendor?.profile;
  const profile = findVendorProfile(vendorId) ?? findVendorProfile("generic-prototype");
  const assurance = profile === undefined ? undefined : vendorProfileAssurance(profile);
  const ruleConfig = configFor(context, "manufacturing.board-edge-clearance");
  const configuredMin = typeof ruleConfig["min-clearance-mm"] === "number" ? ruleConfig["min-clearance-mm"] : undefined;
  const profileMin = profile?.fabrication?.minBoardEdgeClearanceMm;
  const minClearanceMm = configuredMin ?? profileMin ?? 0.2;
  const limitSource =
    configuredMin !== undefined ? "configured" : profileMin !== undefined ? "vendor-profile" : "default";
  const limitMayBlock =
    configuredMin !== undefined || (limitSource === "vendor-profile" && assurance?.mayBlock === true);
  const configured = configuredSeverity(context, "manufacturing.board-edge-clearance", "medium");
  return { profile, assurance, minClearanceMm, limitSource, limitMayBlock, configured };
}

function outlineEvidenceReasons(outline: ParsedLayer, segments: readonly GerberSegment[]): string[] {
  const reasons: string[] = [];
  if (outline.layer?.identitySource !== "declared")
    reasons.push("The board-profile role comes from the filename, not TF.FileFunction.");
  if (outline.parsed.unitsEvidence !== "declared") reasons.push("The board-profile units were assumed.");
  if (outline.parsed.format.evidence !== "declared") reasons.push("The board-profile coordinate format was assumed.");
  const relevantUncertainty = outline.parsed.geometry.uncertainty.filter(
    (reason) => !outlineIgnoredUncertainty.has(reason),
  );
  for (const reason of relevantUncertainty) reasons.push(`The board-profile geometry is incomplete: ${reason}.`);
  if (segments.length === 0) reasons.push("The board profile exposes no measurable segments.");
  if (outline.parsed.geometry.primitives.some((primitive) => primitive.kind !== "segment")) {
    reasons.push("The board profile contains plotted objects that are not profile segments.");
  }
  return reasons;
}

function copperEvidenceReasons(copper: ParsedLayer): string[] {
  const reasons: string[] = [];
  if (copper.layer?.identitySource !== "declared")
    reasons.push("The copper role comes from the filename, not TF.FileFunction.");
  if (copper.parsed.unitsEvidence !== "declared") reasons.push("The copper-layer units were assumed.");
  if (copper.parsed.format.evidence !== "declared") reasons.push("The copper-layer coordinate format was assumed.");
  return reasons;
}

function limitBlockingReason(limitSource: string, assuranceState: string): string {
  if (limitSource === "vendor-profile") {
    return `The vendor-profile limit is ${assuranceState} and is advisory-only.`;
  }
  return "The fallback board-edge limit has no blocking provenance.";
}

function measureCopperFeatures(
  parsed: GerberParseResult,
  outlineSegments: readonly GerberSegment[],
): { measurements: FeatureMeasurement[]; extentUncertainty: string[] } {
  const measurements: FeatureMeasurement[] = [];
  const extentUncertainty = new Set<string>();
  const apertures = new Map(parsed.apertures.map((aperture) => [aperture.code, aperture]));

  for (const primitive of parsed.geometry.primitives) {
    if (primitive.kind === "segment" && !primitive.inRegion) {
      const aperture = primitive.apertureCode === undefined ? undefined : apertures.get(primitive.apertureCode);
      if (!isModelledAperture(aperture)) {
        extentUncertainty.add(
          `Trace D${primitive.apertureCode ?? "?"} has no modelled aperture extent for board-edge measurement.`,
        );
        continue;
      }
      measurements.push({
        clearanceMm: sweptApertureClearance(aperture, primitive.from, primitive.to, outlineSegments),
        kind: "trace",
        location: { from: primitive.from, to: primitive.to },
        apertureCode: primitive.apertureCode,
        extentEvidence: aperture.shape,
      });
      continue;
    }

    if (primitive.kind === "flash" && !primitive.inRegion) {
      if (primitive.aperture === undefined) {
        extentUncertainty.add(
          `Flash D${primitive.apertureCode ?? "?"} has no modelled aperture extent for board-edge measurement.`,
        );
        continue;
      }
      measurements.push({
        clearanceMm: flashedApertureClearance(primitive.aperture, primitive.at, outlineSegments),
        kind: "flash",
        location: { at: primitive.at },
        apertureCode: primitive.apertureCode,
        extentEvidence: primitive.aperture.shape,
      });
    }
  }

  const region = measureRegions(parsed.geometry.primitives, outlineSegments);
  if (region.measurement !== undefined) measurements.push(region.measurement);
  if (!region.exact) extentUncertainty.add("A region contour is not explicitly closed in the exposed geometry.");

  return { measurements, extentUncertainty: [...extentUncertainty] };
}

function isModelledAperture(
  aperture: GerberParseResult["apertures"][number] | undefined,
): aperture is ModelledAperture {
  return (
    aperture !== undefined &&
    (aperture.shape === "circle" ||
      aperture.shape === "rectangle" ||
      aperture.shape === "obround" ||
      aperture.shape === "polygon")
  );
}

function flashedApertureClearance(
  aperture: ModelledAperture,
  at: GerberPoint,
  outlineSegments: readonly GerberSegment[],
): number {
  const core = apertureCore(aperture);
  const points = core.points.map((point) => translate(point, at));
  return Math.max(0, distanceFromCoreToOutline(points, outlineSegments) - core.roundRadiusMm);
}

function sweptApertureClearance(
  aperture: ModelledAperture,
  from: GerberPoint,
  to: GerberPoint,
  outlineSegments: readonly GerberSegment[],
): number {
  const core = apertureCore(aperture);
  const swept = [
    ...core.points.map((point) => translate(point, from)),
    ...core.points.map((point) => translate(point, to)),
  ];
  return Math.max(0, distanceFromCoreToOutline(convexHull(swept), outlineSegments) - core.roundRadiusMm);
}

function apertureCore(aperture: ModelledAperture): ApertureCore {
  if (aperture.shape === "circle") {
    return { points: [{ x: 0, y: 0 }], roundRadiusMm: aperture.diameterMm / 2 };
  }

  if (aperture.shape === "rectangle") {
    const halfWidth = aperture.widthMm / 2;
    const halfHeight = aperture.heightMm / 2;
    return {
      points: [
        { x: -halfWidth, y: -halfHeight },
        { x: halfWidth, y: -halfHeight },
        { x: halfWidth, y: halfHeight },
        { x: -halfWidth, y: halfHeight },
      ],
      roundRadiusMm: 0,
    };
  }

  if (aperture.shape === "obround") {
    const radius = Math.min(aperture.widthMm, aperture.heightMm) / 2;
    if (aperture.widthMm === aperture.heightMm) {
      return { points: [{ x: 0, y: 0 }], roundRadiusMm: radius };
    }
    if (aperture.widthMm > aperture.heightMm) {
      const halfCore = (aperture.widthMm - aperture.heightMm) / 2;
      return {
        points: [
          { x: -halfCore, y: 0 },
          { x: halfCore, y: 0 },
        ],
        roundRadiusMm: radius,
      };
    }
    const halfCore = (aperture.heightMm - aperture.widthMm) / 2;
    return {
      points: [
        { x: 0, y: -halfCore },
        { x: 0, y: halfCore },
      ],
      roundRadiusMm: radius,
    };
  }

  const rotation = ((aperture.rotationDegrees ?? 0) * Math.PI) / 180;
  const radius = aperture.diameterMm / 2;
  return {
    points: Array.from({ length: aperture.vertices }, (_unused, index) => {
      const angle = rotation + (index * Math.PI * 2) / aperture.vertices;
      return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
    }),
    roundRadiusMm: 0,
  };
}

function distanceFromCoreToOutline(points: readonly GerberPoint[], outlineSegments: readonly GerberSegment[]): number {
  if (points.length === 0 || outlineSegments.length === 0) return Number.POSITIVE_INFINITY;
  let minimum = Number.POSITIVE_INFINITY;
  for (const outline of outlineSegments) {
    minimum = Math.min(minimum, distanceFromCoreToSegment(points, outline));
    if (minimum === 0) return 0;
  }
  return minimum;
}

function distanceFromCoreToSegment(points: readonly GerberPoint[], target: GerberSegment): number {
  if (points.length === 1) return pointToSegmentDistanceMm(points[0] as GerberPoint, target);
  if (points.length === 2)
    return segmentToSegmentDistanceMm(segment(points[0] as GerberPoint, points[1] as GerberPoint), target);

  if (pointInPolygon(target.from, points) || pointInPolygon(target.to, points)) return 0;
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length; index += 1) {
    const from = points[index] as GerberPoint;
    const to = points[(index + 1) % points.length] as GerberPoint;
    minimum = Math.min(minimum, segmentToSegmentDistanceMm(segment(from, to), target));
    if (minimum === 0) return 0;
  }
  return minimum;
}

function measureRegions(
  primitives: readonly GerberPrimitive[],
  outlineSegments: readonly GerberSegment[],
): RegionMeasurement {
  const regionSegments = primitives.filter(
    (primitive): primitive is GerberSegment => primitive.kind === "segment" && primitive.inRegion,
  );
  if (regionSegments.length === 0) return { measurement: undefined, exact: true };

  const { contours, exact } = splitRegionContours(regionSegments);
  let minimum = Number.POSITIVE_INFINITY;
  let location: Record<string, unknown> = {};

  for (const regionSegment of regionSegments) {
    for (const outline of outlineSegments) {
      const distance = segmentToSegmentDistanceMm(regionSegment, outline);
      if (distance < minimum) {
        minimum = distance;
        location = { from: regionSegment.from, to: regionSegment.to };
      }
      if (minimum === 0) break;
    }
    if (minimum === 0) break;
  }

  if (minimum > 0 && contours.length > 0) {
    for (const outline of outlineSegments) {
      const midpoint = {
        x: (outline.from.x + outline.to.x) / 2,
        y: (outline.from.y + outline.to.y) / 2,
      };
      if (contours.some((contour) => pointInContour(midpoint, contour))) {
        minimum = 0;
        location = { at: midpoint, relation: "board-edge-inside-region" };
        break;
      }
    }
  }

  return {
    measurement: {
      clearanceMm: minimum,
      kind: "region",
      location,
      extentEvidence: "filled-region-contour",
    },
    exact,
  };
}

function splitRegionContours(segments: readonly GerberSegment[]): {
  contours: GerberSegment[][];
  exact: boolean;
} {
  const contours: GerberSegment[][] = [];
  let current: GerberSegment[] = [];
  let exact = true;

  for (const candidate of segments) {
    if (current.length > 0 && !samePoint((current[current.length - 1] as GerberSegment).to, candidate.from)) {
      exact = false;
      current = [];
    }

    if (current.length === 0) current = [candidate];
    else current.push(candidate);

    if (samePoint(candidate.to, (current[0] as GerberSegment).from)) {
      contours.push(current);
      current = [];
    }
  }

  if (current.length > 0) exact = false;
  return { contours, exact };
}

function pointInContour(point: GerberPoint, contour: readonly GerberSegment[]): boolean {
  let inside = false;
  for (const edge of contour) {
    if (pointOnSegment(point, edge)) return true;
    const crossesY = edge.from.y > point.y !== edge.to.y > point.y;
    if (!crossesY) continue;
    const intersectionX =
      edge.from.x + ((point.y - edge.from.y) * (edge.to.x - edge.from.x)) / (edge.to.y - edge.from.y);
    if (intersectionX > point.x) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point: GerberPoint, polygon: readonly GerberPoint[]): boolean {
  let inside = false;
  for (let index = 0; index < polygon.length; index += 1) {
    const from = polygon[index] as GerberPoint;
    const to = polygon[(index + 1) % polygon.length] as GerberPoint;
    const edge = segment(from, to);
    if (pointOnSegment(point, edge)) return true;
    const crossesY = from.y > point.y !== to.y > point.y;
    if (!crossesY) continue;
    const intersectionX = from.x + ((point.y - from.y) * (to.x - from.x)) / (to.y - from.y);
    if (intersectionX > point.x) inside = !inside;
  }
  return inside;
}

function pointOnSegment(point: GerberPoint, edge: GerberSegment): boolean {
  const cross =
    (edge.to.x - edge.from.x) * (point.y - edge.from.y) - (edge.to.y - edge.from.y) * (point.x - edge.from.x);
  if (Math.abs(cross) > pointToleranceMm) return false;
  return (
    point.x >= Math.min(edge.from.x, edge.to.x) - pointToleranceMm &&
    point.x <= Math.max(edge.from.x, edge.to.x) + pointToleranceMm &&
    point.y >= Math.min(edge.from.y, edge.to.y) - pointToleranceMm &&
    point.y <= Math.max(edge.from.y, edge.to.y) + pointToleranceMm
  );
}

function convexHull(points: readonly GerberPoint[]): GerberPoint[] {
  const unique = [...new Map(points.map((point) => [`${point.x},${point.y}`, point])).values()].sort(
    (left, right) => left.x - right.x || left.y - right.y,
  );
  if (unique.length <= 2) return unique;

  const lower: GerberPoint[] = [];
  for (const point of unique) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2] as GerberPoint, lower[lower.length - 1] as GerberPoint, point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  }

  const upper: GerberPoint[] = [];
  for (let index = unique.length - 1; index >= 0; index -= 1) {
    const point = unique[index] as GerberPoint;
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2] as GerberPoint, upper[upper.length - 1] as GerberPoint, point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  }

  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function cross(origin: GerberPoint, first: GerberPoint, second: GerberPoint): number {
  return (first.x - origin.x) * (second.y - origin.y) - (first.y - origin.y) * (second.x - origin.x);
}

function translate(point: GerberPoint, offset: GerberPoint): GerberPoint {
  return { x: point.x + offset.x, y: point.y + offset.y };
}

function segment(from: GerberPoint, to: GerberPoint): GerberSegment {
  return {
    kind: "segment",
    from,
    to,
    inRegion: false,
    apertureCode: undefined,
    widthMm: undefined,
  };
}

function samePoint(left: GerberPoint, right: GerberPoint): boolean {
  return Math.abs(left.x - right.x) <= pointToleranceMm && Math.abs(left.y - right.y) <= pointToleranceMm;
}

function minimumMeasurement(measurements: readonly FeatureMeasurement[]): FeatureMeasurement | undefined {
  let minimum: FeatureMeasurement | undefined;
  for (const measurement of measurements) {
    if (minimum === undefined || measurement.clearanceMm < minimum.clearanceMm) minimum = measurement;
  }
  return minimum;
}

function roundedMm(value: number): number {
  return Number(value.toFixed(3));
}

function formatMm(value: number): string {
  return roundedMm(value).toFixed(3);
}

function advisorySeverity(configured: Severity): Severity {
  return severityRankValue(configured) > severityRankValue("low") ? "low" : configured;
}
