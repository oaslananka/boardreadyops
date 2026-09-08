import { describe, expect, it, vi } from "vitest";
import {
  createGitHubCommandLifecycleExecutor,
  readGitHubPullRequestContext,
  upsertGitHubCommandResponse,
} from "../../../apps/web/lib/github-command-executor.js";

const repository = {
  id: 456,
  owner: "octo",
  name: "board",
  fullName: "octo/board",
  private: false,
  defaultBranch: "main",
};

function commandAction(body: string, association = "MEMBER") {
  return {
    type: "github_command.execute" as const,
    installation: { id: 123 },
    repository,
    pullRequestNumber: 7,
    commentId: 44,
    commentBody: body,
    commentAuthor: "octocat",
    authorAssociation: association,
  };
}

const pullRequest = {
  headCommitSha: "a".repeat(40),
  headRef: "feature/board",
  baseCommitSha: "b".repeat(40),
  pullRequestDraft: false,
  pullRequestFromFork: false,
};

function executorWithPermissions(
  permissions: Record<string, string | undefined>,
  pullRequestContext: typeof pullRequest & {
    pullRequestDraft?: boolean;
    pullRequestFromFork?: boolean;
    safeMode?: { enabled: true; reasons: Array<"draft-pull-request" | "fork-pull-request" | "private-repository"> };
  } = pullRequest,
) {
  const readPullRequest = vi.fn(async () => pullRequestContext);
  const upsertResponse = vi.fn(async () => undefined);
  const executor = createGitHubCommandLifecycleExecutor({
    authenticateInstallation: vi.fn(async () => ({ token: "installation-token", permissions })),
    api: vi.fn(() => ({ readPullRequest, upsertResponse })),
  });
  return { executor, readPullRequest, upsertResponse };
}

