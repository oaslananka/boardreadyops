export type ArtifactDownloadSignatureInput = {
  runId: string;
  artifactId: string;
  expiresAt: number;
};

export type ArtifactDownloadUrlInput = ArtifactDownloadSignatureInput & {
  baseUrl?: string;
  key?: string;
};

export type LocalArtifactResolution =
  | { state: "resolved"; path: string }
  | { state: "outside-root" }
  | { state: "storage-unavailable" }
  | { state: "file-unavailable" };

export const artifactDownloadMaxTtlSeconds: number;

export function artifactDownloadExpiry(now?: number, ttlSeconds?: number): number;
export function signArtifactDownload(input: ArtifactDownloadSignatureInput, key?: string): string | undefined;
export function verifyArtifactDownloadSignature(
  input: ArtifactDownloadSignatureInput & { signature: string },
  key?: string,
  now?: number,
): boolean;
export function artifactDownloadUrl(input: ArtifactDownloadUrlInput): string | undefined;
export function safeLocalArtifactPath(storageRoot: string, storagePath: string): string | undefined;
export function resolveLocalArtifactFile(storageRoot: string, storagePath: string): Promise<LocalArtifactResolution>;
export function artifactAttachmentHeader(name: string): string;
