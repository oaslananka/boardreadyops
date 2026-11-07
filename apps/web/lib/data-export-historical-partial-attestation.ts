import { type KeyObject, sign, verify } from "node:crypto";
import {
  assessHistoricalUserSourceScope,
  type HistoricalUserSourceScopeObservation,
} from "../../../packages/db/src/data-export-historical-source-scope.js";
import type { PgQueryExecutor } from "../../../packages/db/src/pg-executor.js";
import { verifyReservedHistoricalUserPrivatePartial } from "./data-export-historical-partial-read.js";

const domain = Buffer.from("boardreadyops:historical-user:source-only-partial-observation:v2\0", "utf8");
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
const sha256 = /^[0-9a-f]{64}$/u;
const keyIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;
const lifetimeMs = 5 * 60 * 1000;
const maxArchiveBytes = 64 * 1024 * 1024;

type OriginalUserBinding = {
  exportId: string;
  verifiedGitHubUserId: number;
  preflightId: string;
  sha256: string;
  byteLength: number;
};

export type HistoricalUserPartialObservation = OriginalUserBinding & {
  kind: "boardreadyops.historical-user-source-only-partial-observation";
  formatVersion: 2;
  scope: "partial-integrity-only-not-customer-delivery";
  sourceScopeSha256: string;
  completeCustomerExport: false;
  customerDeliveryAllowed: false;
  keyId: string;
  issuedAtMs: number;
  expiresAtMs: number;
  signature: string;
};

const payloadFields = [
  "kind",
  "formatVersion",
  "scope",
  "completeCustomerExport",
  "customerDeliveryAllowed",
  "keyId",
  "exportId",
  "verifiedGitHubUserId",
  "preflightId",
  "sha256",
  "byteLength",
  "sourceScopeSha256",
  "issuedAtMs",
  "expiresAtMs",
] as const;

function validBinding(value: unknown): value is OriginalUserBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.exportId === "string" &&
    uuid.test(row.exportId) &&
    typeof row.verifiedGitHubUserId === "number" &&
    Number.isSafeInteger(row.verifiedGitHubUserId) &&
    row.verifiedGitHubUserId > 0 &&
    typeof row.preflightId === "string" &&
    uuid.test(row.preflightId) &&
    typeof row.sha256 === "string" &&
    sha256.test(row.sha256) &&
    typeof row.byteLength === "number" &&
    Number.isSafeInteger(row.byteLength) &&
    row.byteLength > 0 &&
    row.byteLength <= maxArchiveBytes
  );
}

function validClock(nowMs: unknown): nowMs is number {
  return typeof nowMs === "number" && Number.isSafeInteger(nowMs) && nowMs > 0;
}

function validKeyId(keyId: unknown): keyId is string {
  return typeof keyId === "string" && keyIdPattern.test(keyId);
}

function observationBytes(value: Omit<HistoricalUserPartialObservation, "signature">): Buffer {
  // Sign an ordered allowlist, not caller-supplied object serialization.
  return Buffer.concat([domain, Buffer.from(JSON.stringify(payloadFields.map((field) => value[field])), "utf8")]);
}

function isValidObservation(value: unknown, nowMs: number): value is HistoricalUserPartialObservation {
  if (!value || typeof value !== "object" || Array.isArray(value) || !validClock(nowMs) || !validBinding(value))
    return false;
  const row = value as unknown as Record<string, unknown>;
  if (
    Object.keys(row).length !== payloadFields.length + 1 ||
    ![...payloadFields, "signature"].every((key) => Object.hasOwn(row, key)) ||
    !validKeyId(row.keyId) ||
    row.kind !== "boardreadyops.historical-user-source-only-partial-observation" ||
    row.formatVersion !== 2 ||
    row.scope !== "partial-integrity-only-not-customer-delivery" ||
    typeof row.sourceScopeSha256 !== "string" ||
    !sha256.test(row.sourceScopeSha256) ||
    row.completeCustomerExport !== false ||
    row.customerDeliveryAllowed !== false ||
    !validClock(row.issuedAtMs) ||
    !validClock(row.expiresAtMs) ||
    row.expiresAtMs - row.issuedAtMs !== lifetimeMs ||
    row.issuedAtMs > nowMs ||
    nowMs >= row.expiresAtMs ||
    typeof row.signature !== "string" ||
    !/^[A-Za-z0-9_-]{86}$/u.test(row.signature)
  )
    return false;
  const decoded = Buffer.from(row.signature, "base64url");
  return decoded.length === 64 && decoded.toString("base64url") === row.signature;
}

/**
 * Both BEFORE and AFTER physical verification, require the same owner-bound
 * NO_GO scope. These are separate read-only PostgreSQL snapshots; equality
 * detects catalog/count and covered mutation-epoch drift during the read,
 * not a DB+filesystem atomic transaction or a customer entitlement.
 */
