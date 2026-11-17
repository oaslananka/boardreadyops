import { describe, expect, it } from "vitest";
import { buildReadinessCheckOutput, buildReadinessPrComment } from "../../../apps/web/lib/readiness-result-format.js";
import { releaseRunResultSchema } from "../../../packages/contracts/src/index.js";
import { assertSameSignedContext, executePublisher } from "./readiness-callback-rolling-compat-helper.js";

const receipt = {
  ok: true,
  status: "accepted",
  runId: "a6e4d1d2-2a20-44d1-81f4-7680ffa583b7",
  executionAttemptId: "0cc0bf41-8a31-4afa-aac2-ccb7efa7c47d",
  checkRunUpdated: true,
};

describe("canonical GitHub Actions callback against rolling Cloud v1 receivers", () => {
  const readinessReport = {
    schemaVersion: 1,
    tool: { name: "boardreadyops", version: "1.24.1" },
    summary: { failed: false, total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    findings: [],
    readiness: {
      profile: { id: "sample", name: "Demo", service: "manufacturing" },
      score: 100,
      status: "ready",
      blocking: 0,
      nonBlocking: 0,
      evidence: [{ output: "bom", importance: "recommended", present: true }],
      missingRequired: [],
      missingRecommended: [],
      warnings: [],
    },
  };

  it("forwards actual Action readiness without profile or evidence claims, preserving signed context", async () => {
    const result = await executePublisher([{ status: 202, body: receipt }], readinessReport);
    expect(result.failure).toBeUndefined();
    expect(result.requests).toHaveLength(1);
    const payload = result.requests[0]?.payload;
    expect(payload?.readiness).toEqual({
      score: 100,
      status: "ready",
      blocking: 0,
      nonBlocking: 0,
      missingRequired: [],
      missingRecommended: [],
      warnings: [],
    });
    const parsed = releaseRunResultSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error("Readiness result schema rejected the producer payload");
    const check = buildReadinessCheckOutput(parsed.data);
    const comment = buildReadinessPrComment(parsed.data);
    expect(check.summary).toContain("100/100");
    expect(comment).toContain("100/100");
    expect(comment).not.toContain("| Readiness | Not reported |");
    assertSameSignedContext(result.requests);
  });

  it("keeps transmitted readiness unchanged across a signed retry of the exact callback", async () => {
    const result = await executePublisher(
      [
        { status: 400, body: { error: "invalid runner result" } },
        { status: 202, body: receipt },
      ],
      readinessReport,
    );
    expect(result.failure).toBeUndefined();
    expect(result.requests).toHaveLength(2);
    expect(result.requests[0]?.payload.readiness).toEqual(result.requests[1]?.payload.readiness);
    expect(releaseRunResultSchema.safeParse(result.requests[1]?.payload).success).toBe(true);
    assertSameSignedContext(result.requests);
  });

  it.each([
    { description: "out-of-range score", change: { score: 101 } },
    { description: "unknown status", change: { status: "fabrication-approved" } },
    { description: "invalid count", change: { blocking: -1 } },
    { description: "oversized warning", change: { warnings: ["x".repeat(1001)] } },
    { description: "oversized missing-output list", change: { missingRequired: Array(101).fill("gerber") } },
  ])("does not publish an invented readiness for $description", async ({ change }) => {
    const report = { ...readinessReport, readiness: { ...readinessReport.readiness, ...change } };
    const result = await executePublisher([{ status: 202, body: receipt }], report);
    expect(result.failure).toBeUndefined();
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0]?.payload).not.toHaveProperty("readiness");
    expect(releaseRunResultSchema.safeParse(result.requests[0]?.payload).success).toBe(true);
  });

  it("preserves signed tool observations on a compatible receiver", async () => {
    const result = await executePublisher([{ status: 202, body: receipt }]);
    expect(result.failure).toBeUndefined();
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0]?.payload.toolVersions).toEqual({ kicad: "10.0.7", boardReadyOps: "1.24.1" });
    assertSameSignedContext(result.requests);
  });

  it("removes only optional toolVersions for the exact legacy strict-v1 validation error", async () => {
    const result = await executePublisher([
      { status: 400, body: { error: "invalid runner result" } },
      { status: 202, body: receipt },
    ]);
    expect(result.failure).toBeUndefined();
    expect(result.requests).toHaveLength(2);
    expect(result.requests[1]?.payload).not.toHaveProperty("toolVersions");
    expect(result.failedMessages).toHaveLength(0);
    assertSameSignedContext(result.requests);
  });

  it.each([
    { label: "OIDC authentication rejection", status: 401, body: { error: "unauthorized" } },
    { label: "other schema rejection", status: 400, body: { error: "invalid target" } },
    { label: "non-exact schema error", status: 400, body: { error: "invalid runner result", detail: "other" } },
    { label: "non-JSON response", status: 400, body: null },
  ])("fails closed for $label without removing signed fields", async ({ status, body }) => {
    const result = await executePublisher([{ status, body }]);
    expect(String(result.failure)).toMatch(/BoardReadyOps Cloud callback failed/u);
    expect(result.requests).toHaveLength(3);
    for (const request of result.requests) expect(request.payload).toHaveProperty("toolVersions");
    assertSameSignedContext(result.requests);
  });
  it("accepts a persisted, exact matching idempotent replay receipt", async () => {
    const result = await executePublisher([{ status: 200, body: { ...receipt, status: "replayed" } }]);
    expect(result.failure).toBeUndefined();
    expect(result.requests).toHaveLength(1);
    assertSameSignedContext(result.requests);
  });

  it("retries a generic 2xx response before accepting a matching persisted Check Run receipt", async () => {
    const result = await executePublisher([
      { status: 200, body: { ok: true } },
      { status: 202, body: receipt },
    ]);
    expect(result.failure).toBeUndefined();
    expect(result.requests).toHaveLength(2);
    assertSameSignedContext(result.requests);
  });

  it.each([
    { label: "HTML success page", status: 200, body: null },
    { label: "generic 200 OK without persisted result", status: 200, body: { ok: true } },
    { label: "wrong run", status: 202, body: { ...receipt, runId: "other-run" } },
    { label: "wrong attempt", status: 202, body: { ...receipt, executionAttemptId: "other-attempt" } },
    { label: "Check Run not published", status: 202, body: { ...receipt, checkRunUpdated: false } },
    { label: "unrecognized receipt status", status: 202, body: { ...receipt, status: "pending" } },
  ])("fails closed after three bounded attempts for $label", async ({ status, body }) => {
    const result = await executePublisher([{ status, body }]);
    expect(String(result.failure)).toContain(
      "BoardReadyOps Cloud callback did not confirm the persisted result and Check Run.",
    );
    expect(result.requests).toHaveLength(3);
    expect(result.failedMessages).toHaveLength(0);
    assertSameSignedContext(result.requests);
  });
});
