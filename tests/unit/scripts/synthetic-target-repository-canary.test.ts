import { describe, expect, it, vi } from "vitest";
import {
  readSyntheticCanaryOptions,
  runSyntheticCanary,
  SyntheticCanaryError,
  updateSyntheticCanaryPullRequest,
  verifySyntheticCanary,
} from "../../../scripts/synthetic-target-repository-canary.mjs";

type ExpectedRequest = {
  method: string;
  path: string;
  status?: number;
  response?: unknown;
  body?: unknown;
};

function requestQueue(expected: ExpectedRequest[]) {
  const queue = [...expected];
  const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const next = queue.shift();
    if (!next) throw new Error(`unexpected request: ${String(input)}`);
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    expect(method).toBe(next.method);
    expect(`${url.pathname}${url.search}`).toBe(next.path);
    if (next.body !== undefined) {
      expect(JSON.parse(String(init?.body))).toEqual(next.body);
    }
    return new Response(JSON.stringify(next.response ?? {}), {
      status: next.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  });
  return { request, remaining: () => queue.length };
}

function options(overrides: Record<string, string> = {}) {
  return readSyntheticCanaryOptions({
    GITHUB_REPOSITORY: "oaslananka/boardreadyops-canary-public",
    GITHUB_TOKEN: "github-token",
    GITHUB_RUN_ID: "123456",
    GITHUB_RUN_ATTEMPT: "2",
    BOARDREADYOPS_CANARY_VISIBILITY: "public",
    ...overrides,
  });
}

describe("synthetic target-repository canary options", () => {
  it("requires repository context and validates visibility", () => {
    expect(() => readSyntheticCanaryOptions({})).toThrow("GITHUB_REPOSITORY is required");
    expect(() => options({ BOARDREADYOPS_CANARY_VISIBILITY: "internal" })).toThrow(
      "BOARDREADYOPS_CANARY_VISIBILITY must be public or private",
    );
  });

  it("uses bounded production defaults", () => {
    expect(options()).toMatchObject({
      repository: "oaslananka/boardreadyops-canary-public",
      visibility: "public",
      branch: "boardreadyops-canary",
      pullRequestTitle: "chore: BoardReadyOps synthetic canary",
      noncePath: "canary/nonce.txt",
      checkRunName: "BoardReadyOps / release readiness",
      readinessWorkflow: "readiness-runner.yml",
      publicOrigin: "https://boardreadyops.oaslananka.dev",
      timeoutMs: 1_200_000,
      pollIntervalMs: 15_000,
      maxRequests: 256,
      runId: "123456",
      runAttempt: "2",
    });
  });
});

describe("synthetic canary pull request mutation", () => {
  it("creates one exact-parent nonce commit, updates the branch, and reuses the persistent pull request", async () => {
    const mainSha = "a".repeat(40);
    const treeSha = "b".repeat(40);
    const blobSha = "c".repeat(40);
    const createdTreeSha = "d".repeat(40);
    const canarySha = "e".repeat(40);
    const { request, remaining } = requestQueue([
      {
        method: "GET",
        path: "/repos/oaslananka/boardreadyops-canary-public",
        response: {
          full_name: "oaslananka/boardreadyops-canary-public",
          private: false,
          default_branch: "main",
        },
      },
      {
        method: "GET",
        path: "/repos/oaslananka/boardreadyops-canary-public/git/ref/heads/main",
        response: { object: { sha: mainSha } },
      },
      {
        method: "GET",
        path: `/repos/oaslananka/boardreadyops-canary-public/git/commits/${mainSha}`,
        response: { tree: { sha: treeSha } },
      },
      {
        method: "POST",
        path: "/repos/oaslananka/boardreadyops-canary-public/git/blobs",
        body: {
          content: "2026-07-27T00:00:00.000Z\nworkflow_run_id=123456\nworkflow_run_attempt=2\n",
          encoding: "utf-8",
        },
        response: { sha: blobSha },
      },
      {
        method: "POST",
        path: "/repos/oaslananka/boardreadyops-canary-public/git/trees",
        body: {
          base_tree: treeSha,
          tree: [{ path: "canary/nonce.txt", mode: "100644", type: "blob", sha: blobSha }],
        },
        response: { sha: createdTreeSha },
      },
      {
        method: "POST",
        path: "/repos/oaslananka/boardreadyops-canary-public/git/commits",
        body: {
          message: "chore: update BoardReadyOps synthetic canary",
          tree: createdTreeSha,
          parents: [mainSha],
        },
        response: { sha: canarySha },
      },
      {
        method: "GET",
        path: "/repos/oaslananka/boardreadyops-canary-public/git/ref/heads/boardreadyops-canary",
        response: { ref: "refs/heads/boardreadyops-canary" },
      },
      {
        method: "PATCH",
        path: "/repos/oaslananka/boardreadyops-canary-public/git/refs/heads/boardreadyops-canary",
        body: { sha: canarySha, force: true },
      },
      {
        method: "GET",
        path: "/repos/oaslananka/boardreadyops-canary-public/pulls?state=open&head=oaslananka%3Aboardreadyops-canary&base=main&per_page=10",
        response: [{ number: 7 }],
      },
    ]);

    await expect(
      updateSyntheticCanaryPullRequest(options(), {
        request,
        now: () => new Date("2026-07-27T00:00:00.000Z"),
      }),
    ).resolves.toEqual({ expectedSha: canarySha, pullRequestNumber: 7 });
    expect(remaining()).toBe(0);
  });
});

