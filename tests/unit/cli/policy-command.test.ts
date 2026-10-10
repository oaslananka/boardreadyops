import { afterEach, describe, expect, it, vi } from "vitest";
import { policyCommand } from "../../../src/cli/commands/policy.js";
import * as attestation from "../../../src/release/export-attestation.js";
import { writeFixture } from "../rules/helpers.js";

function collectStreams() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    streams: {
      stdout: { write: (text: string) => out.push(text) } as unknown as NodeJS.WritableStream,
      stderr: { write: (text: string) => err.push(text) } as unknown as NodeJS.WritableStream,
    },
  };
}

const signedPolicy =
  "version: 1\nfail-on: never\npolicy:\n  enforce: true\n  rules:\n    - id: signed-manufacturing\n      type: require-source-bound-export\n";

const trustedOptions = {
  manifest: "build/boardreadyops-attested/manifest.json",
  repository: "customer/fabrication",
  repositoryId: "765432",
  reviewedSourceSha: "a".repeat(40),
  sourceRef: "refs/heads/main",
  workflow: ".github/workflows/export.yml",
  event: "workflow_dispatch",
  runId: "12345",
  runAttempt: "1",
};

afterEach(() => vi.restoreAllMocks());

describe("policy command", () => {
  it("fails closed when signed source-bound evidence is missing", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_pcb": "(kicad_pcb)",
      "boardreadyops.yml": signedPolicy,
    });
    const { out, streams } = collectStreams();
    const code = await policyCommand(root, { format: "json" }, streams);
    expect(code).toBe(1);
    const result = JSON.parse(out.join("")) as {
      status: string;
      sourceBound: { status: string };
      rules: Array<{ status: string }>;
    };
    expect(result.status).toBe("fail");
    expect(result.sourceBound.status).toBe("unverified");
    expect(result.rules[0]?.status).toBe("fail");
  });

  it("admits source-bound proof only after the independent cryptographic verifier returns eligible", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_pcb": "(kicad_pcb)",
      "boardreadyops.yml": signedPolicy,
    });
    const verify = vi.spyOn(attestation, "verifyReviewedExportAttestation").mockResolvedValue({
      status: "eligible",
      reason: "cryptographic signature accepted",
      subjects: 27,
      sourceSha: "a".repeat(40),
      runInvocationURI: "https://github.com/customer/fabrication/actions/runs/12345/attempts/1",
    });
    const { out, streams } = collectStreams();
    const code = await policyCommand(root, { ...trustedOptions, format: "json" }, streams);
    expect(code).toBe(0);
    expect(verify).toHaveBeenCalledWith(
      expect.objectContaining({
        root,
        manifestPath: trustedOptions.manifest,
        expected: expect.objectContaining({
          repository: "customer/fabrication",
          repositoryId: "765432",
          runId: "12345",
          runAttempt: 1,
        }),
      }),
    );
    const policy = JSON.parse(out.join("")) as {
      status: string;
      sourceBound: { status: string; subjects: number };
    };
    expect(policy.status).toBe("pass");
    expect(policy.sourceBound).toMatchObject({ status: "source-bound-verified", subjects: 27 });
  });

  it("rejects signature failure, wrong run or incomplete trusted expectations", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_pcb": "(kicad_pcb)",
      "boardreadyops.yml": signedPolicy,
    });
    const verify = vi.spyOn(attestation, "verifyReviewedExportAttestation").mockResolvedValue({
      status: "rejected",
      reason: "wrong signer run",
    });
    const { out, streams } = collectStreams();
    expect(await policyCommand(root, { ...trustedOptions, format: "json" }, streams)).toBe(1);
    const failure = JSON.parse(out.join("")) as { status: string; sourceBound: { status: string } };
    expect(failure.status).toBe("fail");
    expect(failure.sourceBound.status).toBe("unverified");
    verify.mockClear();
    const second = collectStreams();
    expect(await policyCommand(root, { manifest: trustedOptions.manifest, format: "json" }, second.streams)).toBe(1);
    expect(verify).not.toHaveBeenCalled();
    expect((JSON.parse(second.out.join("")) as { status: string }).status).toBe("fail");
  });

  it("reports when no policy is configured", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch": "(kicad_sch)",
      "board.kicad_pcb": "(kicad_pcb)",
      "boardreadyops.yml": "version: 1\nfail-on: never\n",
    });
    const { out, streams } = collectStreams();
    const code = await policyCommand(root, {} as never, streams);
    expect(code).toBe(0);
    expect(out.join("")).toContain("No policy configured");
  });

  it("blocks with exit code 1 when an enforced policy fails", async () => {
    // No schematic -> a high-severity project-discovery finding -> max-severity:high fails.
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_pcb": "(kicad_pcb)",
      "boardreadyops.yml":
        "version: 1\nfail-on: never\npolicy:\n  enforce: true\n  rules:\n    - id: no-high\n      type: max-severity\n      severity: high\n",
    });
    const { out, streams } = collectStreams();
    const code = await policyCommand(root, {} as never, streams);
    expect(code).toBe(1);
    expect(out.join("")).toContain("Policy: FAIL (enforced)");
  });

  it("never changes the exit code in simulate mode", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_pcb": "(kicad_pcb)",
      "boardreadyops.yml":
        "version: 1\nfail-on: never\npolicy:\n  enforce: true\n  rules:\n    - id: no-high\n      type: max-severity\n      severity: high\n",
    });
    const { streams } = collectStreams();
    const code = await policyCommand(root, { simulate: true } as never, streams);
    expect(code).toBe(0);
  });

  it("does not block when the policy is advisory only", async () => {
    const root = await writeFixture({
      "board.kicad_pro": "{}",
      "board.kicad_sch": "(kicad_sch)",
      "board.kicad_pcb": "(kicad_pcb)",
      "boardreadyops.yml":
        "version: 1\nfail-on: never\npolicy:\n  rules:\n    - id: no-high\n      type: max-severity\n      severity: high\n",
    });
    const { streams } = collectStreams();
    const code = await policyCommand(root, {} as never, streams);
    expect(code).toBe(0);
  });
});
