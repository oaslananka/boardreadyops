export interface CompatibilityConfig {
  kicad: {
    minimum: string;
    recommended: string;
    tested: string[];
    notes?: Record<string, string>;
  };
  node: {
    minimum: string;
    minimumVersion?: string;
    recommended: string;
    supported: string[];
    current: string[];
    tested?: Record<string, string>;
    policy?: Record<string, string>;
  };
  cyclonedx: {
    specVersion: string;
    schemaUrl: string;
    hbomSchema: string;
    validation: string;
  };
}

export interface NodeRelease {
  version: string;
  date?: string;
  lts?: string | false;
}

export interface CycloneDxSchema {
  $id?: string;
  id?: string;
  properties?: {
    specVersion?: {
      const?: unknown;
      enum?: unknown;
      examples?: unknown;
    };
  };
}

export interface CompatibilityDrift {
  kicad: Array<{ series: string; latest: string }>;
  node: Array<{
    major: string;
    latest: string;
    tested: string | null;
    reason:
      | "new-minor"
      | "new-release"
      | "untested-supported"
      | "undocumented-current"
      | "unsupported-lts"
      | "current-promoted-lts";
  }>;
  cyclonedx: Array<{
    expected: string;
    observed: string | null;
    schemaUrl: string;
    reason: "schema-version-mismatch" | "schema-version-unreadable";
  }>;
}

export function renderSupportMatrix(input: unknown): string;

export function findCompatibilityDrift(
  input: unknown,
  sources: { kicadReleases?: string[]; nodeReleases?: NodeRelease[]; cycloneDxSchema?: CycloneDxSchema },
): CompatibilityDrift;

export function buildDriftReport(drift: CompatibilityDrift): string;

export function fetchNodeReleases(fetchImpl?: typeof fetch): Promise<NodeRelease[]>;

export function fetchKicadReleaseTags(fetchImpl?: typeof fetch): Promise<string[]>;

export function fetchCycloneDxSchema(input: unknown, fetchImpl?: typeof fetch): Promise<CycloneDxSchema>;

export function main(args?: string[], options?: { root?: string; fetch?: typeof fetch }): Promise<void>;