function validPrivateScope(
  scope: HistoricalUserSourceScopeObservation | null,
): scope is HistoricalUserSourceScopeObservation {
  return (
    scope?.status === "known-relational-source-scope-unapproved" &&
    scope.releaseDecision === "NO_GO" &&
    scope.completeCustomerExport === false &&
    scope.customerDeliveryAllowed === false &&
    scope.sourceRightsVerified === false &&
    scope.thirdPartyDisclosureRightsVerified === false &&
    scope.tableCount === 92 &&
    scope.sourceClassCount === 19 &&
    sha256.test(scope.scopeFingerprintSha256)
  );
}

/**
 * Source-only proof of an INTERNAL privacy-preserving verification event.
 *
 * The original numeric USER, live private preflight, local ZIP and retained
 * objects MUST be rechecked by verifyReservedHistoricalUserPrivatePartial.
 * Only a COMMITTED reader release permits a signature. This does NOT prove
 * a complete DB/FS snapshot, source/IP rights or authorization for customer
 * disclosure. It never returns archive bytes or publishes a capability.
 */
export async function signHistoricalUserPartialObservation(input: {
  db: PgQueryExecutor;
  archiveRoot: string;
  binding: OriginalUserBinding;
  keyId: string;
  privateKey: KeyObject;
}): Promise<HistoricalUserPartialObservation | null> {
  if (
    !validBinding(input?.binding) ||
    !validKeyId(input?.keyId) ||
    input?.privateKey?.type !== "private" ||
    input.privateKey.asymmetricKeyType !== "ed25519"
  )
    return null;

  // Freeze all original USER/file identity before the asynchronous read.
  const binding: OriginalUserBinding = {
    exportId: input.binding.exportId,
    verifiedGitHubUserId: input.binding.verifiedGitHubUserId,
    preflightId: input.binding.preflightId,
    sha256: input.binding.sha256,
    byteLength: input.binding.byteLength,
  };
  try {
    // Capture source catalog, owner-scoped row counts and existing mutation
    // epochs BEFORE physical ZIP verification. The second check below must
    // match this exact digest or the signer refuses the observation.
    const authority = { exportId: binding.exportId, verifiedGitHubUserId: binding.verifiedGitHubUserId };
    const initialScope = await assessHistoricalUserSourceScope(input.db, authority);
    if (!validPrivateScope(initialScope)) return null;

    const receipt = await verifyReservedHistoricalUserPrivatePartial({
      db: input.db,
      archiveRoot: input.archiveRoot,
      authority,
      preflightId: binding.preflightId,
      sha256: binding.sha256,
      byteLength: binding.byteLength,
    });
    if (
      receipt?.sha256 !== binding.sha256 ||
      receipt.byteLength !== binding.byteLength ||
      receipt.completeCustomerExport !== false ||
      receipt.customerDeliveryAllowed !== false
    )
      return null;
    // Re-sample after the physical ZIP read and durable reader release.
    // Fail closed on original-USER schema, hardware-count or tracked ABA
    // epoch changes while IO was in progress; do NOT assert this guards
    // untracked row edits or supplies a DB/FS atomic materialization.
    const scope = await assessHistoricalUserSourceScope(input.db, authority);
    if (!validPrivateScope(scope) || scope.scopeFingerprintSha256 !== initialScope.scopeFingerprintSha256) return null;
    // Never accept an externally selected signing time.
    const issuedAtMs = Date.now();
    if (!validClock(issuedAtMs)) return null;
    const payload: Omit<HistoricalUserPartialObservation, "signature"> = {
      kind: "boardreadyops.historical-user-source-only-partial-observation",
      formatVersion: 2,
      scope: "partial-integrity-only-not-customer-delivery",
      sourceScopeSha256: scope.scopeFingerprintSha256,
      completeCustomerExport: false,
      customerDeliveryAllowed: false,
      keyId: input.keyId,
      ...binding,
      issuedAtMs,
      expiresAtMs: issuedAtMs + lifetimeMs,
    };
    if (!validClock(payload.expiresAtMs)) return null;
    const message = observationBytes(payload);
    try {
      const signature = sign(null, message, input.privateKey).toString("base64url");
      return { ...payload, signature };
    } finally {
      // The observation contains the original numeric USER; clear the
      // transient canonical signing message, retaining only the signed claim.
      message.fill(0);
    }
  } catch {
    // No error details, key bytes, original USER identity or source data escape.
    return null;
  }
}

