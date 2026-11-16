import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { verify } from "sigstore";
import githubTufRoot from "./github-tuf-root.json";

type VerificationIdentity = {
  extensions?: { issuer?: string };
  subjectAlternativeName?: string;
  oids?: readonly { oid: { id: readonly number[] }; value: Uint8Array }[];
};

export type TrustedSignedExportIdentity = {
  repository: string;
  workflowPath: string;
  sourceRef: string;
};

const githubTufOrigin = "https://tuf-repo.github.com";
const githubOidBase = "1.3.6.1.4.1.57264.1.";
const githubOidcIssuer = "https://token.actions.githubusercontent.com";
const maximumBundleBytes = 4 * 1024 * 1024;

function signerExtension(identity: VerificationIdentity, extension: number, isRaw = false): string | undefined {
  const match = identity.oids?.find((entry) => entry.oid.id.join(".") === githubOidBase + extension);
  if (!match) return undefined;
  const data = Buffer.from(match.value);
  if (isRaw) return data.toString("utf8");
  // GitHub Fulcio OIDs use DER-encoded UTF8String; fail closed on unknown ASN.1.
  if (data.length < 2 || data[0] !== 0x0c) return undefined;
  const length = data[1];
  if (length === undefined || length >= 0x80 || length !== data.length - 2) return undefined;
  return data.subarray(2).toString("utf8");
}

/** Map authenticated Sigstore signer OIDs and the signed DSSE payload to the
 * existing strict repository/run/source/subject verifier contract. */
export function verifiedAttestationFromSigner(
  identity: VerificationIdentity,
  payload: string,
  expected: TrustedSignedExportIdentity,
): unknown[] {
  const workflowUri =
    "https://github.com/" + expected.repository + "/" + expected.workflowPath + "@" + expected.sourceRef;
  if (identity.extensions?.issuer !== githubOidcIssuer || identity.subjectAlternativeName !== workflowUri) {
    throw new Error("signed GitHub workflow identity mismatch");
  }

  const certificate = {
    issuer: identity.extensions.issuer,
    subjectAlternativeName: identity.subjectAlternativeName,
    sourceRepositoryURI: signerExtension(identity, 12),
    sourceRepositoryIdentifier: signerExtension(identity, 15),
    sourceRepositoryDigest: signerExtension(identity, 13),
    githubWorkflowSHA: signerExtension(identity, 3, true),
    sourceRepositoryRef: signerExtension(identity, 14),
    runInvocationURI: signerExtension(identity, 21),
    buildSignerURI: signerExtension(identity, 18),
    buildSignerDigest: signerExtension(identity, 19),
    runnerEnvironment: signerExtension(identity, 11),
    buildTrigger: signerExtension(identity, 20),
  };
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(payload)) throw new Error("invalid signed DSSE payload");
  const statement: unknown = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
  return [{ verificationResult: { signature: { certificate }, statement } }];
}

/**
 * Verify GitHub's RFC3161-timestamped DSSE bundle against its separately
 * TUF-pinned Sigstore root. No gh binary is required on serverless runtimes.
 * The pre-existing exact source, repository, workflow, run and digest policy
 * checks independently validate the returned authenticated claims.
 */
export async function verifyGitHubSigstoreBundle(
  bundlePath: string,
  expected: TrustedSignedExportIdentity,
): Promise<unknown[]> {
  const workflowUri =
    "https://github.com/" + expected.repository + "/" + expected.workflowPath + "@" + expected.sourceRef;
  const escapedUri = [...workflowUri]
    .map((character) => (".*+?^$()[]{}|\\".includes(character) ? "\\" + character : character))
    .join("");
  const raw = await readFile(bundlePath);
  if (raw.length === 0 || raw.length > maximumBundleBytes) throw new Error("untrusted attestation bundle");
  const bundle: unknown = JSON.parse(raw.toString("utf8"));
  if (
    !bundle ||
    typeof bundle !== "object" ||
    !("mediaType" in bundle) ||
    bundle.mediaType !== "application/vnd.dev.sigstore.bundle.v0.3+json" ||
    !("dsseEnvelope" in bundle) ||
    !bundle.dsseEnvelope ||
    typeof bundle.dsseEnvelope !== "object" ||
    !("payload" in bundle.dsseEnvelope) ||
    typeof bundle.dsseEnvelope.payload !== "string" ||
    !("payloadType" in bundle.dsseEnvelope) ||
    bundle.dsseEnvelope.payloadType !== "application/vnd.in-toto+json"
  ) {
    throw new Error("unsupported signed attestation bundle");
  }

  const temporary = await mkdtemp(path.join(tmpdir(), "bro-sigstore-trust-"));
  try {
    const trustedRootPath = path.join(temporary, "root.json");
    await writeFile(trustedRootPath, JSON.stringify(githubTufRoot), { mode: 0o600 });
    const signer = await verify(bundle as Parameters<typeof verify>[0], {
      tufMirrorURL: githubTufOrigin,
      tufRootPath: trustedRootPath,
      tufCachePath: path.join(temporary, "cache"),
      // The GitHub TUF instance uses a trusted RFC3161 TSA, not Rekor/CT SCT.
      tlogThreshold: 0,
      ctLogThreshold: 0,
      certificateIssuer: githubOidcIssuer,
      certificateIdentityURI: "^" + escapedUri + "$",
      timeout: 10_000,
    });
    return verifiedAttestationFromSigner(
      signer.identity as VerificationIdentity,
      bundle.dsseEnvelope.payload,
      expected,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