describe("GitHub command lifecycle executor", () => {
  it("turns an authorized rerun command into a release action bound to the current PR head and base", async () => {
    const { executor, readPullRequest, upsertResponse } = executorWithPermissions({
      pull_requests: "read",
      actions: "write",
    });

    await expect(
      executor.executeGitHubCommand(commandAction("/boardreadyops rerun"), {
        deliveryId: "delivery-1",
        eventType: "issue_comment",
        eventAction: "created",
      }),
    ).resolves.toEqual([
      {
        type: "release_run.enqueue",
        installation: { id: 123 },
        repository,
        pullRequestNumber: 7,
        ref: "feature/board",
        commitSha: "a".repeat(40),
        baseCommitSha: "b".repeat(40),
        triggerKind: "pr",
        pullRequestDraft: false,
        pullRequestFromFork: false,
      },
    ]);
    expect(readPullRequest).toHaveBeenCalledWith({ owner: "octo", repo: "board", pullRequestNumber: 7 });
    expect(upsertResponse).not.toHaveBeenCalled();
  });

  it("preserves draft and fork safe-mode restrictions on slash-command reruns", async () => {
    const { executor } = executorWithPermissions(
      { pull_requests: "read", actions: "write" },
      {
        ...pullRequest,
        pullRequestDraft: true,
        pullRequestFromFork: true,
        safeMode: { enabled: true, reasons: ["draft-pull-request", "fork-pull-request"] },
      },
    );

    const actions = await executor.executeGitHubCommand(commandAction("/boardreadyops rerun"), {
      deliveryId: "delivery-safe",
      eventType: "issue_comment",
      eventAction: "created",
    });

    expect(actions[0]).toMatchObject({
      type: "release_run.enqueue",
      pullRequestDraft: true,
      pullRequestFromFork: true,
      safeMode: { enabled: true, reasons: ["draft-pull-request", "fork-pull-request"] },
    });
  });

  it("explains missing setup permissions instead of attempting the setup action", async () => {
    const { executor, readPullRequest, upsertResponse } = executorWithPermissions({
      pull_requests: "read",
      issues: "write",
    });

    await expect(
      executor.executeGitHubCommand(commandAction("/boardreadyops setup"), {
        deliveryId: "delivery-2",
        eventType: "issue_comment",
        eventAction: "created",
      }),
    ).resolves.toEqual([]);
    expect(readPullRequest).not.toHaveBeenCalled();
    expect(upsertResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        commentId: 44,
        body: expect.stringContaining("Contents (write), Workflows (write), and Pull requests (write)"),
      }),
    );
  });

  it("denies mutating commands from non-collaborators before reading repository state", async () => {
    const { executor, readPullRequest, upsertResponse } = executorWithPermissions({
      contents: "write",
      workflows: "write",
      pull_requests: "write",
    });

    await expect(
      executor.executeGitHubCommand(commandAction("/boardreadyops setup", "CONTRIBUTOR"), {
        deliveryId: "delivery-3",
        eventType: "issue_comment",
        eventAction: "created",
      }),
    ).resolves.toEqual([]);
    expect(readPullRequest).not.toHaveBeenCalled();
    expect(upsertResponse).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining("requires write permissions") }),
    );
  });

  it("posts rendered read-only command output and returns no lifecycle actions", async () => {
    const { executor, upsertResponse } = executorWithPermissions({ pull_requests: "write" });

    await expect(
      executor.executeGitHubCommand(commandAction("/boardreadyops status", "NONE"), {
        deliveryId: "delivery-4",
        eventType: "issue_comment",
        eventAction: "created",
      }),
    ).resolves.toEqual([]);
    expect(upsertResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        commentId: 44,
        body: expect.stringContaining("Head Ref:** `feature/board` (`aaaaaaa`)"),
      }),
    );
  });

  it("returns a durable waiver action with the requesting actor and explicit reason", async () => {
    const { executor, readPullRequest, upsertResponse } = executorWithPermissions({
      contents: "write",
      pull_requests: "write",
    });

    await expect(
      executor.executeGitHubCommand(commandAction('/boardreadyops waive rule.test --reason "temporary"'), {
        deliveryId: "delivery-waive",
        eventType: "issue_comment",
        eventAction: "created",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        type: "waiver_pr.request",
        ruleId: "rule.test",
        reason: "temporary",
        requestedBy: "octocat",
      }),
    ]);
    expect(readPullRequest).toHaveBeenCalledOnce();
    expect(upsertResponse).not.toHaveBeenCalled();
  });

  it("fails closed with guidance when a waiver command omits the audit reason", async () => {
    const { executor, readPullRequest, upsertResponse } = executorWithPermissions({
      contents: "write",
      pull_requests: "write",
    });

    await expect(
      executor.executeGitHubCommand(commandAction("/boardreadyops waive rule.test"), {
        deliveryId: "delivery-waive-no-reason",
        eventType: "issue_comment",
        eventAction: "created",
      }),
    ).resolves.toEqual([]);
    expect(readPullRequest).not.toHaveBeenCalled();
    expect(upsertResponse).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringMatching(/--reason.*required/iu) }),
    );
  });

  it("preserves the requesting actor on authorized setup actions", async () => {
    const { executor } = executorWithPermissions({
      contents: "write",
      workflows: "write",
      pull_requests: "write",
    });

    await expect(
      executor.executeGitHubCommand(commandAction("/boardreadyops setup"), {
        deliveryId: "delivery-5",
        eventType: "issue_comment",
        eventAction: "created",
      }),
    ).resolves.toEqual([
      {
        type: "setup_pr.create",
        installation: { id: 123 },
        repository,
        requestedBy: "octocat",
      },
    ]);
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("GitHub command API helpers", () => {
  it("reads the current pull request head ref, head SHA, and base SHA", async () => {
    const request = vi.fn(async () =>
      jsonResponse({ head: { ref: "feature/board", sha: "a".repeat(40) }, base: { sha: "b".repeat(40) } }),
    );

    await expect(
      readGitHubPullRequestContext({
        apiBaseUrl: "https://github.test/api/v3",
        token: "token",
        owner: "octo",
        repo: "board",
        pullRequestNumber: 7,
        request,
      }),
    ).resolves.toEqual(pullRequest);
    expect(request).toHaveBeenCalledWith(
      "https://github.test/api/v3/repos/octo/board/pulls/7",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("derives draft and fork state from the GitHub pull request response", async () => {
    const request = vi.fn(async () =>
      jsonResponse({
        draft: true,
        head: {
          ref: "feature/board",
          sha: "a".repeat(40),
          repo: { full_name: "contributor/board", fork: true },
        },
        base: { sha: "b".repeat(40) },
      }),
    );

    await expect(
      readGitHubPullRequestContext({
        apiBaseUrl: "https://github.test/api/v3",
        token: "token",
        owner: "octo",
        repo: "board",
        pullRequestNumber: 7,
        request,
      }),
    ).resolves.toMatchObject({ pullRequestDraft: true, pullRequestFromFork: true });
  });

  it("updates an existing command response marker found on a later comments page", async () => {
    const unrelated = Array.from({ length: 100 }, (_, index) => ({ id: index + 1, body: `comment ${index}` }));
    const request = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(unrelated))
      .mockResolvedValueOnce(jsonResponse([{ id: 777, body: "old\n<!-- boardreadyops:command-response:44 -->" }]))
      .mockResolvedValueOnce(jsonResponse({ id: 777 }));

    await upsertGitHubCommandResponse({
      apiBaseUrl: "https://github.test/api/v3",
      token: "token",
      owner: "octo",
      repo: "board",
      pullRequestNumber: 7,
      commentId: 44,
      body: "new response",
      request,
    });

    expect(request).toHaveBeenNthCalledWith(
      2,
      "https://github.test/api/v3/repos/octo/board/issues/7/comments?per_page=100&page=2",
      expect.objectContaining({ method: "GET" }),
    );
    expect(request).toHaveBeenNthCalledWith(
      3,
      "https://github.test/api/v3/repos/octo/board/issues/comments/777",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ body: "new response\n\n<!-- boardreadyops:command-response:44 -->" }),
      }),
    );
  });
});
