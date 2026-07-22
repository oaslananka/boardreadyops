import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensurePullRequestCheckRun,
  upsertReadinessComment,
} from "../../../apps/web/lib/github-app-check-run-client.js";

const request = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  request.mockReset();
});

describe("GitHub App Check Run ensure", () => {
  const input = {
    action: {
      type: "release_run.enqueue" as const,
      installation: { id: 12345 },
      repository: {
        id: 98765,
        owner: "octo-org",
        name: "hardware-board",
        fullName: "octo-org/hardware-board",
        private: false,
        defaultBranch: "main",
      },
      pullRequestNumber: 42,
      ref: "feature/ready",
      commitSha: "0123456789abcdef",
      triggerKind: "pr" as const,
    },
    runId: "run-1",
    idempotencyKey: "98765:42:0123456789abcdef",
  };

  it("reuses the Check Run whose external_id is the release run ID", async () => {
    request.mockResolvedValueOnce(
      jsonResponse({
        check_runs: [
          { id: 77, name: "BoardReadyOps / release readiness", external_id: "run-1" },
          { id: 78, name: "BoardReadyOps / release readiness", external_id: "other-run" },
        ],
      }),
    );

    await expect(
      ensurePullRequestCheckRun({
        apiBaseUrl: "https://github.test/api/v3",
        token: "installation-token",
        input,
        request,
      }),
    ).resolves.toEqual({ id: 77 });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      "https://github.test/api/v3/repos/octo-org/hardware-board/commits/0123456789abcdef/check-runs?check_name=BoardReadyOps%20%2F%20release%20readiness&filter=all&per_page=100",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("creates a Check Run only when no external_id match exists", async () => {
    request
      .mockResolvedValueOnce(jsonResponse({ check_runs: [] }))
      .mockResolvedValueOnce(jsonResponse({ id: 88 }, 201));

    await expect(
      ensurePullRequestCheckRun({
        apiBaseUrl: "https://github.test/api/v3",
        token: "installation-token",
        input,
        request,
      }),
    ).resolves.toEqual({ id: 88 });
    expect(request).toHaveBeenNthCalledWith(
      2,
      "https://github.test/api/v3/repos/octo-org/hardware-board/check-runs",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"external_id":"run-1"'),
      }),
    );
  });
});

describe("GitHub App readiness comment upsert", () => {
  it("updates the existing marker comment instead of creating duplicates", async () => {
    request
      .mockResolvedValueOnce(
        jsonResponse([
          { id: 41, body: "unrelated" },
          { id: 42, body: "old result\n<!-- boardreadyops:release-readiness -->" },
        ]),
      )
      .mockResolvedValueOnce(jsonResponse({ id: 42 }));

    await upsertReadinessComment({
      apiBaseUrl: "https://github.test/api/v3",
      token: "installation-token",
      repositoryOwner: "octo-org",
      repositoryName: "hardware-board",
      pullRequestNumber: 17,
      body: "new result\n<!-- boardreadyops:release-readiness -->",
      request,
    });

    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenNthCalledWith(
      1,
      "https://github.test/api/v3/repos/octo-org/hardware-board/issues/17/comments",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ authorization: "Bearer installation-token" }),
      }),
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      "https://github.test/api/v3/repos/octo-org/hardware-board/issues/comments/42",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ body: "new result\n<!-- boardreadyops:release-readiness -->" }),
      }),
    );
  });

  it("creates a marker comment when no previous readiness output exists", async () => {
    request.mockResolvedValueOnce(jsonResponse([])).mockResolvedValueOnce(jsonResponse({ id: 99 }, 201));

    await upsertReadinessComment({
      apiBaseUrl: "https://github.test/api/v3",
      token: "installation-token",
      repositoryOwner: "octo-org",
      repositoryName: "hardware-board",
      pullRequestNumber: 17,
      body: "first result\n<!-- boardreadyops:release-readiness -->",
      request,
    });

    expect(request).toHaveBeenNthCalledWith(
      2,
      "https://github.test/api/v3/repos/octo-org/hardware-board/issues/17/comments",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ body: "first result\n<!-- boardreadyops:release-readiness -->" }),
      }),
    );
  });
});
