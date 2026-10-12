import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeSourceFingerprint } from "../../../src/core/provenance.js";
import {
  prepareExportAttestationChecksums,
  type TrustedExportExpectation,
  verifyReviewedExportAttestation,
} from "../../../src/release/export-attestation.js";
import { runProcess } from "../../../src/util/process.js";

vi.mock("../../../src/util/process.js", () => ({ runProcess: vi.fn() }));

const mockedRun = vi.mocked(runProcess);
const roots: string[] = [];
const sha = "a".repeat(40);
const expectation: TrustedExportExpectation = {
  repository: "customer/fabrication",
  repositoryId: "765432",
  reviewedSha: sha,
  sourceRef: "refs/heads/review",
  workflowPath: ".github/workflows/boardreadyops-export.yml",
  event: "push",
  runId: "12345",
  runAttempt: 2,
};

afterEach(async () => {
  vi.resetAllMocks();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
beforeEach(() => mockedRun.mockReset());

interface Fixture {
  root: string;
  manifestPath: string;
  subjectHashes: Map<string, string>;
}

async function fixture(): Promise<Fixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "brops-attestation-"));
  roots.push(root);
  await fs.writeFile(path.join(root, "board.kicad_pcb"), "(kicad_pcb test)");
  const dir = path.join(root, "build", "reviewed");
  await fs.mkdir(path.join(dir, "gerbers"), { recursive: true });
  await fs.mkdir(path.join(dir, "drill"), { recursive: true });
  const files: Array<[string, string, "gerber" | "drill"]> = [
    ["gerbers/board.gtl", "real gerber bytes", "gerber"],
    ["drill/board.drl", "real drill bytes", "drill"],
  ];
  const artifacts = [];
  for (const [name, data, kind] of files) {
    await fs.writeFile(path.join(dir, name), data);
    artifacts.push({
      path: name,
      sha256: createHash("sha256").update(data).digest("hex"),
      bytes: Buffer.byteLength(data),
      kind,
    });
  }
  const manifestPath = "build/reviewed/manifest.json";
  const manifest = {
    kind: "boardreadyops.export-provenance",
    schemaVersion: 1,
    tool: { name: "boardreadyops", version: "1.68.3" },
    generatedAt: "2026-10-10T00:00:00Z",
    git: { sha, dirty: false },
    sourceSnapshot: "stable",
    sourceFingerprint: await computeSourceFingerprint(root),
    steps: [
      { kind: "gerbers", status: "generated", files: 1 },
      { kind: "drill", status: "generated", files: 1 },
    ],
    artifacts,
  };
  await fs.writeFile(path.join(root, manifestPath), JSON.stringify(manifest));
  const subjectHashes = new Map<string, string>();
  subjectHashes.set(manifestPath, createHash("sha256").update(JSON.stringify(manifest)).digest("hex"));
  for (const artifact of artifacts) subjectHashes.set(`build/reviewed/${artifact.path}`, artifact.sha256);
  return { root, manifestPath, subjectHashes };
}

function verifiedResult(f: Fixture, overrides: Record<string, unknown> = {}) {
  const cert = {
    issuer: "https://token.actions.githubusercontent.com",
    sourceRepositoryURI: "https://github.com/customer/fabrication",
    sourceRepositoryIdentifier: "765432",
    sourceRepositoryDigest: sha,
    sourceRepositoryRef: "refs/heads/review",
    runInvocationURI: "https://github.com/customer/fabrication/actions/runs/12345/attempts/2",
    buildSignerDigest: sha,
    buildSignerURI:
      "https://github.com/customer/fabrication/.github/workflows/boardreadyops-export.yml@refs/heads/review",
    runnerEnvironment: "github-hosted",
    buildTrigger: "push",
    subjectAlternativeName:
      "https://github.com/customer/fabrication/.github/workflows/boardreadyops-export.yml@refs/heads/review",
    ...(overrides.cert as Record<string, unknown> | undefined),
  };
  return {
    verificationResult: {
      signature: { certificate: cert },
      statement: {
        predicateType: "https://slsa.dev/provenance/v1",
        subject:
          overrides.subject ?? [...f.subjectHashes].map(([name, digest]) => ({ name, digest: { sha256: digest } })),
      },
    },
  };
}

function succeed(value: unknown): void {
  mockedRun.mockResolvedValue({ code: 0, stdout: JSON.stringify([value]), stderr: "", timedOut: false });
}

async function verify(f: Fixture, expected = expectation) {
  return verifyReviewedExportAttestation({ root: f.root, manifestPath: f.manifestPath, expected });
}

