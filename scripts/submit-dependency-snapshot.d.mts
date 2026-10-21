export interface DependencySnapshotOptions {
  sha: string;
  ref: string;
  scanned?: string;
  runId: string | number;
  cwd?: string;
}

export interface ResolvedDependency {
  package_url: string;
  relationship: "direct" | "indirect";
  scope: "runtime" | "development";
  dependencies: string[];
}

export interface PnpmDependencySnapshot {
  version: 0;
  sha: string;
  ref: string;
  job: { id: string; correlator: string };
  detector: { name: string; version: string; url: string };
  scanned: string;
  manifests: {
    "pnpm-lock.yaml": {
      name: string;
      file: { source_location: string };
      resolved: Record<string, ResolvedDependency>;
    };
  };
}

export function snapshotFromResolvedBom(
  bom: {
    metadata?: { component?: { "bom-ref"?: string } };
    components?: Array<{ purl: string; version: string; scope?: string }>;
    dependencies?: Array<{ ref: string; dependsOn: string[] }>;
  },
  options: Required<Pick<DependencySnapshotOptions, "sha" | "ref" | "runId" | "scanned">>,
): PnpmDependencySnapshot;

export function buildSnapshot(options: DependencySnapshotOptions): Promise<PnpmDependencySnapshot>;
