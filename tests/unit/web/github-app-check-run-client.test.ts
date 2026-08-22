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
    const creationBody = JSON.parse(String(request.mock.calls[1]?.[1]?.body)) as {
      output?: { title?: string; summary?: string };
    };
    expect(creationBody.output).toEqual({
      title: "BoardReadyOps release readiness queued",
      summary: expect.stringContaining("Trust mode: Standard"),
    });
    expect(creationBody.output?.summary).not.toContain("Impact base SHA:");
  });

  it("binds a valid exact base SHA into the queued summary without extra repository metadata", async () => {
    request
      .mockResolvedValueOnce(jsonResponse({ check_runs: [] }))
      .mockResolvedValueOnce(jsonResponse({ id: 90 }, 201));

    await ensurePullRequestCheckRun({
      apiBaseUrl: "https://github.test/api/v3",
      token: "installation-token",
      input: {
        ...input,
        action: { ...input.action, baseCommitSha: "a".repeat(40) },
      },
      request,
    });

    const creationBody = JSON.parse(String(request.mock.calls[1]?.[1]?.body)) as {
      output?: { summary?: string };
    };
    expect(creationBody.output?.summary).toContain(`Impact base SHA: ${"a".repeat(40)}`);
    expect(creationBody.output?.summary).not.toContain("98765");
    expect(creationBody.output?.summary).not.toContain("installation-token");
  });

  it("surfaces safe-mode reasons and enforced restrictions while the Check Run is queued", async () => {
    request
      .mockResolvedValueOnce(jsonResponse({ check_runs: [] }))
      .mockResolvedValueOnce(jsonResponse({ id: 89 }, 201));

    await ensurePullRequestCheckRun({
      apiBaseUrl: "https://github.test/api/v3",
      token: "installation-token",
      input: {
        ...input,
        action: {
          ...input.action,
          repository: { ...input.action.repository, private: true },
          safeMode: { enabled: true, reasons: ["private-repository"] },
        },
      },
      request,
    });

    const creationBody = JSON.parse(String(request.mock.calls[1]?.[1]?.body)) as {
      output?: { summary?: string };
    };
    expect(creationBody.output?.summary).toContain("Trust mode: Safe (restricted)");
    expect(creationBody.output?.summary).toContain("private-repository");
    expect(creationBody.output?.summary).toContain("Managed evidence artifacts unavailable");
    expect(creationBody.output?.summary).toContain("safe-mode execution");
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

describe("GitHub App Check Run observation", () => {
  it("returns only normalized Check Run state", async () => {
    request.mockResolvedValueOnce(
      jsonResponse({
        id: 77,
        name: "BoardReadyOps / release readiness",
        external_id: "run-1",
        head_sha: "a".repeat(40),
        status: "completed",
        conclusion: "success",
        output: { title: "private", summary: "private findings" },
        details_url: "https://private.example/run",
      }),
    );

    const { readGitHubCheckRun } = await import("../../../apps/web/lib/github-app-check-run-client.js");
    await expect(
      readGitHubCheckRun({
        apiBaseUrl: "https://github.test/api/v3",
        token: "installation-token",
        repositoryOwner: "octo-org",
        repositoryName: "hardware-board",
        checkRunId: 77,
        request,
      }),
    ).resolves.toEqual({
      kind: "present",
      name: "BoardReadyOps / release readiness",
      externalId: "run-1",
      headSha: "a".repeat(40),
      status: "completed",
      conclusion: "success",
    });
  });

  it("maps 404 without exposing the response body", async () => {
    request.mockResolvedValueOnce(jsonResponse({ message: "private repository detail" }, 404));
    const { readGitHubCheckRun } = await import("../../../apps/web/lib/github-app-check-run-client.js");

    await expect(
      readGitHubCheckRun({
        apiBaseUrl: "https://api.github.com",
        token: "installation-token",
        repositoryOwner: "octo-org",
        repositoryName: "hardware-board",
        checkRunId: 77,
        request,
      }),
    ).resolves.toEqual({ kind: "not_found" });
  });

  it("uses status-only errors for failed observations", async () => {
    request.mockResolvedValueOnce(jsonResponse({ message: "token=do-not-leak private repository" }, 503));
    const { readGitHubCheckRun } = await import("../../../apps/web/lib/github-app-check-run-client.js");

    const promise = readGitHubCheckRun({
      apiBaseUrl: "https://api.github.com",
      token: "installation-token",
      repositoryOwner: "octo-org",
      repositoryName: "hardware-board",
      checkRunId: 77,
      request,
    });
    await expect(promise).rejects.toThrow("GitHub check run lookup failed with status 503");
    await expect(promise).rejects.not.toThrow("do-not-leak");
  });
});