describe("opt-in trusted export attestation prerequisites (not GA)", () => {
  it("prepares an exact and sorted manifest-plus-output checksums set", async () => {
    const f = await fixture();
    const checksums = await prepareExportAttestationChecksums({
      root: f.root,
      manifestPath: f.manifestPath,
      reviewedSha: sha,
    });
    const records = checksums.trim().split("\n");
    expect(records).toHaveLength(3);
    expect(records).toEqual(
      [...f.subjectHashes].sort(([a], [b]) => a.localeCompare(b)).map(([name, digest]) => `${digest}  ${name}`),
    );
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("requires successful verifier execution and matching certificate + every subject digest", async () => {
    const f = await fixture();
    succeed(verifiedResult(f));
    const result = await verify(f);
    expect(result.status).toBe("eligible");
    expect(result.subjects).toBe(3);
    const [command, args] = mockedRun.mock.calls[0] ?? [];
    expect(command).toBe("gh");
    expect(args).toEqual(
      expect.arrayContaining([
        "--repo",
        "customer/fabrication",
        "--signer-workflow",
        "customer/fabrication/.github/workflows/boardreadyops-export.yml",
        "--source-digest",
        sha,
        "--deny-self-hosted-runners",
        "--format",
        "json",
      ]),
    );
  });

  it("accepts the legacy structured SAN only when its value matches the trusted workflow", async () => {
    const f = await fixture();
    succeed(
      verifiedResult(f, {
        cert: {
          subjectAlternativeName: {
            value:
              "https://github.com/customer/fabrication/.github/workflows/boardreadyops-export.yml@refs/heads/review",
          },
        },
      }),
    );
    expect((await verify(f)).status).toBe("eligible");
  });

  it.each([
    "https://github.com/customer/fabrication/.github/workflows/other.yml@refs/heads/review",
    "",
    1,
    ["https://github.com/customer/fabrication/.github/workflows/boardreadyops-export.yml@refs/heads/review"],
    { value: "https://github.com/customer/fabrication/.github/workflows/boardreadyops-export.yml@refs/heads/other" },
  ])("rejects a mismatched or unsupported certificate SAN shape: %j", async (san) => {
    const f = await fixture();
    succeed(verifiedResult(f, { cert: { subjectAlternativeName: san } }));
    expect((await verify(f)).status).toBe("rejected");
  });

  it.each([
    ["different repository identifier", { sourceRepositoryIdentifier: "99" }],
    ["different source SHA", { sourceRepositoryDigest: "b".repeat(40) }],
    ["different signer SHA", { buildSignerDigest: "b".repeat(40) }],
    ["different source ref", { sourceRepositoryRef: "refs/heads/main" }],
    ["replayed run", { runInvocationURI: "https://github.com/customer/fabrication/actions/runs/12344/attempts/2" }],
    ["replayed attempt", { runInvocationURI: "https://github.com/customer/fabrication/actions/runs/12345/attempts/1" }],
    [
      "different workflow",
      { buildSignerURI: "https://github.com/customer/fabrication/.github/workflows/other.yml@refs/heads/review" },
    ],
    [
      "incorrect signer SAN",
      {
        subjectAlternativeName: {
          value: "https://github.com/customer/fabrication/.github/workflows/other.yml@refs/heads/review",
        },
      },
    ],
    ["self-hosted runner", { runnerEnvironment: "self-hosted" }],
    ["incorrect issuer", { issuer: "https://other.invalid" }],
    ["wrong event", { buildTrigger: "workflow_dispatch" }],
  ])("rejects certificate mismatch: %s", async (_name, cert) => {
    const f = await fixture();
    succeed(verifiedResult(f, { cert }));
    expect((await verify(f)).status).toBe("rejected");
  });

  it("rejects missing, forged and additional attested subjects", async () => {
    const f = await fixture();
    const all = [...f.subjectHashes].map(([name, digest]) => ({ name, digest: { sha256: digest } }));
    for (const subject of [
      all.slice(1),
      [{ name: all[0]?.name, digest: { sha256: "f".repeat(64) } }, ...all.slice(1)],
      [...all, { name: "extra.dat", digest: { sha256: "b".repeat(64) } }],
      [all[0], all[0], all[2]],
    ]) {
      succeed(verifiedResult(f, { subject }));
      expect((await verify(f)).status).toBe("rejected");
    }
  });

  it("rejects unsigned output, nonzero exit, malformed result, and timeout", async () => {
    const f = await fixture();
    mockedRun.mockResolvedValue({ code: 1, stdout: "[]", stderr: "unavailable", timedOut: false });
    expect((await verify(f)).status).toBe("rejected");
    mockedRun.mockResolvedValue({ code: 0, stdout: "not-json", stderr: "", timedOut: false });
    expect((await verify(f)).status).toBe("rejected");
    mockedRun.mockResolvedValue({ code: 0, stdout: "[]", stderr: "", timedOut: true });
    expect((await verify(f)).status).toBe("rejected");
  });

  it("rejects tampered output or undeclared extras before attempting trust verification", async () => {
    const f = await fixture();
    await fs.writeFile(path.join(f.root, "build/reviewed/drill/board.drl"), "tampered");
    expect((await verify(f)).status).toBe("rejected");
    expect(mockedRun).not.toHaveBeenCalled();
    const g = await fixture();
    await fs.writeFile(path.join(g.root, "build/reviewed/gerbers/extra.gtl"), "extra");
    expect((await verify(g)).status).toBe("rejected");
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("does not accept an expected SHA derived from attacker-controlled unsigned inputs", async () => {
    const f = await fixture();
    succeed(verifiedResult(f));
    expect((await verify(f, { ...expectation, reviewedSha: "b".repeat(40) })).status).toBe("rejected");
    expect(mockedRun).not.toHaveBeenCalled();
  });
});