describe("synthetic canary convergence", () => {
  it("accepts only an exact-SHA successful Check Run bound to the target readiness workflow", async () => {
    const expectedSha = "e".repeat(40);
    const runUuid = "7559e99b-4998-4e02-a94a-7a7a4686ae11";
    const workflowUrl = "https://github.com/oaslananka/boardreadyops-canary-public/actions/runs/9988";
    const { request, remaining } = requestQueue([
      {
        method: "GET",
        path: `/repos/oaslananka/boardreadyops-canary-public/commits/${expectedSha}/check-runs?check_name=BoardReadyOps+%2F+release+readiness&filter=all&per_page=100`,
        response: {
          check_runs: [
            { id: 55, name: "BoardReadyOps / release readiness", head_sha: expectedSha, status: "completed" },
          ],
        },
      },
      {
        method: "GET",
        path: "/repos/oaslananka/boardreadyops-canary-public/check-runs/55",
        response: {
          id: 55,
          name: "BoardReadyOps / release readiness",
          head_sha: expectedSha,
          status: "completed",
          conclusion: "success",
          external_id: runUuid,
          details_url: `https://boardreadyops.oaslananka.dev/runs/${runUuid}`,
          html_url: "https://github.com/oaslananka/boardreadyops-canary-public/runs/55",
          output: { summary: `**Reports:** 1\n\n- [GitHub Actions run](${workflowUrl})` },
        },
      },
      {
        method: "GET",
        path: "/repos/oaslananka/boardreadyops-canary-public/actions/workflows/readiness-runner.yml",
        response: { id: 77 },
      },
      {
        method: "GET",
        path: "/repos/oaslananka/boardreadyops-canary-public/actions/runs/9988",
        response: {
          id: 9988,
          event: "workflow_dispatch",
          workflow_id: 77,
          status: "completed",
          conclusion: "success",
          html_url: workflowUrl,
          repository: { full_name: "oaslananka/boardreadyops-canary-public" },
        },
      },
    ]);

    await expect(verifySyntheticCanary(options(), expectedSha, { request })).resolves.toEqual({
      expectedSha,
      checkRunId: 55,
      checkRunUrl: "https://github.com/oaslananka/boardreadyops-canary-public/runs/55",
      releaseRunId: runUuid,
      workflowRunId: 9988,
      workflowUrl,
    });
    expect(remaining()).toBe(0);
  });

  it("rejects invalid Check Run binding without leaking raw response content", async () => {
    const expectedSha = "e".repeat(40);
    const { request } = requestQueue([
      {
        method: "GET",
        path: `/repos/oaslananka/boardreadyops-canary-public/commits/${expectedSha}/check-runs?check_name=BoardReadyOps+%2F+release+readiness&filter=all&per_page=100`,
        response: {
          check_runs: [
            { id: 55, name: "BoardReadyOps / release readiness", head_sha: expectedSha, status: "completed" },
          ],
        },
      },
      {
        method: "GET",
        path: "/repos/oaslananka/boardreadyops-canary-public/check-runs/55",
        response: {
          id: 55,
          name: "BoardReadyOps / release readiness",
          head_sha: expectedSha,
          status: "completed",
          conclusion: "success",
          external_id: "private-payload-token=do-not-leak",
          details_url: "https://boardreadyops.oaslananka.dev/runs/invalid",
          output: { summary: "private finding" },
        },
      },
    ]);

    const failure = verifySyntheticCanary(options(), expectedSha, { request });
    await expect(failure).rejects.toMatchObject({ reason: "canary_check_run_binding_invalid" });
    await expect(failure).rejects.not.toThrow("do-not-leak");
  });

  it("returns a stable missing reason when bounded polling expires", async () => {
    let current = 0;
    const request = vi.fn(
      async () =>
        new Response(JSON.stringify({ check_runs: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const bounded = options({
      BOARDREADYOPS_CANARY_TIMEOUT_SECONDS: "2",
      BOARDREADYOPS_CANARY_POLL_INTERVAL_SECONDS: "1",
      BOARDREADYOPS_CANARY_MAX_REQUESTS: "4",
    });

    const failure = verifySyntheticCanary(bounded, "e".repeat(40), {
      request,
      now: () => current,
      sleep: async (ms) => {
        current += ms;
      },
    });
    await expect(failure).rejects.toMatchObject({ reason: "canary_check_run_missing" });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("runs mutation and verification with one safe result shape", async () => {
    const mutation = vi.fn(async () => ({ expectedSha: "e".repeat(40), pullRequestNumber: 7 }));
    const verification = vi.fn(async () => ({
      expectedSha: "e".repeat(40),
      checkRunId: 55,
      releaseRunId: "7559e99b-4998-4e02-a94a-7a7a4686ae11",
      workflowRunId: 9988,
      workflowUrl: "https://github.com/oaslananka/boardreadyops-canary-public/actions/runs/9988",
    }));

    await expect(runSyntheticCanary(options(), { mutation, verification })).resolves.toMatchObject({
      ok: true,
      repository: "oaslananka/boardreadyops-canary-public",
      visibility: "public",
      pullRequestNumber: 7,
      expectedSha: "e".repeat(40),
      workflowRunId: 9988,
    });
  });

  it("uses typed stable failures", () => {
    const error = new SyntheticCanaryError("canary_github_api_unavailable", "GitHub request failed", {
      elapsedMs: 50,
    });
    expect(error).toMatchObject({
      reason: "canary_github_api_unavailable",
      message: "GitHub request failed",
      details: { elapsedMs: 50 },
    });
  });
});
