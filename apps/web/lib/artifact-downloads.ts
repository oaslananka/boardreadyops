import { createHmac, timingSafeEqual } from "node:crypto";
import path from "node:path";

export type ArtifactDownloadSignatureInput = {
  runId: string;
  artifactId: string;
  expiresAt: number;
};

export type ArtifactDownloadUrlInput = ArtifactDownloadSignatureInput & {
  baseUrl?: string;
};

const defaultTtlSeconds = 15 * 60;

function signingKey(): string | undefined {
  return process.env.ARTIFACT_DOWNLOAD_SIGNING_KEY ?? process.env.SESSION_SECRET;
}

function payload(input: ArtifactDownloadSignatureInput): string {
  return `${input.runId}.${input.artifactId}.${input.expiresAt}`;
}

export function artifactDownloadExpiry(now = Date.now(), ttlSeconds = defaultTtlSeconds): number {
  return Math.floor(now / 1000) + ttlSeconds;
}

export function signArtifactDownload(input: ArtifactDownloadSignatureInput, key = signingKey()): string | undefined {
  if (!key) {
    return undefined;
  }

  return createHmac("sha256", key).update(payload(input)).digest("base64url");
}

export function verifyArtifactDownloadSignature(input: ArtifactDownloadSignatureInput & { signature: string }): boolean {
  if (input.expiresAt < Math.floor(Date.now() / 1000)) {
    return false;
  }

  const expected = signArtifactDownload(input);
  if (!expected) {
    return false;
  }

  const actualBuffer = Buffer.from(input.signature);
  const expectedBuffer = Buffer.from(expected);

  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function artifactDownloadUrl(input: ArtifactDownloadUrlInput): string | undefined {
  const signature = signArtifactDownload(input);
  const baseUrl = input.baseUrl ?? process.env.BOARDREADYOPS_PUBLIC_URL ?? process.env.NEXT_PUBLIC_APP_URL;

  if (!signature || !baseUrl) {
    return undefined;
  }

  const url = new URL(
    `/api/v1/runs/${encodeURIComponent(input.runId)}/artifacts/${encodeURIComponent(input.artifactId)}/download`,
    baseUrl,
  );
  url.searchParams.set("exp", String(input.expiresAt));
  url.searchParams.set("sig", signature);
  return url.toString();
}

export function safeLocalArtifactPath(storageRoot: string, storagePath: string): string | undefined {
  const root = path.resolve(storageRoot);
  const candidate = path.resolve(root, storagePath);

  return candidate === root || candidate.startsWith(`${root}${path.sep}`) ? candidate : undefined;
}
