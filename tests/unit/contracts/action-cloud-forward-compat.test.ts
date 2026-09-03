import { describe, expect, it } from "vitest";
import { ingestRunRequestSchema } from "../../../apps/web/app/api/v1/runs/route.js";
import { releaseRunResultSchema } from "../../../packages/contracts/src/index.js";

/**
 * Action->Cloud consumer-driven contract tests.
 *
 * The GitHub Action reports to the Cloud control plane over two distinct wire paths, both
 * exercised here with payload shapes copied from the Action's own producers so these tests
 * assert the real schemas, not a re-implementation of them (style matches
 * tests/unit/contracts/runner-protocol-forward-compat.test.ts):
 *
 * 1. `POST /api/v1/runs/github-actions-result` -- OIDC-authenticated, built by the
 *    "Publish OIDC-authenticated cloud result" step in .github/workflows/readiness-runner.yml.
 *    That route (apps/web/app/api/v1/runs/github-actions-result/route.ts) delegates straight to
 *    apps/web/app/api/v1/runs/result/route.ts, which parses the body with `releaseRunResultSchema`.
 * 2. `POST /api/v1/runs` -- bearer-token authenticated, built by
 *    src/action/cloud-publish.ts (`publishActionRunToCloud`), an opt-in "quick cloud upload" for
 *    an Action run that isn't going through the readiness-runner OIDC flow. Parsed by
 *    `ingestRunRequestSchema` in apps/web/app/api/v1/runs/route.ts -- the same schema the
 *    CLI->Cloud boundary uses (see tests/unit/contracts/cli-cloud-forward-compat.test.ts), since
 *    both producers hit this one endpoint.
 */

describe("Action->Cloud contract: POST /api/v1/runs/github-actions-result (readiness-runner OIDC result)", () => {
  const minimalOldActionResult = {
    status: "completed",
    decision: "pass",
    findings: [],
  };

  it("accepts a minimal payload shaped like an older Action that predates hardwareImpact/boms", () => {
    const result = releaseRunResultSchema.safeParse(minimalOldActionResult);
    expect(result.success).toBe(true);
  });

  it("accepts the full payload shape built by the readiness-runner.yml result-publishing step", () => {
    const result = releaseRunResultSchema.safeParse({
      version: 1,
      executionAttemptId: "7559e99b-4998-4e02-a94a-7a7a4686ae11",
      status: "completed",
      conclusion: "success",
      decision: "pass",
      findings: [
        { ruleId: "pcb.unrouted", severity: "error", message: "Two tracks remain unrouted.", path: "board.kicad_pcb" },
      ],
      artifacts: [],
      metrics: {
        findings_total: 1,
        findings_critical: 0,
        findings_high: 0,
        findings_medium: 0,
        findings_low: 0,
        findings_info: 0,
        findings_transmitted: 1,
        boms_transmitted: 0,
      },
      reportLinks: [
        { label: "GitHub Actions run", url: "https://github.com/octo-org/hardware-board/actions/runs/123" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("ignores (strips) an unrecognized field on a finding, per docs/architecture/contract-versioning.md", () => {
    const result = releaseRunResultSchema.safeParse({
      ...minimalOldActionResult,
      findings: [
        {
          ruleId: "pcb.unrouted",
          severity: "error",
          message: "Two tracks remain unrouted.",
          waived: true, // hypothetical future finding metadata the Action might start sending
        },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.success && "waived" in (result.data.findings[0] ?? {})).toBe(false);
  });

  // Unlike the runner-protocol response schemas (Cloud -> Runner, .strip() by default per the
  // W02 triage recorded in docs/development/master-execution-status.json), this envelope flows
  // the other direction and is authority-bearing for the receiving Cloud deployment: accepting it
  // completes a GitHub check run, may post a pull-request comment, closes the runner lease, and
  // writes an audit-trail row (apps/web/app/api/v1/runs/result/route.ts). Same rationale as
  // runnerRegistrationActivationResponseSchema in packages/contracts/src/runner-protocol.ts:
  // an unrecognized top-level field is treated as a signal of a confused/malformed producer, not
  // silently ignored. A future Action version that needs a genuinely new top-level field must add
  // it to releaseRunResultSchema as a real, reviewed change (optionally behind a schemaVersion
  // bump if not purely additive) -- it cannot just start sending it.
  it("still rejects an unrecognized top-level field (this envelope stays .strict(), deliberately)", () => {
    const result = releaseRunResultSchema.safeParse({
      ...minimalOldActionResult,
      installationId: "99999", // must never be accepted from result content
    });
    expect(result.success).toBe(false);
  });

  describe("unknown enum values are rejected, not silently accepted", () => {
    it("rejects an unrecognized status", () => {
      const result = releaseRunResultSchema.safeParse({
        ...minimalOldActionResult,
        status: "cancelled", // not in ["queued", "running", "completed", "timed_out", "failed"]
      });
      expect(result.success).toBe(false);
    });

    it("rejects an unrecognized decision", () => {
      const result = releaseRunResultSchema.safeParse({
        ...minimalOldActionResult,
        decision: "skipped", // not in ["pass", "fail", "error"]
      });
      expect(result.success).toBe(false);
    });
  });
});

describe("Action->Cloud contract: POST /api/v1/runs (cloud-publish quick upload)", () => {
  const minimalOldActionUploadPayload = {
    repositoryId: "octo-org/hardware-board",
    commitSha: "a".repeat(40),
    ref: "refs/heads/main",
    triggerKind: "push",
    findings: [],
    artifacts: [],
  };

  it("accepts a minimal payload shaped like an older Action cloud-publish step", () => {
    expect(ingestRunRequestSchema.safeParse(minimalOldActionUploadPayload).success).toBe(true);
  });

  it("accepts the full payload shape built by src/action/cloud-publish.ts", () => {
    const commitSha = "b".repeat(40);
    const result = ingestRunRequestSchema.safeParse({
      repositoryId: "octo-org/hardware-board",
      commitSha,
      ref: "refs/heads/main",
      pullRequestNumber: 7,
      triggerKind: "pr",
      findings: [{ ruleId: "pcb.unrouted", severity: "error", message: "Two tracks remain unrouted." }],
      artifacts: [],
      evidenceDigest: "d".repeat(64),
      title: `Action review for ${commitSha.slice(0, 8)}`,
    });
    expect(result.success).toBe(true);
  });

  it("ignores (strips) an unrecognized top-level field a newer Action might add", () => {
    const result = ingestRunRequestSchema.safeParse({
      ...minimalOldActionUploadPayload,
      actionSchemaHint: "future-optional-field",
    });
    expect(result.success).toBe(true);
    expect(result.success && "actionSchemaHint" in result.data).toBe(false);
  });

  it("rejects an unrecognized triggerKind rather than silently accepting it", () => {
    const result = ingestRunRequestSchema.safeParse({
      ...minimalOldActionUploadPayload,
      triggerKind: "schedule", // cloud-publish.ts only ever sends "push" or "pr"
    });
    expect(result.success).toBe(false);
  });
});
