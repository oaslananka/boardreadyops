import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  verifiedAttestationFromSigner,
  verifyGitHubSigstoreBundle,
} from "../../../apps/web/lib/github-sigstore-verifier.js";
import githubRoot from "../../../apps/web/lib/github-tuf-root.json";

const expected = {
  repository: "oaslananka/boardreadyops",
  workflowPath: ".github/workflows/readiness-runner.yml",
  sourceRef: "refs/heads/main",
};
const workflowUri =
  "https://github.com/oaslananka/boardreadyops/.github/workflows/readiness-runner.yml@refs/heads/main";
const workflowSha = "a".repeat(40);
const runId = "123456789";
let temporary: string;
let bundlePath: string;

function oid(extension: number, value: string, raw = false) {
  const bytes = Buffer.from(value);
  if (bytes.length >= 128) throw new Error("test OID value too long");
  return {
    oid: { id: [1, 3, 6, 1, 4, 1, 57264, 1, extension] },
    value: raw ? bytes : Buffer.concat([Buffer.from([0x0c, bytes.length]), bytes]),
  };
}

function signerIdentity() {
  return {
    extensions: { issuer: "https://token.actions.githubusercontent.com" },
    subjectAlternativeName: workflowUri,
    oids: [
      oid(3, workflowSha, true),
      oid(11, "github-hosted"),
      oid(12, "https://github.com/oaslananka/boardreadyops"),
      oid(13, workflowSha),
      oid(14, "refs/heads/main"),
      oid(15, "1283305324"),
      oid(18, workflowUri),
      oid(19, workflowSha),
      oid(20, "workflow_dispatch"),
      oid(21, "https://github.com/oaslananka/boardreadyops/actions/runs/" + runId + "/attempts/1"),
    ],
  };
}
const signedStatement = {
  _type: "https://in-toto.io/Statement/v1",
  predicateType: "https://slsa.dev/provenance/v1",
  subject: [{ name: "build/boardreadyops-attested/manifest.json", digest: { sha256: "a".repeat(64) } }],
};
const payload = Buffer.from(JSON.stringify(signedStatement)).toString("base64");

beforeEach(async () => {
  temporary = await mkdtemp(path.join(tmpdir(), "bro-sigstore-test-"));
  bundlePath = path.join(temporary, "bundle.sigstore.json");
});
afterEach(async () => {
  await rm(temporary, { recursive: true, force: true });
});

describe("GitHub-specific serverless Sigstore certificate claims", () => {
  it("maps all trusted certificate identity extensions into the existing strict result contract", () => {
    const result = verifiedAttestationFromSigner(signerIdentity(), payload, expected);
    const value = result[0] as { verificationResult: { signature: { certificate: Record<string, unknown> } } };
    expect(value.verificationResult.signature.certificate).toMatchObject({
      issuer: "https://token.actions.githubusercontent.com",
      subjectAlternativeName: workflowUri,
      sourceRepositoryIdentifier: "1283305324",
      sourceRepositoryDigest: workflowSha,
      sourceRepositoryRef: "refs/heads/main",
      githubWorkflowSHA: workflowSha,
      buildSignerURI: workflowUri,
      buildSignerDigest: workflowSha,
      buildTrigger: "workflow_dispatch",
      runnerEnvironment: "github-hosted",
    });
  });
  it("rejects certificates signed for a different workflow identity", () => {
    expect(() =>
      verifiedAttestationFromSigner(
        { ...signerIdentity(), subjectAlternativeName: "https://github.com/attacker/repo" },
        payload,
        expected,
      ),
    ).toThrow("identity mismatch");
  });
  it("never trusts missing or invalid DER certificate extensions", () => {
    const identity = signerIdentity();
    const item = identity.oids.find((entry) => entry.oid.id.at(-1) === 15);
    if (!item) throw new Error("missing test OID");
    item.value = Buffer.from("1283305324", "utf8");
    const result = verifiedAttestationFromSigner(identity, payload, expected);
    const value = result[0] as { verificationResult: { signature: { certificate: Record<string, unknown> } } };
    expect(value.verificationResult.signature.certificate.sourceRepositoryIdentifier).toBeUndefined();
  });
  it("rejects unsigned or malformed payloads as statements", () => {
    expect(() => verifiedAttestationFromSigner(signerIdentity(), "_bad_payload", expected)).toThrow("invalid");
  });
  it("rejects unsupported bundle types before external verification", async () => {
    await writeFile(bundlePath, JSON.stringify({ mediaType: "unsupported", dsseEnvelope: {} }));
    await expect(verifyGitHubSigstoreBundle(bundlePath, expected)).rejects.toThrow("unsupported");
  });
  it("pins GitHub's signed public TUF v1 root, rather than default public-good Sigstore", () => {
    expect(githubRoot.signed).toMatchObject({ _type: "root", version: 1 });
    expect(githubRoot.signatures.length).toBeGreaterThan(0);
  });
});
