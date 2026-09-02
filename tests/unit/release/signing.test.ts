import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadTrustStore,
  saveTrustStore,
  signManifestBytes,
  signReleaseBundle,
  type TrustStore,
  verifyManifestSignature,
  verifyManifestSignatureAgainstTrustStore,
  verifyReleaseBundleSignature,
} from "../../../src/release/signing.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

function ed25519Keypair(): { privatePem: string; publicPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "brops-sign-"));
  tempDirs.push(dir);
  return dir;
}

const SIGNED_AT = "2026-06-22T00:00:00.000Z";

describe("signManifestBytes / verifyManifestSignature", () => {
  it("round-trips a valid Ed25519 signature", () => {
    const { privatePem, publicPem } = ed25519Keypair();
    const bytes = Buffer.from('{"schemaVersion":2}\n');
    const signature = signManifestBytes(bytes, privatePem, SIGNED_AT);

    expect(signature.algorithm).toBe("ed25519");
    expect(signature.manifestDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyManifestSignature(bytes, signature)).toEqual({ ok: true, errors: [], errorCodes: [] });
    expect(verifyManifestSignature(bytes, signature, publicPem).ok).toBe(true);
  });

  it("fails when the manifest bytes are tampered", () => {
    const { privatePem } = ed25519Keypair();
    const signature = signManifestBytes(Buffer.from("original"), privatePem, SIGNED_AT);
    const result = verifyManifestSignature(Buffer.from("tampered"), signature);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/digest|does not match/);
    expect(result.errorCodes).toContain("DIGEST_MISMATCH");
  });

  it("fails when a different trusted public key is pinned", () => {
    const { privatePem } = ed25519Keypair();
    const other = ed25519Keypair();
    const bytes = Buffer.from("payload");
    const signature = signManifestBytes(bytes, privatePem, SIGNED_AT);
    const result = verifyManifestSignature(bytes, signature, other.publicPem);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/trusted public key/);
  });

  it("rejects an unsupported algorithm and non-Ed25519 keys", () => {
    const { privatePem } = ed25519Keypair();
    const bytes = Buffer.from("payload");
    const signature = signManifestBytes(bytes, privatePem, SIGNED_AT);
    expect(verifyManifestSignature(bytes, { ...signature, algorithm: "rsa" as "ed25519" }).ok).toBe(false);

    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    expect(() =>
      signManifestBytes(bytes, rsa.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), SIGNED_AT),
    ).toThrow(/Ed25519/);
  });
});

describe("signReleaseBundle / verifyReleaseBundleSignature", () => {
  it("signs a bundle manifest and verifies it back", async () => {
    const bundle = await makeTempDir();
    await fs.writeFile(path.join(bundle, "manifest.json"), '{"schemaVersion":2,"artifacts":[]}\n');
    const { privatePem, publicPem } = ed25519Keypair();

    const result = await signReleaseBundle(bundle, privatePem, SIGNED_AT);
    expect(result.signaturePath.endsWith("manifest.sig")).toBe(true);

    const verified = await verifyReleaseBundleSignature(bundle, publicPem);
    expect(verified).toMatchObject({ present: true, ok: true, errors: [] });
  });

  it("reports an absent signature and detects manifest drift", async () => {
    const bundle = await makeTempDir();
    await fs.writeFile(path.join(bundle, "manifest.json"), '{"schemaVersion":2}\n');

    const absent = await verifyReleaseBundleSignature(bundle);
    expect(absent).toMatchObject({ present: false, ok: false });

    const { privatePem } = ed25519Keypair();
    await signReleaseBundle(bundle, privatePem, SIGNED_AT);
    await fs.writeFile(path.join(bundle, "manifest.json"), '{"schemaVersion":2,"tampered":true}\n');
    const drift = await verifyReleaseBundleSignature(bundle);
    expect(drift.present).toBe(true);
    expect(drift.ok).toBe(false);
  });
});

