import { describe, expect, it } from "vitest";
import { ingestRunRequestSchema } from "../../../apps/web/app/api/v1/runs/route.js";

/**
 * CLI->Cloud consumer-driven contract tests.
 *
 * `boardreadyops review publish` (src/cli/commands/review.ts) POSTs directly to
 * `POST /api/v1/runs`, bearer-token authenticated, without going through the job-lease
 * Runner<->Control-Plane protocol in packages/contracts/src/runner-protocol.ts (that protocol
 * is for self-hosted/managed runners polling for work; this is the CLI publishing a review it
 * already ran locally). The Cloud control plane -- potentially an older deployment than the CLI
 * that is calling it -- is the consumer here, parsing `ingestRunRequestSchema` from
 * apps/web/app/api/v1/runs/route.ts. Style matches
 * tests/unit/contracts/runner-protocol-forward-compat.test.ts: assert the additive-vs-breaking
 * policy in docs/architecture/contract-versioning.md actually holds for this boundary's real
 * schema, not a re-implementation of it.
 */

const minimalOldCliPayload = {
  repositoryId: "octo-org/hardware-board",
  commitSha: "a".repeat(40),
  ref: "refs/heads/main",
  triggerKind: "manual",
  findings: [],
  artifacts: [],
};

describe("CLI->Cloud contract: POST /api/v1/runs (review publish)", () => {
  it("accepts a minimal payload shaped like an older CLI that predates evidenceDigest/baseCommitSha/title", () => {
    expect(ingestRunRequestSchema.safeParse(minimalOldCliPayload).success).toBe(true);
  });

  it("accepts the full payload shape sent by the current `review publish` command", () => {
    const result = ingestRunRequestSchema.safeParse({
      repositoryId: "octo-org/hardware-board",
      commitSha: "b".repeat(40),
      ref: "refs/heads/main",
      pullRequestNumber: 42,
      triggerKind: "manual",
      findings: [
        {
          ruleId: "pcb.unrouted",
          severity: "error",
          message: "Two tracks remain unrouted.",
          path: "board.kicad_pcb",
          project: "hardware/mainboard/mainboard.kicad_pro",
          fingerprint: "c".repeat(64),
          startLine: 12,
        },
      ],
      artifacts: [],
      evidenceDigest: "d".repeat(64),
      title: "Review for b1234567",
      baseCommitSha: "e".repeat(40),
    });
    expect(result.success).toBe(true);
  });

  it("accepts a review-canvas snapshot manifest produced by `boardreadyops review publish`", () => {
    const result = ingestRunRequestSchema.safeParse({
      ...minimalOldCliPayload,
      snapshots: [
        {
          id: "snap_sch_board",
          name: "schematic_board.svg",
          kind: "schematic",
          format: "svg",
          sheetOrLayer: "board",
          width: 1200,
          height: 800,
          content: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
          sha256: "f".repeat(64),
          anchors: [],
        },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.snapshots).toHaveLength(1);
    expect(result.success && result.data.snapshots[0]?.sheetOrLayer).toBe("board");
  });

  it("rejects a snapshot with an unrecognized kind", () => {
    const result = ingestRunRequestSchema.safeParse({
      ...minimalOldCliPayload,
      snapshots: [
        {
          id: "snap_x",
          name: "x.svg",
          kind: "exploded_view",
          format: "svg",
          sheetOrLayer: "board",
          width: 100,
          height: 100,
          sha256: "f".repeat(64),
          anchors: [],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("ignores (strips) an unrecognized top-level field a newer CLI might add, per docs/architecture/contract-versioning.md", () => {
    const result = ingestRunRequestSchema.safeParse({
      ...minimalOldCliPayload,
      cliSchemaHint: "future-optional-field", // hypothetical future CLI addition
    });
    expect(result.success).toBe(true);
    expect(result.success && "cliSchemaHint" in result.data).toBe(false);
  });

  it("ignores (strips) an unrecognized field on a finding, not an identity-bearing schema", () => {
    const result = ingestRunRequestSchema.safeParse({
      ...minimalOldCliPayload,
      findings: [
        {
          ruleId: "pcb.unrouted",
          severity: "error",
          message: "Two tracks remain unrouted.",
          suppressedBy: "waiver-123", // hypothetical future finding metadata
        },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.success && "suppressedBy" in (result.data.findings[0] ?? {})).toBe(false);
  });

  // repositoryId is the only identity-bearing field this schema carries, and it is not something
  // an unexpected body key can impersonate: authorization cross-checks the parsed repositoryId
  // against the bearer token's own scope in apps/web/lib/api-auth.ts
  // (resolveRepositoryApiContext), and a stray key like the one below is stripped by this schema
  // before that check ever runs -- so it can never reach authorization logic.
  it("ignores (strips) an unrecognized identity-adjacent field rather than letting it reach authorization logic", () => {
    const result = ingestRunRequestSchema.safeParse({
      ...minimalOldCliPayload,
      installationId: "99999",
    });
    expect(result.success).toBe(true);
    expect(result.success && "installationId" in result.data).toBe(false);
  });

  describe("unknown enum values are rejected, not silently accepted", () => {
    it("rejects an unrecognized triggerKind", () => {
      const result = ingestRunRequestSchema.safeParse({
        ...minimalOldCliPayload,
        triggerKind: "scheduled", // not in ["push", "pr", "manual", "workflow_dispatch"]
      });
      expect(result.success).toBe(false);
    });

    it("rejects an unrecognized finding severity", () => {
      // "critical" is a local Finding severity (src/core/findings.ts) that is always mapped to
      // "error" before crossing the wire (src/core/cloud-findings.ts); it is never a valid wire value.
      const result = ingestRunRequestSchema.safeParse({
        ...minimalOldCliPayload,
        findings: [{ ruleId: "pcb.unrouted", severity: "critical", message: "x" }],
      });
      expect(result.success).toBe(false);
    });
  });
});
