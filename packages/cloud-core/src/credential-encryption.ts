import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Authenticated encryption for third-party credentials held on a customer's behalf.
 *
 * BoardReadyOps performs component lookups under each customer's own provider credentials
 * (see ADR-0012), which means it stores a secret that is not its own. Those are encrypted at
 * rest so that a database dump, a backup, or a replica is not a credential leak on its own —
 * the key lives in the process environment, not in the database.
 *
 * AES-256-GCM rather than CBC or a bare stream: the authentication tag makes a tampered
 * ciphertext fail loudly instead of decrypting to plausible rubbish that would then be sent
 * to a provider as a bearer token.
 */

const algorithm = "aes-256-gcm";
const keyBytes = 32;
const ivBytes = 12;
const tagBytes = 16;
const envelopeVersion = "v1";

export type CredentialCipher = {
  encrypt(plaintext: string): string;
  /** Returns undefined for anything that is not a valid envelope this cipher can open. */
  decrypt(envelope: string): string | undefined;
};

function decodeKey(value: string): Buffer {
  const trimmed = value.trim();
  // Accept hex or base64 so an operator can paste whatever their generator produced, but
  // require the decoded length to be exactly right rather than padding or truncating: a
  // silently shortened key would weaken every credential without any visible symptom.
  const decoded = /^[0-9a-fA-F]{64}$/u.test(trimmed) ? Buffer.from(trimmed, "hex") : Buffer.from(trimmed, "base64");
  if (decoded.byteLength !== keyBytes) {
    throw new Error(`credential encryption key must decode to ${keyBytes} bytes, got ${decoded.byteLength}`);
  }
  return decoded;
}

/**
 * Builds a cipher from a primary key and any number of retired ones.
 *
 * Retired keys are accepted for decryption only. That is what makes rotation possible without
 * a migration window: deploy the new key as primary with the old one still listed, let writes
 * re-encrypt naturally, then drop the old key.
 */
export function createCredentialCipher(primaryKey: string, retiredKeys: readonly string[] = []): CredentialCipher {
  const primary = decodeKey(primaryKey);
  const all = [primary, ...retiredKeys.map(decodeKey)];

  return {
    encrypt(plaintext) {
      if (plaintext.length === 0) throw new Error("refusing to encrypt an empty credential");
      const iv = randomBytes(ivBytes);
      const cipher = createCipheriv(algorithm, primary, iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return [
        envelopeVersion,
        iv.toString("base64url"),
        tag.toString("base64url"),
        ciphertext.toString("base64url"),
      ].join(".");
    },

    decrypt(envelope) {
      if (typeof envelope !== "string") return undefined;
      const parts = envelope.split(".");
      if (parts.length !== 4 || parts[0] !== envelopeVersion) return undefined;

      const iv = Buffer.from(parts[1] ?? "", "base64url");
      const tag = Buffer.from(parts[2] ?? "", "base64url");
      const ciphertext = Buffer.from(parts[3] ?? "", "base64url");
      if (iv.byteLength !== ivBytes || tag.byteLength !== tagBytes || ciphertext.byteLength === 0) return undefined;

      for (const key of all) {
        try {
          const decipher = createDecipheriv(algorithm, key, iv);
          decipher.setAuthTag(tag);
          const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
          return plaintext.toString("utf8");
        } catch {
          // Wrong key, or a tampered envelope. Try the next key; report nothing either way,
          // so a caller cannot use the failure mode to distinguish the two.
        }
      }
      return undefined;
    },
  };
}

/**
 * Reads the configured cipher, or `undefined` when no key is set.
 *
 * Absent rather than throwing: a deployment without component intelligence configured is a
 * valid deployment, and the supply watch already reports `no_provider` honestly for it.
 */
export function configuredCredentialCipher(
  environment: Readonly<Record<string, string | undefined>>,
): CredentialCipher | undefined {
  const primary = environment.BOARDREADYOPS_CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (!primary) return undefined;
  const retired = (environment.BOARDREADYOPS_CREDENTIAL_ENCRYPTION_RETIRED_KEYS ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter((key) => key.length > 0);
  return createCredentialCipher(primary, retired);
}

/** Constant-time comparison for credential material, so callers do not reach for `===`. */
export function credentialsMatch(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}