describe("verifyManifestSignatureAgainstTrustStore", () => {
  const bytes = Buffer.from('{"schemaVersion":2}\n');

  it("accepts a signature whose key is an active, unexpired, unrevoked trust store entry", () => {
    const { privatePem, publicPem } = ed25519Keypair();
    const signature = signManifestBytes(bytes, privatePem, SIGNED_AT);
    const trustStore: TrustStore = [{ keyId: "key-2026", publicKey: publicPem, validFrom: "2026-01-01T00:00:00.000Z" }];

    const result = verifyManifestSignatureAgainstTrustStore(bytes, signature, trustStore, "2026-06-22T00:00:00.000Z");

    expect(result.ok).toBe(true);
    expect(result.matchedKeyId).toBe("key-2026");
  });

  it("rejects a key that is not yet valid at the verification instant", () => {
    const { privatePem, publicPem } = ed25519Keypair();
    const signature = signManifestBytes(bytes, privatePem, SIGNED_AT);
    const trustStore: TrustStore = [
      { keyId: "key-future", publicKey: publicPem, validFrom: "2027-01-01T00:00:00.000Z" },
    ];

    const result = verifyManifestSignatureAgainstTrustStore(bytes, signature, trustStore, "2026-06-22T00:00:00.000Z");

    expect(result.ok).toBe(false);
    expect(result.errorCodes).toEqual(["KEY_NOT_TRUSTED"]);
  });

  it("rejects a key that has expired (validUntil in the past)", () => {
    const { privatePem, publicPem } = ed25519Keypair();
    const signature = signManifestBytes(bytes, privatePem, SIGNED_AT);
    const trustStore: TrustStore = [
      {
        keyId: "key-retired",
        publicKey: publicPem,
        validFrom: "2025-01-01T00:00:00.000Z",
        validUntil: "2026-01-01T00:00:00.000Z",
      },
    ];

    const result = verifyManifestSignatureAgainstTrustStore(bytes, signature, trustStore, "2026-06-22T00:00:00.000Z");

    expect(result.ok).toBe(false);
    expect(result.errorCodes).toEqual(["KEY_NOT_TRUSTED"]);
  });

  it("rejects a revoked key even though the signature predates the revocation and the key is otherwise within its validity window", () => {
    const { privatePem, publicPem } = ed25519Keypair();
    // Signed well before revocation -- a compromised key must not keep verifying past releases.
    const signature = signManifestBytes(bytes, privatePem, "2026-01-15T00:00:00.000Z");
    const trustStore: TrustStore = [
      {
        keyId: "key-compromised",
        publicKey: publicPem,
        validFrom: "2025-01-01T00:00:00.000Z",
        validUntil: "2027-01-01T00:00:00.000Z",
        revokedAt: "2026-02-01T00:00:00.000Z",
      },
    ];

    const result = verifyManifestSignatureAgainstTrustStore(bytes, signature, trustStore, "2026-06-22T00:00:00.000Z");

    expect(result.ok).toBe(false);
    expect(result.errorCodes).toEqual(["KEY_NOT_TRUSTED"]);
  });

  it("supports rotation: both the outgoing and incoming key verify during their overlap window", () => {
    const oldKey = ed25519Keypair();
    const newKey = ed25519Keypair();
    const oldSignature = signManifestBytes(bytes, oldKey.privatePem, "2026-06-01T00:00:00.000Z");
    const newSignature = signManifestBytes(bytes, newKey.privatePem, "2026-06-10T00:00:00.000Z");
    const trustStore: TrustStore = [
      {
        keyId: "old",
        publicKey: oldKey.publicPem,
        validFrom: "2025-01-01T00:00:00.000Z",
        validUntil: "2026-07-01T00:00:00.000Z",
      },
      { keyId: "new", publicKey: newKey.publicPem, validFrom: "2026-06-05T00:00:00.000Z" },
    ];
    const verifiedAt = "2026-06-15T00:00:00.000Z";

    expect(verifyManifestSignatureAgainstTrustStore(bytes, oldSignature, trustStore, verifiedAt)).toMatchObject({
      ok: true,
      matchedKeyId: "old",
    });
    expect(verifyManifestSignatureAgainstTrustStore(bytes, newSignature, trustStore, verifiedAt)).toMatchObject({
      ok: true,
      matchedKeyId: "new",
    });
  });

  it("rejects a mathematically valid signature whose key is entirely absent from the trust store", () => {
    const { privatePem } = ed25519Keypair();
    const signature = signManifestBytes(bytes, privatePem, SIGNED_AT);

    const result = verifyManifestSignatureAgainstTrustStore(bytes, signature, [], "2026-06-22T00:00:00.000Z");

    expect(result.ok).toBe(false);
    expect(result.errorCodes).toEqual(["KEY_NOT_TRUSTED"]);
  });

  it("still rejects on a bad signature before ever consulting the trust store", () => {
    const { privatePem, publicPem } = ed25519Keypair();
    const signature = signManifestBytes(bytes, privatePem, SIGNED_AT);
    const tampered = { ...signature, signature: Buffer.from("not-a-real-signature").toString("base64") };
    const trustStore: TrustStore = [{ keyId: "key-2026", publicKey: publicPem, validFrom: "2025-01-01T00:00:00.000Z" }];

    const result = verifyManifestSignatureAgainstTrustStore(bytes, tampered, trustStore, "2026-06-22T00:00:00.000Z");

    expect(result.ok).toBe(false);
    expect(result.errorCodes).toContain("INVALID_SIGNATURE");
  });
});

describe("loadTrustStore / saveTrustStore", () => {
  it("round-trips a trust store through disk", async () => {
    const dir = await makeTempDir();
    const filePath = path.join(dir, "trust-store.json");
    const trustStore: TrustStore = [
      { keyId: "a", publicKey: "pem-a", validFrom: "2025-01-01T00:00:00.000Z" },
      {
        keyId: "b",
        publicKey: "pem-b",
        validFrom: "2026-01-01T00:00:00.000Z",
        validUntil: "2027-01-01T00:00:00.000Z",
        revokedAt: "2026-06-01T00:00:00.000Z",
      },
    ];

    await saveTrustStore(filePath, trustStore);
    const loaded = await loadTrustStore(filePath);

    expect(loaded).toEqual(trustStore);
  });

  it("rejects a trust store file that isn't a JSON array", async () => {
    const dir = await makeTempDir();
    const filePath = path.join(dir, "trust-store.json");
    await fs.writeFile(filePath, JSON.stringify({ not: "an array" }));

    await expect(loadTrustStore(filePath)).rejects.toThrow("must be a JSON array");
  });

  it("rejects a trust store entry missing required fields", async () => {
    const dir = await makeTempDir();
    const filePath = path.join(dir, "trust-store.json");
    await fs.writeFile(filePath, JSON.stringify([{ keyId: "a" }]));

    await expect(loadTrustStore(filePath)).rejects.toThrow("entry 0 is missing required fields");
  });
});
