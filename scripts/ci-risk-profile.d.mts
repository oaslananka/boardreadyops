export interface CiRiskProfileOptions {
  readonly eventName?: string;
  readonly forceFull?: boolean;
}

export interface CiRiskProfile {
  readonly changed_files: string;
  readonly docs_only: boolean;
  readonly code_changed: boolean;
  readonly docs_changed: boolean;
  readonly workflow_changed: boolean;
  readonly dependency_changed: boolean;
  readonly build_changed: boolean;
  readonly action_changed: boolean;
  readonly kicad_changed: boolean;
  readonly rule_changed: boolean;
  readonly security_changed: boolean;
  readonly package_changed: boolean;
  readonly path_sensitive_changed: boolean;
  readonly report_changed: boolean;
  readonly needs_lint: boolean;
  readonly needs_typecheck: boolean;
  readonly needs_unit: boolean;
  readonly needs_unit_matrix: boolean;
  readonly needs_integration: boolean;
  readonly needs_cross_platform: boolean;
  readonly needs_action_smoke: boolean;
  readonly needs_accessibility: boolean;
  readonly needs_build: boolean;
  readonly needs_dist: boolean;
  readonly needs_coverage: boolean;
  readonly needs_mutation: boolean;
  readonly needs_security: boolean;
  readonly needs_sbom: boolean;
  readonly needs_docs: boolean;
  readonly full_run: boolean;
}

export function classifyChangedFiles(files: readonly string[], options?: CiRiskProfileOptions): CiRiskProfile;
export function readFilesFromArg(inputPath?: string, repositoryRoot?: string): string[];
