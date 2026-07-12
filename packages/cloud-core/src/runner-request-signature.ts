import { createHash, type KeyLike, sign as signBytes, verify as verifyBytes } from "node:crypto";

const canonicalPrefix = "boardreadyops-runner-request-v1";
const canonicalBaseUrl = "https://boardreadyops.invalid";
const lowercaseUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/u;

export type RunnerRequestWorkerClass = "managed" | "self_hosted";

export type CanonicalRunnerRequestInput = {
  method: string;
  path: string;
  timestamp: number;
  nonce: string;
  workerClass: RunnerRequestWorkerClass;
  runnerId: string;
  runId?: string;
  executionAttemptId?: string;
  leaseId?: string;
  body: string | Buffer;
};

export type SignRunnerRequestInput = CanonicalRunnerRequestInput & {
  privateKey: KeyLike;
};

export type VerifyRunnerRequestSignatureInput = CanonicalRunnerRequestInput & {
  publicKey: KeyLike;
  signature: string;
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function encodeQueryComponent(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function assertLowercaseUuid(name: string, value: string | undefined): string {
  if (value === undefined) {
    return "";
  }
  if (!lowercaseUuidPattern.test(value)) {
    throw new Error(`${name} must be a lowercase UUID`);
  }
  return value;
}

function assertNonce(value: string): string {
  if (value.length < 22 || value.length > 128 || !base64UrlPattern.test(value)) {
    throw new Error("runner request nonce must be 22-128 base64url characters");
  }
  return value;
}

export function runnerRequestBodyDigest(body: string | Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

export function normalizeRunnerRequestPath(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("#") || path.includes("\\")) {
    throw new Error("runner request path must be an absolute application path without a fragment");
  }

  const rawPath = path.split("?", 1)[0] ?? path;
  if (/%2f|%5c/iu.test(rawPath)) {
    throw new Error("runner request path cannot contain encoded path separators");
  }

  for (const segment of rawPath.split("/")) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new Error("runner request path contains invalid percent encoding");
    }
    if (decoded === "." || decoded === "..") {
      throw new Error("runner request path cannot contain dot segments");
    }
  }

  const url = new URL(path, canonicalBaseUrl);
  if (url.origin !== canonicalBaseUrl) {
    throw new Error("runner request path must remain within the application origin");
  }

  const query = [...url.searchParams.entries()]
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      const keyOrder = compareText(leftKey, rightKey);
      return keyOrder === 0 ? compareText(leftValue, rightValue) : keyOrder;
    })
    .map(([key, value]) => `${encodeQueryComponent(key)}=${encodeQueryComponent(value)}`)
    .join("&");

  return query.length === 0 ? url.pathname : `${url.pathname}?${query}`;
}

export function canonicalRunnerRequest(input: CanonicalRunnerRequestInput): string {
  const method = input.method.toUpperCase();
  if (!/^[A-Z]+$/u.test(method)) {
    throw new Error("runner request method must contain only ASCII letters");
  }
  if (!Number.isSafeInteger(input.timestamp) || input.timestamp < 0 || input.timestamp > 9_999_999_999) {
    throw new Error("runner request timestamp must be a non-negative integer in seconds");
  }
  if (input.workerClass !== "managed" && input.workerClass !== "self_hosted") {
    throw new Error("unsupported runner worker class");
  }

  return [
    canonicalPrefix,
    method,
    normalizeRunnerRequestPath(input.path),
    String(input.timestamp),
    assertNonce(input.nonce),
    input.workerClass,
    assertLowercaseUuid("runnerId", input.runnerId),
    assertLowercaseUuid("runId", input.runId),
    assertLowercaseUuid("executionAttemptId", input.executionAttemptId),
    assertLowercaseUuid("leaseId", input.leaseId),
    runnerRequestBodyDigest(input.body),
  ].join("\n");
}

export function signRunnerRequest(input: SignRunnerRequestInput): string {
  return signBytes(null, Buffer.from(canonicalRunnerRequest(input), "utf8"), input.privateKey).toString("base64url");
}

export function verifyRunnerRequestSignature(input: VerifyRunnerRequestSignatureInput): boolean {
  if (input.signature.length !== 86 || !base64UrlPattern.test(input.signature)) {
    return false;
  }

  try {
    const signature = Buffer.from(input.signature, "base64url");
    if (signature.byteLength !== 64 || signature.toString("base64url") !== input.signature) {
      return false;
    }
    return verifyBytes(null, Buffer.from(canonicalRunnerRequest(input), "utf8"), input.publicKey, signature);
  } catch {
    return false;
  }
}
