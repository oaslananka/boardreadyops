import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  signManifestBytes,
  signReleaseBundle,
  verifyManifestSignature,
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
