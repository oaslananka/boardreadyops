import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

export interface VerifyGitHubWebhookOptions {
  payload: string | Buffer;
  secret: string;
  signatureHeader: string | null;
}

export interface StoredArtifact {
  key: string;
  path: string;
  bytes: number;
  sha256: string;
}

export function createGitHubSignatureHeader(payload: string | Buffer, secret: string): string {
  const digest = createHmac("sha256", secret).update(payload).digest("hex");
  return `sha256=${digest}`;
}

export function verifyGitHubWebhook(options: VerifyGitHubWebhookOptions): boolean {
  const signature = options.signatureHeader;

  if (!signature?.startsWith("sha256=")) {
    return false;
  }

  const expected = createGitHubSignatureHeader(options.payload, options.secret);
  const expectedDigest = Buffer.from(expected.slice("sha256=".length), "hex");
  const actualDigest = Buffer.from(signature.slice("sha256=".length), "hex");

  if (expectedDigest.length !== actualDigest.length) {
    return false;
  }

  return timingSafeEqual(expectedDigest, actualDigest);
}

export function resolveLocalArtifactPath(root: string, key: string): string {
  const normalizedKey = key.replaceAll("\\", "/");

  if (normalizedKey.startsWith("/") || normalizedKey.split("/").includes("..")) {
    throw new Error("Artifact key must stay within the configured artifact root");
  }

  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(resolvedRoot, normalizedKey);

  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error("Artifact key escapes the configured artifact root");
  }

  return resolvedPath;
}

export async function writeLocalArtifact(root: string, key: string, content: string | Buffer): Promise<StoredArtifact> {
  const path = resolveLocalArtifactPath(root, key);
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const sha256 = createHash("sha256").update(buffer).digest("hex");

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buffer);

  return {
    key,
    path,
    bytes: buffer.byteLength,
    sha256,
  };
}