/** Cryptographic check only; never a customer right, refresh or live entitlement. */
export function verifyHistoricalUserPartialObservation(input: {
  observation: unknown;
  trustedPublicKey: KeyObject;
  expectedKeyId: string;
  expectedBinding: OriginalUserBinding;
  expectedSourceScopeSha256: string;
  nowMs?: number;
}): boolean {
  const nowMs = input?.nowMs ?? Date.now();
  const proof = input?.observation;
  if (
    !isValidObservation(proof, nowMs) ||
    !validBinding(input.expectedBinding) ||
    typeof input.expectedSourceScopeSha256 !== "string" ||
    !sha256.test(input.expectedSourceScopeSha256) ||
    !validKeyId(input.expectedKeyId) ||
    input?.trustedPublicKey?.type !== "public" ||
    input.trustedPublicKey.asymmetricKeyType !== "ed25519" ||
    proof.keyId !== input.expectedKeyId ||
    proof.exportId !== input.expectedBinding.exportId ||
    proof.verifiedGitHubUserId !== input.expectedBinding.verifiedGitHubUserId ||
    proof.preflightId !== input.expectedBinding.preflightId ||
    proof.sha256 !== input.expectedBinding.sha256 ||
    proof.byteLength !== input.expectedBinding.byteLength ||
    proof.sourceScopeSha256 !== input.expectedSourceScopeSha256
  )
    return false;
  try {
    const signature = Buffer.from(proof.signature, "base64url");
    const message = observationBytes(proof);
    try {
      return verify(null, message, input.trustedPublicKey, signature);
    } finally {
      message.fill(0);
    }
  } catch {
    return false;
  }
}

/**
 * INTERNAL physical+source LIVE re-verification. A signature attests only
 * to a past PRIVATE partial ZIP, never a customer entitlement.
 *
 * Read original USER scope before and after a separately reserved physical
 * ZIP recheck. The signature must remain valid under the TRUSTED server
 * clock after all DB and physical IO. An expired five-minute claim, clock
 * rollback, changed source, missing ZIP or failed durable release deny.
 * Independent DB snapshots + filesystem IO are NOT atomic DB+FS proof.
 */
export async function verifyHistoricalUserPartialObservationCurrent(input: {
  db: PgQueryExecutor;
  archiveRoot: string;
  observation: unknown;
  trustedPublicKey: KeyObject;
  expectedKeyId: string;
  expectedBinding: OriginalUserBinding;
}): Promise<boolean> {
  const proof = input?.observation;
  if (!proof || typeof proof !== "object" || Array.isArray(proof)) return false;
  const expectedSourceScopeSha256 = (proof as Record<string, unknown>).sourceScopeSha256;
  const startedAtMs = Date.now();
  if (
    !validClock(startedAtMs) ||
    typeof expectedSourceScopeSha256 !== "string" ||
    !input?.db?.withTransaction ||
    !input.db.query ||
    typeof input.archiveRoot !== "string" ||
    !validBinding(input.expectedBinding)
  )
    return false;

  // Pin trusted key, original numeric USER, ZIP identity, root and DB
  // before the first async call. A mutable request cannot retarget phases.
  const binding: OriginalUserBinding = {
    exportId: input.expectedBinding.exportId,
    verifiedGitHubUserId: input.expectedBinding.verifiedGitHubUserId,
    preflightId: input.expectedBinding.preflightId,
    sha256: input.expectedBinding.sha256,
    byteLength: input.expectedBinding.byteLength,
  };
  const db = input.db;
  const archiveRoot = input.archiveRoot;
  const verification = {
    observation: proof,
    trustedPublicKey: input.trustedPublicKey,
    expectedKeyId: input.expectedKeyId,
    expectedBinding: binding,
    expectedSourceScopeSha256,
  };
  // Never spread input into this verifier: a caller-provided nowMs must
  // NEVER override the real clock in a LIVE DB/physical read.
  if (!verifyHistoricalUserPartialObservation({ ...verification, nowMs: startedAtMs })) return false;
  const authority = { exportId: binding.exportId, verifiedGitHubUserId: binding.verifiedGitHubUserId };

  try {
    const initial = await assessHistoricalUserSourceScope(db, authority);
    if (!validPrivateScope(initial) || initial.scopeFingerprintSha256 !== expectedSourceScopeSha256) return false;

    const receipt = await verifyReservedHistoricalUserPrivatePartial({
      db,
      archiveRoot,
      authority,
      preflightId: binding.preflightId,
      sha256: binding.sha256,
      byteLength: binding.byteLength,
    });
    if (
      receipt?.sha256 !== binding.sha256 ||
      receipt.byteLength !== binding.byteLength ||
      receipt.completeCustomerExport !== false ||
      receipt.customerDeliveryAllowed !== false
    )
      return false;

    const final = await assessHistoricalUserSourceScope(db, authority);
    const finishedAtMs = Date.now();
    return (
      validClock(finishedAtMs) &&
      finishedAtMs >= startedAtMs &&
      validPrivateScope(final) &&
      final.scopeFingerprintSha256 === expectedSourceScopeSha256 &&
      // The complete physically verified observation must still be within
      // its signed five-minute validity at the final trusted clock read.
      verifyHistoricalUserPartialObservation({ ...verification, nowMs: finishedAtMs })
    );
  } catch {
    return false;
  }
}
