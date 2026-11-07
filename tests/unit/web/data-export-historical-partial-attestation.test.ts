import { generateKeyPairSync, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  signHistoricalUserPartialObservation,
  verifyHistoricalUserPartialObservation,
} from "../../../apps/web/lib/data-export-historical-partial-attestation.js";
import { verifyReservedHistoricalUserPrivatePartial } from "../../../apps/web/lib/data-export-historical-partial-read.js";
import { assessHistoricalUserSchemaCoverage } from "../../../packages/db/src/data-export-historical-schema-coverage.js";

vi.mock("../../../packages/db/src/data-export-historical-schema-coverage.js", () => ({
  assessHistoricalUserSchemaCoverage: vi.fn(),
}));

vi.mock("../../../apps/web/lib/data-export-historical-partial-read.js", () => ({
  verifyReservedHistoricalUserPrivatePartial: vi.fn(),
}));

const verifiedRead = vi.mocked(verifyReservedHistoricalUserPrivatePartial);
const schemaCheck = vi.mocked(assessHistoricalUserSchemaCoverage);
const now = 1794015000000;
const lifetime = 5 * 60_000;

function fixture() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const binding = {
    exportId: randomUUID(),
    verifiedGitHubUserId: 91541,
    preflightId: randomUUID(),
    sha256: "a".repeat(64),
    byteLength: 1024,
  };
  const input = {
    db: { query: vi.fn(), withTransaction: vi.fn() } as never,
    archiveRoot: "/owner-private/.private-export-archives",
    binding,
    keyId: "historical-source-only-ed25519-v1",
    privateKey,
  };
  return {
    ...input,
    publicKey,
    expected: {
      trustedPublicKey: publicKey,
      expectedKeyId: input.keyId,
      expectedBinding: binding,
      nowMs: now,
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(now);
  schemaCheck.mockResolvedValue({
    status: "known_schema_scope_unapproved",
    releaseDecision: "NO_GO",
    completeCustomerExport: false,
    customerDeliveryAllowed: false,
    tableCount: 92,
    columnCount: 1033,
    partialPrivateMetadataTableCount: 13,
    withheldSensitiveTableCount: 16,
    otherTablesRequiringScopeReview: 63,
    unresolvedReviewTrackCounts: {
      privacy_lifecycle: 17,
      billing_and_marketplace: 5,
      hardware_and_release: 19,
      collaboration_and_workspace: 10,
      platform_operations: 12,
    },
    unrecognizedTableCount: 0,
    schemaSha256: "45d6db6d25b6e61a0950333a5f9d81b17e2895c21736688b08cc00d49b3dfe63",
  });
  verifiedRead.mockImplementation(async (input) => ({
    sha256: input.sha256,
    byteLength: input.byteLength,
    completeCustomerExport: false,
    customerDeliveryAllowed: false,
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("source-only original USER signed partial integrity observations", () => {
  it("signs only after independent physical and DB admission; pins key, USER and archive identity", async () => {
    const f = fixture();
    const proof = await signHistoricalUserPartialObservation(f);
    expect(proof).toMatchObject({
      kind: "boardreadyops.historical-user-source-only-partial-observation",
      scope: "partial-integrity-only-not-customer-delivery",
      formatVersion: 1,
      completeCustomerExport: false,
      customerDeliveryAllowed: false,
      ...f.binding,
      keyId: f.keyId,
      issuedAtMs: now,
      expiresAtMs: now + lifetime,
    });
    expect(proof?.signature).toMatch(/^[A-Za-z0-9_-]{86}$/u);
    expect(verifiedRead).toHaveBeenCalledExactlyOnceWith({
      db: f.db,
      archiveRoot: f.archiveRoot,
      authority: { exportId: f.binding.exportId, verifiedGitHubUserId: f.binding.verifiedGitHubUserId },
      preflightId: f.binding.preflightId,
      sha256: f.binding.sha256,
      byteLength: f.binding.byteLength,
    });
    expect(verifyHistoricalUserPartialObservation({ ...f.expected, observation: proof })).toBe(true);
    expect(
      verifyHistoricalUserPartialObservation({ ...f.expected, observation: proof, nowMs: now + lifetime - 1 }),
    ).toBe(true);
  });

  it.each([
    ["no committed read", null],
    [
      "wrong archive hash",
      { sha256: "b".repeat(64), byteLength: 1024, completeCustomerExport: false, customerDeliveryAllowed: false },
    ],
    [
      "wrong archive size",
      { sha256: "a".repeat(64), byteLength: 1023, completeCustomerExport: false, customerDeliveryAllowed: false },
    ],
    [
      "invalid delivery claim",
      { sha256: "a".repeat(64), byteLength: 1024, completeCustomerExport: false, customerDeliveryAllowed: true },
    ],
    [
      "fake complete customer export",
      { sha256: "a".repeat(64), byteLength: 1024, completeCustomerExport: true, customerDeliveryAllowed: false },
    ],
  ] as const)("does not sign %s", async (_, result) => {
    const f = fixture();
    verifiedRead.mockResolvedValueOnce(result as never);
    expect(await signHistoricalUserPartialObservation(f)).toBeNull();
  });

  it.each(["schema_drift", "unavailable"] as const)(
    "refuses to sign a verified ZIP when database catalog status is %s",
    async (status) => {
      const f = fixture();
      schemaCheck.mockResolvedValueOnce({ status } as never);
      expect(await signHistoricalUserPartialObservation(f)).toBeNull();
      expect(verifiedRead).toHaveBeenCalledOnce();
      expect(schemaCheck).toHaveBeenCalledExactlyOnceWith(f.db);
    },
  );

  it("does not sign a verified ZIP if PostgreSQL schema inspection throws", async () => {
    const f = fixture();
    schemaCheck.mockRejectedValueOnce(new Error("No permissions to inspect catalog"));
    expect(await signHistoricalUserPartialObservation(f)).toBeNull();
  });

  it("does not sign provider failures, failed DB releases or rejected key types", async () => {
    const f = fixture();
    verifiedRead.mockRejectedValueOnce(new Error("Original USER authorization failed"));
    expect(await signHistoricalUserPartialObservation(f)).toBeNull();
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    expect(await signHistoricalUserPartialObservation({ ...f, privateKey: other.privateKey })).toBeNull();
    expect(verifiedRead).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "other numeric original user",
      (f: ReturnType<typeof fixture>) => ({ expectedBinding: { ...f.binding, verifiedGitHubUserId: 91542 } }),
    ],
    [
      "other export",
      (f: ReturnType<typeof fixture>) => ({ expectedBinding: { ...f.binding, exportId: randomUUID() } }),
    ],
    [
      "other private preflight",
      (f: ReturnType<typeof fixture>) => ({ expectedBinding: { ...f.binding, preflightId: randomUUID() } }),
    ],
    [
      "other ZIP sha256",
      (f: ReturnType<typeof fixture>) => ({ expectedBinding: { ...f.binding, sha256: "b".repeat(64) } }),
    ],
    [
      "other archive byte length",
      (f: ReturnType<typeof fixture>) => ({ expectedBinding: { ...f.binding, byteLength: 1023 } }),
    ],
    ["different key ID", () => ({ expectedKeyId: "rotated-key" })],
    ["expired", () => ({ nowMs: now + lifetime })],
    ["before observation issued", () => ({ nowMs: now - 1 })],
  ] as const)("rejects valid signature under %s", async (_, mutate) => {
    const f = fixture();
    const proof = await signHistoricalUserPartialObservation(f);
    expect(verifyHistoricalUserPartialObservation({ ...f.expected, observation: proof, ...mutate(f) })).toBe(false);
  });

  it("refuses a different pinned signing key even when all claims match", async () => {
    const f = fixture();
    const proof = await signHistoricalUserPartialObservation(f);
    const other = generateKeyPairSync("ed25519");
    expect(
      verifyHistoricalUserPartialObservation({ ...f.expected, trustedPublicKey: other.publicKey, observation: proof }),
    ).toBe(false);
  });

  it.each([
    ["purpose promoted to customer", { scope: "customer-delivery-ready" }],
    ["customer ready flag", { customerDeliveryAllowed: true }],
    ["complete archive lie", { completeCustomerExport: true }],
    ["additional unapproved field", { downloadUrl: "https://example.test/file" }],
    ["altered signing time", { issuedAtMs: now + 1 }],
    ["altered expiry", { expiresAtMs: now + lifetime + 1 }],
    ["modified signature", { signature: "A".repeat(86) }],
  ] as const)("rejects a tampered proof with %s", async (_, changed) => {
    const f = fixture();
    const proof = await signHistoricalUserPartialObservation(f);
    expect(verifyHistoricalUserPartialObservation({ ...f.expected, observation: { ...proof, ...changed } })).toBe(
      false,
    );
  });

  it("rejects missing/invalid canonical signatures and an unsupported public key type", async () => {
    const f = fixture();
    const proof = await signHistoricalUserPartialObservation(f);
    expect(verifyHistoricalUserPartialObservation({ ...f.expected, observation: null })).toBe(false);
    expect(verifyHistoricalUserPartialObservation({ ...f.expected, observation: { ...proof, signature: "abc" } })).toBe(
      false,
    );
    expect(verifyHistoricalUserPartialObservation({ ...f.expected, observation: { ...proof, signature: "!" } })).toBe(
      false,
    );
    expect(
      verifyHistoricalUserPartialObservation({ ...f.expected, observation: proof, trustedPublicKey: f.privateKey }),
    ).toBe(false);
  });

  it.each([
    ["zero numeric USER", (f: ReturnType<typeof fixture>) => ({ ...f.binding, verifiedGitHubUserId: 0 })],
    ["wrong preflight shape", (f: ReturnType<typeof fixture>) => ({ ...f.binding, preflightId: "not-uuid" })],
    ["bad SHA", (f: ReturnType<typeof fixture>) => ({ ...f.binding, sha256: "f" })],
    ["oversized ZIP", (f: ReturnType<typeof fixture>) => ({ ...f.binding, byteLength: 64 * 1024 * 1024 + 1 })],
  ] as const)("rejects malformed request %s without touching DB or disk", async (_, mutate) => {
    const f = fixture();
    expect(await signHistoricalUserPartialObservation({ ...f, binding: mutate(f) })).toBeNull();
    expect(verifiedRead).not.toHaveBeenCalled();
  });

  it("freezes bound original USER and ZIP fields before an async verification modifies its input", async () => {
    const f = fixture();
    const originalUser = f.binding.verifiedGitHubUserId;
    verifiedRead.mockImplementationOnce(async () => {
      f.binding.verifiedGitHubUserId += 1;
      return {
        sha256: f.binding.sha256,
        byteLength: f.binding.byteLength,
        completeCustomerExport: false,
        customerDeliveryAllowed: false,
      };
    });
    const proof = await signHistoricalUserPartialObservation(f);
    expect(proof?.verifiedGitHubUserId).toBe(originalUser);
    expect(
      verifyHistoricalUserPartialObservation({
        ...f.expected,
        expectedBinding: { ...f.binding, verifiedGitHubUserId: originalUser },
        observation: proof,
      }),
    ).toBe(true);
    expect(verifyHistoricalUserPartialObservation({ ...f.expected, observation: proof })).toBe(false);
  });
});
