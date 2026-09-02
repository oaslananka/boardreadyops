import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export interface ReleaseManifestSignature {
  schemaVersion: 1;
  algorithm: "ed25519";
  manifestDigest: string;
  signature: string;
  publicKey: string;
  signedAt: string;
}

type SignatureErrorCode =
  | "UNSUPPORTED_ALGORITHM"
  | "DIGEST_MISMATCH"
  | "INVALID_PUBLIC_KEY"
  | "INVALID_SIGNATURE"
  | "KEY_NOT_TRUSTED"
  | "MALFORMED_SIGNATURE_FILE"
  | "MANIFEST_UNREADABLE";

export interface SignatureVerification {
  ok: boolean;
  errors: string[];
  errorCodes?: SignatureErrorCode[];
}

const SIGNATURE_FILE = "manifest.sig";
const MANIFEST_FILE = "manifest.json";

/** Sign the raw bytes of a release manifest with an Ed25519 private key. */
export function signManifestBytes(bytes: Buffer, privateKeyPem: string, signedAt: string): ReleaseManifestSignature {
  const privateKey = loadKey(privateKeyPem, "private");
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error(
      `release signing requires an Ed25519 private key, received ${privateKey.asymmetricKeyType ?? "unknown"}`,
    );
  }
  const signature = cryptoSign(null, bytes, privateKey);
  const publicKey = createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
  return {
    schemaVersion: 1,
    algorithm: "ed25519",
    manifestDigest: createHash("sha256").update(bytes).digest("hex"),
    signature: signature.toString("base64"),
    publicKey,
    signedAt,
  };
}

/** Verify a manifest signature against the manifest bytes, optionally pinning a trusted public key. */
export function verifyManifestSignature(
  bytes: Buffer,
  signature: ReleaseManifestSignature,
  trustedPublicKeyPem?: string,
): SignatureVerification {
  const errors: string[] = [];
  const errorCodes: SignatureErrorCode[] = [];
  if (signature.algorithm !== "ed25519") {
    return {
      ok: false,
      errors: [`unsupported signature algorithm: ${signature.algorithm}`],
      errorCodes: ["UNSUPPORTED_ALGORITHM"],
    };
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (signature.manifestDigest && signature.manifestDigest !== digest) {
    errors.push("manifest digest in signature does not match manifest contents");
    errorCodes.push("DIGEST_MISMATCH");
  }
  let publicKey: KeyObject;
  try {
    publicKey = loadKey(signature.publicKey, "public");
  } catch {
    return { ok: false, errors: ["signature public key could not be parsed"], errorCodes: ["INVALID_PUBLIC_KEY"] };
  }
  let valid = false;
  try {
    valid = cryptoVerify(null, bytes, publicKey, Buffer.from(signature.signature, "base64"));
  } catch {
    valid = false;
  }
  if (!valid) {
    errors.push("signature does not match manifest contents");
    errorCodes.push("INVALID_SIGNATURE");
  }
  if (trustedPublicKeyPem !== undefined) {
    if (!publicKeysMatch(publicKey, trustedPublicKeyPem)) {
      errors.push("signature public key does not match the trusted public key");
      errorCodes.push("KEY_NOT_TRUSTED");
    }
  }
  return { ok: errors.length === 0, errors, errorCodes };
}

export interface SignReleaseBundleResult {
  signaturePath: string;
  signature: ReleaseManifestSignature;
}

/** Read a bundle's manifest, sign it, and write the `manifest.sig` sidecar next to it. */
export async function signReleaseBundle(
  bundleDir: string,
  privateKeyPem: string,
  signedAt: string,
): Promise<SignReleaseBundleResult> {
  const bytes = await fs.readFile(path.join(bundleDir, MANIFEST_FILE));
  const signature = signManifestBytes(bytes, privateKeyPem, signedAt);
  const signaturePath = path.join(bundleDir, SIGNATURE_FILE);
  await fs.writeFile(signaturePath, `${JSON.stringify(signature, null, 2)}\n`, "utf8");
  return { signaturePath, signature };
}

export interface BundleSignatureVerification extends SignatureVerification {
  present: boolean;
}

interface BundleManifestRead {
  present: boolean;
  bytes?: Buffer;
  signature?: ReleaseManifestSignature;
  error?: { errors: string[]; errorCodes: SignatureErrorCode[] };
}

/** Read and parse a bundle's `manifest.sig` and `manifest.json`, shared by both verification modes. */
async function readBundleManifestAndSignature(bundleDir: string): Promise<BundleManifestRead> {
  const signaturePath = path.join(bundleDir, SIGNATURE_FILE);
  let signatureRaw: string;
  try {
    signatureRaw = await fs.readFile(signaturePath, "utf8");
  } catch {
    return { present: false };
  }
  let signature: ReleaseManifestSignature;
  try {
    signature = JSON.parse(signatureRaw) as ReleaseManifestSignature;
  } catch {
    return {
      present: true,
      error: { errors: ["manifest.sig is not valid JSON"], errorCodes: ["MALFORMED_SIGNATURE_FILE"] },
    };
  }
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(path.join(bundleDir, MANIFEST_FILE));
  } catch (error) {
    return {
      present: true,
      error: { errors: [`manifest could not be read: ${asMessage(error)}`], errorCodes: ["MANIFEST_UNREADABLE"] },
    };
  }
  return { present: true, bytes, signature };
}

