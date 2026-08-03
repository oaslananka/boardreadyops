import type { Finding } from "../core/findings.js";

export interface ReportFindingContext {
  stableId: string;
  fingerprint: string;
  location: string;
  help: string;
}

export function reportFindingContext(finding: Finding): ReportFindingContext {
  return {
    stableId: finding.fingerprint.slice(0, 12),
    fingerprint: finding.fingerprint,
    location: reportLocation(finding),
    help: reportHelp(finding),
  };
}

function reportLocation(finding: Finding): string {
  const base = finding.resource.path;
  if (finding.location?.region) {
    const region = finding.location.region;
    const colSuffix = region.startColumn ? `:${region.startColumn}` : "";
    const start = `:${region.startLine}${colSuffix}`;
    const end = region.endLine !== region.startLine ? `-${region.endLine}` : "";
    return `${base}${start}${end}`;
  }
  if (finding.location?.line) {
    const column = finding.location.column ? `:${finding.location.column}` : "";
    return `${base}:${finding.location.line}${column}`;
  }
  if (finding.location?.boardCoordinates) {
    const coordinates = finding.location.boardCoordinates;
    return `${base}:${coordinates.layer ?? "board"}@${reportCoordinate(coordinates.x)}${coordinates.units},${reportCoordinate(
      coordinates.y,
    )}${coordinates.units}`;
  }
  return base;
}

function reportHelp(finding: Finding): string {
  if (finding.fix?.description) {
    return finding.fix.description;
  }
  if (finding.references?.[0]) {
    return finding.references[0];
  }
  return "See the BoardReadyOps rule documentation for remediation guidance.";
}

export function reportCoordinate(value: number): string {
  if (Object.is(value, -0)) {
    return "0";
  }
  if (Number.isInteger(value)) {
    return value.toString();
  }
  return value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

export function reportCoordinateWithUnits(value: number, units: "mm" | "in"): string {
  return `${reportCoordinate(value)}${units}`;
}
