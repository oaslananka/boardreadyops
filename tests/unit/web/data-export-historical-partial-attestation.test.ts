import { generateKeyPairSync, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  signHistoricalUserPartialObservation,
  verifyHistoricalUserPartialObservation,
  verifyHistoricalUserPartialObservationCurrent,
} from "../../../apps/web/lib/data-export-historical-partial-attestation.js";
import { verifyReservedHistoricalUserPrivatePartial } from "../../../apps/web/lib/data-export-historical-partial-read.js";
import { assessHistoricalUserSourceScope } from "../../../packages/db/src/data-export-historical-source-scope.js";

vi.mock("../../../packages/db/src/data-export-historical-source-scope.js", () => ({
  assessHistoricalUserSourceScope: vi.fn(),
}));

vi.mock("../../../apps/web/lib/data-export-historical-partial-read.js", () => ({
  verifyReservedHistoricalUserPrivatePartial: vi.fn(),
}));

const verifiedRead = vi.mocked(verifyReservedHistoricalUserPrivatePartial);
const scopeCheck = vi.mocked(assessHistoricalUserSourceScope);
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
    keyId: "historical-source-only-ed25519-v2",
    privateKey,
  };
  return {
    ...input,
    publicKey,
    expected: {
      trustedPublicKey: publicKey,
      expectedKeyId: input.keyId,
      expectedBinding: binding,
      expectedSourceScopeSha256: "a".repeat(64),
      nowMs: now,
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(now);
  scopeCheck.mockResolvedValue({
    status: "known-relational-source-scope-unapproved",
    releaseDecision: "NO_GO",
    completeCustomerExport: false,
    customerDeliveryAllowed: false,
    sourceRightsVerified: false,
    thirdPartyDisclosureRightsVerified: false,
    tableCount: 92,
    sourceClassCount: 19,
    scopeFingerprintSha256: "a".repeat(64),
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
      formatVersion: 2,
      sourceScopeSha256: "a".repeat(64),
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

  it.each(["schema_drift", "unavailable", "foreign-scope", "ambiguous-owner"] as const)(
    "refuses to sign when the unified source snapshot reports %s",
    async () => {
      const f = fixture();
      scopeCheck.mockResolvedValueOnce(null);
      expect(await signHistoricalUserPartialObservation(f)).toBeNull();
      // The pre-read scope guard rejects the request BEFORE reserving
      // or touching the private ZIP, unlike the previous post-only guard.
      expect(verifiedRead).not.toHaveBeenCalled();
      expect(scopeCheck).toHaveBeenCalledExactlyOnceWith(f.db, {
        exportId: f.binding.exportId,
        verifiedGitHubUserId: f.binding.verifiedGitHubUserId,
      });
    },
  );

  it("pins owner/source scope before and after the entire reserved private ZIP read", async () => {
    const f = fixture();
    const order: string[] = [];
    scopeCheck.mockImplementation(async () => {
      order.push("source-read");
      return {
        status: "known-relational-source-scope-unapproved",
        releaseDecision: "NO_GO",
        completeCustomerExport: false,
        customerDeliveryAllowed: false,
        sourceRightsVerified: false,
        thirdPartyDisclosureRightsVerified: false,
        tableCount: 92,
        sourceClassCount: 19,
        scopeFingerprintSha256: "a".repeat(64),
      };
    });
    verifiedRead.mockImplementationOnce(async () => {
      order.push("private-zip");
      return {
        sha256: f.binding.sha256,
        byteLength: f.binding.byteLength,
        completeCustomerExport: false,
        customerDeliveryAllowed: false,
      };
    });
    const proof = await signHistoricalUserPartialObservation(f);
    expect(order).toEqual(["source-read", "private-zip", "source-read"]);
    expect(proof?.sourceScopeSha256).toBe("a".repeat(64));
  });

  it("refuses a signature when the source fingerprint changes DURING the reserved ZIP read", async () => {
    const f = fixture();
    const original = { ...f.binding };
    scopeCheck.mockResolvedValueOnce({
      status: "known-relational-source-scope-unapproved",
      releaseDecision: "NO_GO",
      completeCustomerExport: false,
      customerDeliveryAllowed: false,
      sourceRightsVerified: false,
      thirdPartyDisclosureRightsVerified: false,
      tableCount: 92,
      sourceClassCount: 19,
      scopeFingerprintSha256: "a".repeat(64),
    });
    verifiedRead.mockImplementationOnce(async () => {
      // Simulate a real committed owner-bound count or ABA-epoch mutation
      // while the private archive is being verified.
      scopeCheck.mockResolvedValueOnce({
        status: "known-relational-source-scope-unapproved",
        releaseDecision: "NO_GO",
        completeCustomerExport: false,
        customerDeliveryAllowed: false,
        sourceRightsVerified: false,
        thirdPartyDisclosureRightsVerified: false,
        tableCount: 92,
        sourceClassCount: 19,
        scopeFingerprintSha256: "b".repeat(64),
      });
      return {
        sha256: original.sha256,
        byteLength: original.byteLength,
        completeCustomerExport: false,
        customerDeliveryAllowed: false,
      };
    });
    expect(await signHistoricalUserPartialObservation(f)).toBeNull();
    expect(scopeCheck).toHaveBeenCalledTimes(2);
    expect(verifiedRead).toHaveBeenCalledOnce();
  });

  it("denies a failed second source read even after the reserved private ZIP read succeeds", async () => {
    const f = fixture();
    scopeCheck.mockResolvedValueOnce({
      status: "known-relational-source-scope-unapproved",
      releaseDecision: "NO_GO",
      completeCustomerExport: false,
      customerDeliveryAllowed: false,
      sourceRightsVerified: false,
      thirdPartyDisclosureRightsVerified: false,
      tableCount: 92,
      sourceClassCount: 19,
      scopeFingerprintSha256: "a".repeat(64),
    });
    scopeCheck.mockResolvedValueOnce(null);
    expect(await signHistoricalUserPartialObservation(f)).toBeNull();
    expect(verifiedRead).toHaveBeenCalledOnce();
  });

  it("keeps the frozen original USER in both scopes when caller mutates identity during ZIP verification", async () => {
    const f = fixture();
    const original = f.binding.verifiedGitHubUserId;
    verifiedRead.mockImplementationOnce(async () => {
      f.binding.verifiedGitHubUserId++;
      return {
        sha256: f.binding.sha256,
        byteLength: f.binding.byteLength,
        completeCustomerExport: false,
        customerDeliveryAllowed: false,
      };
    });
    const signed = await signHistoricalUserPartialObservation(f);
    expect(signed?.verifiedGitHubUserId).toBe(original);
    expect(scopeCheck).toHaveBeenCalledTimes(2);
    for (const call of scopeCheck.mock.calls) {
      expect(call[1]).toEqual({ exportId: f.binding.exportId, verifiedGitHubUserId: original });
    }
  });

  it("does not sign when unified source snapshot inspection throws", async () => {
    const f = fixture();
    scopeCheck.mockRejectedValueOnce(new Error("No database scope access"));
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
    ["different source scope", () => ({ expectedSourceScopeSha256: "b".repeat(64) })],
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
    ["source scope digest changed", { sourceScopeSha256: "b".repeat(64) }],
    ["legacy v1 downgrade", { formatVersion: 1 }],
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

  it("rejects a cryptographically valid but stale observation after original USER source-count drift", async () => {
    const f = fixture();
    const proof = await signHistoricalUserPartialObservation(f);
    expect(await verifyHistoricalUserPartialObservationCurrent({ ...f.expected, db: f.db, observation: proof })).toBe(
      true,
    );
    scopeCheck.mockResolvedValueOnce({
      status: "known-relational-source-scope-unapproved",
      releaseDecision: "NO_GO",
      completeCustomerExport: false,
      customerDeliveryAllowed: false,
      sourceRightsVerified: false,
      thirdPartyDisclosureRightsVerified: false,
      tableCount: 92,
      sourceClassCount: 19,
      scopeFingerprintSha256: "b".repeat(64),
    });
    expect(verifyHistoricalUserPartialObservation({ ...f.expected, observation: proof })).toBe(true);
    expect(await verifyHistoricalUserPartialObservationCurrent({ ...f.expected, db: f.db, observation: proof })).toBe(
      false,
    );
  });

  it("rejects stale, unavailable or promoted-source observations before customer delivery", async () => {
    const f = fixture();
    const proof = await signHistoricalUserPartialObservation(f);
    scopeCheck.mockResolvedValueOnce(null);
    expect(await verifyHistoricalUserPartialObservationCurrent({ ...f.expected, db: f.db, observation: proof })).toBe(
      false,
    );
    scopeCheck.mockRejectedValueOnce(new Error("Snapshot read failed"));
    expect(await verifyHistoricalUserPartialObservationCurrent({ ...f.expected, db: f.db, observation: proof })).toBe(
      false,
    );
    scopeCheck.mockResolvedValueOnce({
      status: "known-relational-source-scope-unapproved",
      releaseDecision: "NO_GO",
      completeCustomerExport: false,
      customerDeliveryAllowed: true,
      sourceRightsVerified: false,
      thirdPartyDisclosureRightsVerified: false,
      tableCount: 92,
      sourceClassCount: 19,
      scopeFingerprintSha256: "a".repeat(64),
    } as never);
    expect(await verifyHistoricalUserPartialObservationCurrent({ ...f.expected, db: f.db, observation: proof })).toBe(
      false,
    );
  });

  it("does not query the DB for tampered signatures, legacy v1 or wrong original USER identity", async () => {
    const f = fixture();
    const proof = await signHistoricalUserPartialObservation(f);
    scopeCheck.mockClear();
    for (const observation of [
      { ...proof, formatVersion: 1 },
      { ...proof, sourceScopeSha256: "b".repeat(64) },
      { ...proof, customerDeliveryAllowed: true },
    ]) {
      expect(await verifyHistoricalUserPartialObservationCurrent({ ...f.expected, db: f.db, observation })).toBe(false);
    }
    expect(
      await verifyHistoricalUserPartialObservationCurrent({
        ...f.expected,
        db: f.db,
        observation: proof,
        expectedBinding: { ...f.binding, verifiedGitHubUserId: f.binding.verifiedGitHubUserId + 1 },
      }),
    ).toBe(false);
    expect(scopeCheck).not.toHaveBeenCalled();
  });

  it("never signs a malformed, missing or delivery-promoted source-scope observation", async () => {
    const f = fixture();
    for (const change of [
      { scopeFingerprintSha256: "b" },
      { sourceClassCount: 18 },
      { customerDeliveryAllowed: true },
      { sourceRightsVerified: true },
    ]) {
      scopeCheck.mockResolvedValueOnce({
        status: "known-relational-source-scope-unapproved",
        releaseDecision: "NO_GO",
        completeCustomerExport: false,
        customerDeliveryAllowed: false,
        sourceRightsVerified: false,
        thirdPartyDisclosureRightsVerified: false,
        tableCount: 92,
        sourceClassCount: 19,
        scopeFingerprintSha256: "a".repeat(64),
        ...change,
      } as never);
      expect(await signHistoricalUserPartialObservation(f)).toBeNull();
    }
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
