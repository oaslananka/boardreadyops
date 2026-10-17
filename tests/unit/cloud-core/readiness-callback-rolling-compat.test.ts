import { describe, expect, it } from "vitest";
import { assertSameSignedContext, executePublisher } from "./readiness-callback-rolling-compat-helper.js";

describe("canonical GitHub Actions callback against rolling Cloud v1 receivers", () => {
  it("preserves signed tool observations on a compatible receiver", async () => {
    const result = await executePublisher([{ status: 202, body: { ok: true } }]);
    expect(result.failure).toBeUndefined();
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0]?.payload.toolVersions).toEqual({ kicad: "10.0.7", boardReadyOps: "1.24.1" });
    assertSameSignedContext(result.requests);
  });

  it("removes only optional toolVersions for the exact legacy strict-v1 validation error", async () => {
    const result = await executePublisher([
      { status: 400, body: { error: "invalid runner result" } },
      { status: 202, body: { ok: true } },
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
});
