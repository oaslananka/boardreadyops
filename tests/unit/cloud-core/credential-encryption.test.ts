import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  configuredCredentialCipher,
  createCredentialCipher,
  credentialsMatch,
} from "../../../packages/cloud-core/src/credential-encryption.js";

const keyA = randomBytes(32).toString("base64");
const keyB = randomBytes(32).toString("base64");

describe("credential encryption", () => {
  it("round-trips a credential", () => {
    const cipher = createCredentialCipher(keyA);
    const secret = "nexar-client-secret-value";

    expect(cipher.decrypt(cipher.encrypt(secret))).toBe(secret);
  });

  it("produces a different envelope every time for the same input", () => {
    const cipher = createCredentialCipher(keyA);

    // A deterministic ciphertext would let anyone with read access to the table see which
    // installations share a credential.
    expect(cipher.encrypt("same")).not.toBe(cipher.encrypt("same"));
  });

  it("refuses an envelope encrypted under a key it does not hold", () => {
    const written = createCredentialCipher(keyA).encrypt("secret");

    expect(createCredentialCipher(keyB).decrypt(written)).toBeUndefined();
  });

  it("accepts an envelope from a retired key so a rotation needs no migration window", () => {
    const old = createCredentialCipher(keyB);
    const rotated = createCredentialCipher(keyA, [keyB]);
    const written = old.encrypt("secret");

    expect(rotated.decrypt(written)).toBe("secret");
    // New writes use the primary key only, so the retired key stops being load-bearing.
    expect(createCredentialCipher(keyA).decrypt(rotated.encrypt("secret"))).toBe("secret");
  });

  it("rejects a tampered ciphertext rather than returning rubbish", () => {
    const cipher = createCredentialCipher(keyA);
    const envelope = cipher.encrypt("secret");
    const parts = envelope.split(".");
    const body = Buffer.from(parts[3] ?? "", "base64url");
    body[0] = (body[0] ?? 0) ^ 0xff;
    const tampered = [parts[0], parts[1], parts[2], body.toString("base64url")].join(".");

    // Without the auth tag this would decrypt to plausible bytes and be sent to a provider
    // as a bearer token.
    expect(cipher.decrypt(tampered)).toBeUndefined();
  });

  it("rejects a truncated authentication tag", () => {
    // GCM will accept a shortened tag unless authTagLength is pinned, and a short tag is what
    // an attacker forging a ciphertext supplies.
    const cipher = createCredentialCipher(keyA);
    const parts = cipher.encrypt("secret").split(".");
    const shortTag = Buffer.from(parts[2] ?? "", "base64url").subarray(0, 8);
    const truncated = [parts[0], parts[1], shortTag.toString("base64url"), parts[3]].join(".");

    expect(cipher.decrypt(truncated)).toBeUndefined();
  });

  it("rejects malformed envelopes without throwing", () => {
    const cipher = createCredentialCipher(keyA);

    for (const bad of ["", "not-an-envelope", "v1.a.b", "v2.a.b.c", "v1....", "v1.a.b.c.d"]) {
      expect(cipher.decrypt(bad)).toBeUndefined();
    }
  });

  it("refuses a key of the wrong length instead of padding it", () => {
    // A silently shortened key would weaken every credential with no visible symptom.
    expect(() => createCredentialCipher(randomBytes(16).toString("base64"))).toThrow(/32 bytes/u);
    expect(() => createCredentialCipher(randomBytes(48).toString("base64"))).toThrow(/32 bytes/u);
  });

  it("accepts a hex key as well as base64", () => {
    const hex = randomBytes(32).toString("hex");
    const cipher = createCredentialCipher(hex);

    expect(cipher.decrypt(cipher.encrypt("secret"))).toBe("secret");
  });

  it("refuses to encrypt an empty credential", () => {
    expect(() => createCredentialCipher(keyA).encrypt("")).toThrow(/empty/u);
  });

  it("is absent rather than throwing when no key is configured", () => {
    // A deployment without component intelligence is a valid deployment.
    expect(configuredCredentialCipher({})).toBeUndefined();
    expect(configuredCredentialCipher({ BOARDREADYOPS_CREDENTIAL_ENCRYPTION_KEY: "  " })).toBeUndefined();
  });

  it("reads the primary key and any retired keys from the environment", () => {
    const cipher = configuredCredentialCipher({
      BOARDREADYOPS_CREDENTIAL_ENCRYPTION_KEY: keyA,
      BOARDREADYOPS_CREDENTIAL_ENCRYPTION_RETIRED_KEYS: ` ${keyB} , `,
    });
    const written = createCredentialCipher(keyB).encrypt("secret");

    expect(cipher?.decrypt(written)).toBe("secret");
  });

  it("compares credentials without leaking length through early exit", () => {
    expect(credentialsMatch("abc", "abc")).toBe(true);
    expect(credentialsMatch("abc", "abd")).toBe(false);
    expect(credentialsMatch("abc", "abcd")).toBe(false);
  });
});
