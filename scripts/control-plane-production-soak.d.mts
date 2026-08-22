export type ProductionSoakThresholds = {
  latencyP95Ms: number;
  minimumAvailabilityPercent: number;
};

export type ProductionSoakOptions = {
  origin: string;
  readyPath: string;
  durationMinutes: number;
  intervalSeconds: number;
  requestTimeoutMs: number;
  maxConsecutiveFailures: number;
  reportPath: string | undefined;
  thresholds: ProductionSoakThresholds;
};

export type ProductionSoakMeasurement = {
  count: number;
  elapsedMs: number;
  throughputPerSecond: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maximumMs: number;
};

export type ProductionSoakReport = {
  event: "control_plane_production_soak_verified";
  scenario: {
    origin: string;
    durationRequestedMinutes: number;
    intervalSeconds: number;
    maxConsecutiveFailures: number;
  };
  samplesTaken: number;
  elapsedMinutes: number;
  terminatedEarly: boolean;
  terminationReason?: "max_consecutive_failures_exceeded";
  ready: ProductionSoakMeasurement;
  availability: {
    successCount: number;
    samplesTaken: number;
    availabilityPercent: number;
  };
};

export type ProductionSoakDependencies = {
  request?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
};

export class ProductionSoakError extends Error {
  readonly reason: string;
  readonly details: Readonly<Record<string, unknown>>;
  constructor(reason: string, message: string, details?: Readonly<Record<string, unknown>>);
}

export function readProductionSoakOptions(
  environment?: Readonly<Record<string, string | undefined>>,
): ProductionSoakOptions;
export function runProductionSoakMonitor(
  options: ProductionSoakOptions,
  dependencies?: ProductionSoakDependencies,
): Promise<ProductionSoakReport>;
export function evaluateProductionSoakReport(
  report: ProductionSoakReport,
  thresholds: ProductionSoakThresholds,
): string[];
