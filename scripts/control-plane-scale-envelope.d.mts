export type ControlPlaneScalePresetName = "baseline" | "medium" | "high";

export type ControlPlaneScalePreset = {
  uniqueDeliveries: number;
  duplicateDeliveries: number;
  repositoryCount: number;
  runsPerRepository: number;
  concurrency: number;
};

export const CONTROL_PLANE_SCALE_PRESETS: Readonly<
  Record<ControlPlaneScalePresetName, Readonly<ControlPlaneScalePreset>>
>;

export function controlPlaneScaleEnvironment(preset: string): Readonly<Record<string, string>>;

export type ControlPlaneScaleMeasurement = {
  count: number;
  elapsedMs: number;
  throughputPerSecond: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maximumMs: number;
};

export type ControlPlaneScaleTierSummary = {
  preset: ControlPlaneScalePresetName;
  scenario: ControlPlaneScalePreset;
  databasePoolMaximum: number;
  intake: ControlPlaneScaleMeasurement;
  lifecycle: ControlPlaneScaleMeasurement;
  dashboard: ControlPlaneScaleMeasurement;
};

export type ControlPlaneScaleEnvelopeSummary = {
  event: "control_plane_scale_envelope_verified";
  sourceSha?: string;
  tiers: ControlPlaneScaleTierSummary[];
  envelope: {
    maximumUniqueDeliveries: number;
    maximumReleaseRuns: number;
    maximumConcurrency: number;
    maximumDatabasePoolSize: number;
    maximumObservedP95Ms: number;
    crossTenantMismatches: number;
    thresholdSignals: number;
  };
};

export function summarizeControlPlaneScaleEnvelope(
  reports: Record<ControlPlaneScalePresetName, unknown>,
  options?: { sourceSha?: string },
): ControlPlaneScaleEnvelopeSummary;
