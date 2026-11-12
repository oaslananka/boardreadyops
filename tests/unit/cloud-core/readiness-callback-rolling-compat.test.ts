import { describe, expect, it } from "vitest";
import { assertSameSignedContext, executePublisher } from "./readiness-callback-rolling-compat-helper.js";

const receipt = {
  ok: true,
  status: "accepted",
  runId: "a6e4d1d2-2a20-44d1-81f4-7680ffa583b7",
  executionAttemptId: "0cc0bf41-8a31-4afa-aac2-ccb7efa7c47d",
  checkRunUpdated: true,
};

describe("canonical GitHub Actions callback against rolling Cloud v1 receivers", () => {
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
