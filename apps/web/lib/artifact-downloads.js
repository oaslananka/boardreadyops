import { createHmac, timingSafeEqual } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { configuredSecretValue } from "./secret-value.js";

export const artifactDownloadMaxTtlSeconds = 15 * 60;
const minimumSigningKeyBytes = 32;
const signaturePattern = /^[A-Za-z0-9_-]{43}$/;

export function configuredArtifactDownloadSigningKey(environment = process.env) {
  return configuredSecretValue({
    environment,
    valueName: "ARTIFACT_DOWNLOAD_SIGNING_KEY",
    fileName: "ARTIFACT_DOWNLOAD_SIGNING_KEY_FILE",
  });
}

function validSigningKey(key) {
  return typeof key === "string" && Buffer.byteLength(key, "utf8") >= minimumSigningKeyBytes;
}

function payload(input) {
  return `${input.runId}.${input.artifactId}.${input.expiresAt}`;
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function rfc5987Value(input) {
  return encodeURIComponent(input).replaceAll(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function artifactDownloadExpiry(now = Date.now(), ttlSeconds = artifactDownloadMaxTtlSeconds) {
  if (
    !Number.isFinite(now) ||
    !Number.isInteger(ttlSeconds) ||
    ttlSeconds < 1 ||
    ttlSeconds > artifactDownloadMaxTtlSeconds
  ) {
    throw new RangeError(`artifact download TTL must be between 1 and ${artifactDownloadMaxTtlSeconds} seconds`);
  }

  return Math.floor(now / 1000) + ttlSeconds;
}

export function signArtifactDownload(input, key = configuredArtifactDownloadSigningKey()) {
  if (!validSigningKey(key) || !Number.isSafeInteger(input.expiresAt)) {
    return undefined;
  }

  return createHmac("sha256", key).update(payload(input)).digest("base64url");
}

export function verifyArtifactDownloadSignature(input, key = configuredArtifactDownloadSigningKey(), now = Date.now()) {
  if (!Number.isFinite(now) || !Number.isSafeInteger(input.expiresAt) || !signaturePattern.test(input.signature)) {
    return false;
  }

  const nowSeconds = Math.floor(now / 1000);
  if (input.expiresAt < nowSeconds || input.expiresAt > nowSeconds + artifactDownloadMaxTtlSeconds) {
    return false;
  }

  const expected = signArtifactDownload(input, key);
  if (!expected) {
    return false;
  }

  const actualBuffer = Buffer.from(input.signature, "base64url");
  const expectedBuffer = Buffer.from(expected, "base64url");

  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function artifactDownloadUrl(input) {
  const signature = signArtifactDownload(input, input.key);
  const baseUrl = input.baseUrl ?? process.env.BOARDREADYOPS_PUBLIC_URL ?? process.env.NEXT_PUBLIC_APP_URL;

  if (!signature || !baseUrl) {
    return undefined;
  }

  let url;
  try {
    url = new URL(
      `/api/v1/runs/${encodeURIComponent(input.runId)}/artifacts/${encodeURIComponent(input.artifactId)}/download`,
      baseUrl,
    );
  } catch {
    return undefined;
  }

  url.searchParams.set("exp", String(input.expiresAt));
  url.searchParams.set("sig", signature);
  return url.toString();
}

export function safeLocalArtifactPath(storageRoot, storagePath) {
  const root = path.resolve(storageRoot);
  const candidate = path.resolve(root, storagePath);
  return isInside(root, candidate) ? candidate : undefined;
}

export async function resolveLocalArtifactFile(storageRoot, storagePath) {
  const lexicalCandidate = safeLocalArtifactPath(storageRoot, storagePath);
  if (!lexicalCandidate) {
    return { state: "outside-root" };
  }

  const realRoot = await realpath(path.resolve(storageRoot)).catch(() => undefined);
  if (!realRoot) {
    return { state: "storage-unavailable" };
  }

  const realCandidate = await realpath(lexicalCandidate).catch(() => undefined);
  if (!realCandidate) {
    return { state: "file-unavailable" };
  }

  return isInside(realRoot, realCandidate) ? { state: "resolved", path: realCandidate } : { state: "outside-root" };
}

export function artifactAttachmentHeader(name) {
  const normalized = name.replaceAll("\\", "/");
  const basename =
    [...path.posix.basename(normalized)]
      .map((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint < 32 || codePoint === 127 ? "_" : character;
      })
      .join("")
      .slice(0, 180) || "artifact";
  const fallback =
    basename
      .normalize("NFKD")
      .replaceAll(/\p{Mark}/gu, "")
      .replaceAll(/[^\x20-\x7e]/g, "_")
      .replaceAll(/["\\;]/g, "_")
      .slice(0, 180) || "artifact";

  return `attachment; filename="${fallback}"; filename*=UTF-8''${rfc5987Value(basename)}`;
}
