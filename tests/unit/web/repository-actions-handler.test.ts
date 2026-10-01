import { describe, expect, it, vi } from "vitest";

const apiAuth = vi.hoisted(() => ({
  authenticateApiRequest: vi.fn(),
  resolveRepositoryApiContext: vi.fn(),
}));

vi.mock("../../../apps/web/lib/api-auth.js", () => apiAuth);

const { handleRepositoryAction } = await import("../../../apps/web/lib/repository-actions.js");

describe("repository action failure contract", () => {
  it("returns a stable safe code and correlates the response with server telemetry", async () => {
    const databaseError = Object.assign(new Error("column base_commit_sha does not exist"), { code: "42703" });
    const close = vi.fn(async () => undefined);
    const executor = {
      query: vi.fn(async () => {
        throw databaseError;
      }),
      close,
    };
    apiAuth.authenticateApiRequest.mockResolvedValue({ ok: true, actorId: "actor-1" });
    apiAuth.resolveRepositoryApiContext.mockResolvedValue({ repositoryId: "repo-1", executor });

    const logLines: string[] = [];
    const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      logLines.push(String(chunk));
      return true;
    });

    try {
      const response = await handleRepositoryAction(
        new Request("https://boardreadyops.example/api/v1/repositories/repo-1/actions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "rerun", runId: "run-1" }),
        }),
        "repo-1",
        {
          environment: {},
          readPermissions: async () => undefined,
          now: () => new Date("2026-10-01T04:35:02.000Z"),
          newId: () => "request-correlation-1",
        },
      );

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        error: "The action could not be queued. Please try again.",
        code: "repository_action_queue_failed",
        requestId: "request-correlation-1",
      });
      expect(close).toHaveBeenCalledOnce();

      const telemetry = logLines
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .find((entry) => entry.event === "repository.action");
      expect(telemetry).toMatchObject({
        action: "rerun",
        outcome: "failed",
        errorClass: "Error",
        errorCode: "42703",
        requestId: "request-correlation-1",
      });
    } finally {
      write.mockRestore();
    }
  });
});
