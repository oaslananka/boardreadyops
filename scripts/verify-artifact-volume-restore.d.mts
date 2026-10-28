export const ARTIFACT_RESTORE_CONFIRMATION: "isolated-restored-artifacts";
export function verifyArtifactVolumeRestore(options: {
  sourceDir: string;
  restoredDir: string;
  confirmation: string;
  maxFiles?: number;
  maxBytes?: number;
}): Promise<{ status: "verified"; fileCount: number; totalBytes: number }>;