/** Verify a bundle's `manifest.sig` against its `manifest.json`, optionally pinning a trusted key. */
export async function verifyReleaseBundleSignature(
  bundleDir: string,
  trustedPublicKeyPem?: string,
): Promise<BundleSignatureVerification> {
  const read = await readBundleManifestAndSignature(bundleDir);
  if (!read.present || !read.bytes || !read.signature) {
    if (read.error) {
      return { ok: false, present: true, ...read.error };
    }
    return { ok: false, present: read.present, errors: [], errorCodes: [] };
  }
  return { present: true, ...verifyManifestSignature(read.bytes, read.signature, trustedPublicKeyPem) };
}

function loadKey(pem: string, kind: "private" | "public"): KeyObject {
  return kind === "private" ? createPrivateKey(pem) : createPublicKey(pem);
}

function publicKeysMatch(publicKey: KeyObject, trustedPublicKeyPem: string): boolean {
  let trusted: KeyObject;
  try {
    trusted = createPublicKey(trustedPublicKeyPem);
  } catch {
    return false;
  }
  const trustedDer = trusted.export({ type: "spki", format: "der" });
  const embeddedDer = publicKey.export({ type: "spki", format: "der" });
  return Buffer.isBuffer(trustedDer) && Buffer.isBuffer(embeddedDer) && trustedDer.equals(embeddedDer);
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// --- Trust store: signing-key rotation & revocation ------------------------
//
// verifyManifestSignature() above only supports a single pinned key: exactly one trusted key can
// be checked per call, with no concept of that key's validity window or of it being retired. That
// makes ordinary key rotation unsafe -- there's no way to have an old key still verify releases
// signed just before rotation while a new key takes over, and no way to declare a compromised key
// permanently untrusted short of removing the only pin (which also breaks verification of every
// past release signed with it).
//
// A TrustStore is a list of keys, each with its own validity window and optional revocation. This
// is the verification-side model only: how a trust store itself gets distributed to and updated on
// a consumer's machine (e.g. a signed trust-store bundle, TUF-style delegation, a well-known URL)
// is a separate, larger problem intentionally out of scope here -- see the W07 ledger entry for
// what's covered by this change vs. what remains (signed-release-certificate UI/API, Hardware
// Release Level model).

interface TrustedSigningKey {
  /** Stable identifier for this key (e.g. a fingerprint or a human-assigned name); not
   * cryptographically meaningful, used only to report which key matched. */
  keyId: string;
  /** PEM-encoded Ed25519 public key. */
  publicKey: string;
  /** ISO 8601 timestamp; the key is not trusted before this instant. */
  validFrom: string;
  /** ISO 8601 timestamp; the key is not trusted from this instant onward. Absent means no planned
   * expiry (rotation is expected to be managed via revocation instead). */
  validUntil?: string | undefined;
  /** ISO 8601 timestamp. Once set, the key is untrusted from this instant onward for ALL
   * verification -- including of signatures whose signedAt predates the revocation. A compromised
   * key must not keep verifying past releases as trusted; that would defeat the purpose of
   * revoking it. There is deliberately no "grandfather signatures made before compromise" carve-out
   * here, which would require a trusted timestamping authority this design does not have. */
  revokedAt?: string | undefined;
}

export type TrustStore = TrustedSigningKey[];

export interface TrustStoreVerification extends SignatureVerification {
  /** The keyId of the trust store entry the signature's embedded key matched, when ok is true. */
  matchedKeyId?: string | undefined;
}

/**
 * Verify a manifest signature against a trust store of possibly-multiple, possibly-time-limited,
 * possibly-revoked keys, evaluated as of `verifiedAt`. Unlike verifyManifestSignature's single
 * `trustedPublicKeyPem` pin, this supports rotation (old and new keys both valid across an overlap
 * window) and revocation (a key stops being trusted for all verification from revokedAt onward,
 * regardless of when the signature itself was created).
 */
export function verifyManifestSignatureAgainstTrustStore(
  bytes: Buffer,
  signature: ReleaseManifestSignature,
  trustStore: TrustStore,
  verifiedAt: string,
): TrustStoreVerification {
  const base = verifyManifestSignature(bytes, signature);
  if (!base.ok) {
    return base;
  }

  let embeddedPublicKey: KeyObject;
  try {
    embeddedPublicKey = createPublicKey(signature.publicKey);
  } catch {
    return { ok: false, errors: ["signature public key could not be parsed"], errorCodes: ["INVALID_PUBLIC_KEY"] };
  }

  const verifiedAtMs = Date.parse(verifiedAt);
  const match = trustStore.find((entry) => {
    if (entry.revokedAt !== undefined && Date.parse(entry.revokedAt) <= verifiedAtMs) {
      return false;
    }
    if (Date.parse(entry.validFrom) > verifiedAtMs) {
      return false;
    }
    if (entry.validUntil !== undefined && Date.parse(entry.validUntil) < verifiedAtMs) {
      return false;
    }
    return publicKeysMatch(embeddedPublicKey, entry.publicKey);
  });

  if (!match) {
    return {
      ok: false,
      errors: ["signature public key is not an active entry in the trust store"],
      errorCodes: ["KEY_NOT_TRUSTED"],
    };
  }

  return { ok: true, errors: [], matchedKeyId: match.keyId };
}

/** Load a trust store from a JSON file. Throws if the file is missing, unreadable, or malformed. */
export async function loadTrustStore(filePath: string): Promise<TrustStore> {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`trust store at ${filePath} must be a JSON array`);
  }
  for (const [index, entry] of parsed.entries()) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as Partial<TrustedSigningKey>).keyId !== "string" ||
      typeof (entry as Partial<TrustedSigningKey>).publicKey !== "string" ||
      typeof (entry as Partial<TrustedSigningKey>).validFrom !== "string"
    ) {
      throw new Error(`trust store at ${filePath} entry ${index} is missing required fields`);
    }
  }
  return parsed as TrustStore;
}

/** Write a trust store to a JSON file. */
export async function saveTrustStore(filePath: string, trustStore: TrustStore): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(trustStore, null, 2)}\n`, "utf8");
}

export interface BundleTrustStoreVerification extends TrustStoreVerification {
  present: boolean;
}

/** Verify a bundle's `manifest.sig` against its `manifest.json` using a trust store, as of `verifiedAt`. */
export async function verifyReleaseBundleSignatureAgainstTrustStore(
  bundleDir: string,
  trustStore: TrustStore,
  verifiedAt: string,
): Promise<BundleTrustStoreVerification> {
  const read = await readBundleManifestAndSignature(bundleDir);
  if (!read.present || !read.bytes || !read.signature) {
    if (read.error) {
      return { ok: false, present: true, ...read.error };
    }
    return { ok: false, present: read.present, errors: [], errorCodes: [] };
  }
  return {
    present: true,
    ...verifyManifestSignatureAgainstTrustStore(read.bytes, read.signature, trustStore, verifiedAt),
  };
}
