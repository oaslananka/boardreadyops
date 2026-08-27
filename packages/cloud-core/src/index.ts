import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

export * from "./component-intelligence.js";
export * from "./decision-engine.js";
export * from "./entitlements.js";
export * from "./evidence-ledger.js";
export * from "./review-diff.js";
export * from "./runner-request-signature.js";

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

/**
 * Stripe webhook signature verification.
 *
 * Stripe signs `${timestamp}.${rawBody}` with HMAC-SHA256 and sends the result as
 * `Stripe-Signature: t=<timestamp>,v1=<hex digest>[,v1=<hex digest>...]`. A second `v1` entry
 * appears during secret rotation (Stripe signs with both the old and new secret briefly), so
 * every `v1` value is checked and any match is accepted.
 *
 * This verifies the signature only. It intentionally does not parse the event body, track
 * event ids for idempotency, or update any entitlement -- callers that need those need their
 * own persistence, which does not exist here yet.
 */
export interface VerifyStripeWebhookOptions {
  payload: string | Buffer;
  secret: string;
  signatureHeader: string | null;
  /** Seconds since epoch, for the replay-tolerance check. */
  now: number;
  /** Maximum age of the signed timestamp, in seconds. Stripe's own default is 300. */
  toleranceSeconds?: number;
}

export function createStripeSignatureHeader(payload: string | Buffer, secret: string, timestamp: number): string {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

function parsedStripeSignatureHeader(header: string): { timestamp: string; signatures: string[] } | undefined {
  const signatures: string[] = [];
  let timestamp: string | undefined;

  for (const entry of header.split(",")) {
    const separatorIndex = entry.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = entry.slice(0, separatorIndex).trim();
    const value = entry.slice(separatorIndex + 1).trim();
    if (key === "t" && timestamp === undefined) {
      timestamp = value;
    } else if (key === "v1") {
      signatures.push(value);
    }
  }

  return timestamp === undefined || signatures.length === 0 ? undefined : { timestamp, signatures };
}

export function verifyStripeWebhook(options: VerifyStripeWebhookOptions): boolean {
  if (!options.signatureHeader) return false;
  const parsed = parsedStripeSignatureHeader(options.signatureHeader);
  if (!parsed || !/^\d+$/u.test(parsed.timestamp)) return false;

  const timestamp = Number(parsed.timestamp);
  const toleranceSeconds = options.toleranceSeconds ?? 300;
  if (!Number.isSafeInteger(timestamp) || Math.abs(options.now - timestamp) > toleranceSeconds) {
    return false;
  }

  const expectedDigest = createHmac("sha256", options.secret).update(`${parsed.timestamp}.${options.payload}`).digest();

  return parsed.signatures.some((signature) => {
    if (!/^[0-9a-f]+$/iu.test(signature)) return false;
    const actualDigest = Buffer.from(signature, "hex");
    return actualDigest.length === expectedDigest.length && timingSafeEqual(actualDigest, expectedDigest);
  });
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
