export interface PreReleaseStep {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string> | undefined;
}

export interface VerifyPackageContentsOptions {
  writeSummary?: boolean | undefined;
}

export interface PackageContentsResult {
  files: string[];
  required: string[];
}

export const preReleaseSteps: PreReleaseStep[];
export const requiredPackageFiles: string[];

export function verifyPackageContents(
  root?: string,
  options?: VerifyPackageContentsOptions,
): Promise<PackageContentsResult>;

export function runPreReleaseGate(options?: { listOnly?: boolean | undefined }): Promise<void>;
