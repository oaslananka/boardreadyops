export const repositorySetupPresetIds = ["open-source", "prototype", "production", "contract-design"] as const;
export type RepositorySetupPresetId = (typeof repositorySetupPresetIds)[number];

export const repositorySetupPresetVersion = 1;
export const repositorySetupWorkflowPath = "readiness-runner.yml";
export const repositorySetupWorkflowContractVersion = 1;
export const repositorySetupWorkflowName = "BoardReadyOps Readiness Runner";

export type RepositorySetupPreset = {
  id: RepositorySetupPresetId;
  name: string;
  description: string;
  releaseMode: "pilot" | "production" | "prototype";
  failOn: "high" | "medium";
  config: string;
};

const header = (releaseMode: RepositorySetupPreset["releaseMode"], failOn: RepositorySetupPreset["failOn"]) =>
  `version: 1\nmode: enforce\nreleaseMode: ${releaseMode}\nprojects:\n  - path: .\nfail-on: ${failOn}\n`;

const reports = `report:\n  sarif: boardreadyops.sarif.json\n  json: boardreadyops.findings.json\n  markdown: boardreadyops.report.md\n  html: boardreadyops.report.html\n`;

export const repositorySetupPresets: readonly RepositorySetupPreset[] = [
  {
    id: "open-source",
    name: "Open-source hardware",
    description: "Reproducible community releases with component traceability and release documentation.",
    releaseMode: "pilot",
    failOn: "high",
    config: `${header("pilot", "high")}rules:\n  bom.missing-mpn: true\n  bom.compliance: true\n  bom.lifecycle: true\n  bom.eol-detection: true\n  bom.unknown-lifecycle: true\n  bom.identity-conflicts: true\n  design.board-outline: true\n  design.unique-references: true\n  drc.kicad: true\n  manufacturing.fab-notes: true\n  manufacturing.layer-stackup: true\n  manufacturing.drill-coverage: true\n  release.revision-set: true\n  release.changelog-present: true\n  release.version-format: true\n  release.tag-matches-revision: true\n${reports}`,
  },
  {
    id: "prototype",
    name: "Prototype fabrication",
    description: "Low-friction first-build checks with critical supply-chain and design safeguards.",
    releaseMode: "prototype",
    failOn: "high",
    config: `${header("prototype", "high")}rules:\n  bom.missing-mpn: true\n  bom.compliance: true\n  bom.lifecycle: true\n  bom.risk-score: true\n  bom.eol-detection: true\n  bom.unknown-lifecycle: true\n  bom.single-source: false\n  design.board-outline: true\n  design.unique-references: true\n  drc.kicad: true\n  manufacturing.package-completeness: false\n  manufacturing.fab-notes: false\n  manufacturing.position-coverage: false\n  manufacturing.drill-coverage: false\n  release.revision-set: true\n  release.changelog-present: false\n  release.tag-matches-revision: false\n${reports}`,
  },
  {
    id: "production",
    name: "Production release",
    description: "Strict fabrication, supply-chain, manufacturing, and release evidence gates.",
    releaseMode: "production",
    failOn: "medium",
    config: `${header("production", "medium")}rules:\n  bom.missing-mpn: true\n  bom.compliance: true\n  bom.lifecycle: true\n  bom.risk-score: true\n  bom.eol-detection: true\n  bom.unknown-lifecycle: true\n  bom.single-source: true\n  bom.identity-conflicts: true\n  design.board-outline: true\n  design.unique-references: true\n  drc.kicad: true\n  erc.kicad: true\n  manufacturing.package-completeness: true\n  manufacturing.fab-notes: true\n  manufacturing.position-coverage: true\n  manufacturing.drill-coverage: true\n  manufacturing.tooling-holes: true\n  manufacturing.test-points: true\n  manufacturing.fiducials: true\n  manufacturing.assembly-sides: true\n  manufacturing.layer-stackup: true\n  manufacturing.pin1-markers: true\n  manufacturing.polarity-markers: true\n  manufacturing.silkscreen-over-pad: true\n  release.revision-set: true\n  release.changelog-present: true\n  release.tag-matches-revision: true\n  release.version-format: true\n${reports}`,
  },
  {
    id: "contract-design",
    name: "Contract design handoff",
    description: "Auditable client handoff with complete evidence, traceability, and signed-off release gates.",
    releaseMode: "production",
    failOn: "medium",
    config: `${header("production", "medium")}rules:\n  bom.missing-mpn: true\n  bom.compliance: true\n  bom.lifecycle: true\n  bom.eol-detection: true\n  bom.unknown-lifecycle: true\n  bom.single-source: true\n  bom.risk-score: true\n  bom.identity-conflicts: true\n  design.board-outline: true\n  design.unique-references: true\n  drc.kicad: true\n  erc.kicad: true\n  manufacturing.package-completeness: true\n  manufacturing.fab-notes: true\n  manufacturing.position-coverage: true\n  manufacturing.drill-coverage: true\n  manufacturing.tooling-holes: true\n  manufacturing.test-points: true\n  manufacturing.fiducials: true\n  manufacturing.layer-stackup: true\n  manufacturing.assembly-sides: true\n  manufacturing.pin1-markers: true\n  manufacturing.polarity-markers: true\n  manufacturing.silkscreen-over-pad: true\n  release.revision-set: true\n  release.changelog-present: true\n  release.tag-matches-revision: true\n  release.version-format: true\n${reports}`,
  },
];

const presetById = new Map(repositorySetupPresets.map((preset) => [preset.id, preset]));

export function repositorySetupPreset(id: string): RepositorySetupPreset | undefined {
  return presetById.get(id as RepositorySetupPresetId);
}

export function isRepositorySetupPresetId(value: unknown): value is RepositorySetupPresetId {
  return typeof value === "string" && presetById.has(value as RepositorySetupPresetId);
}
