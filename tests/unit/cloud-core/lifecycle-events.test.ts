import { describe, expect, it } from "vitest";
import { normalizeGitHubAppWebhook } from "../../../packages/cloud-core/src/lifecycle.js";

const repository = {
  id: 101,
  owner: { login: "octo-org" },
  name: "hardware-board",
  full_name: "octo-org/hardware-board",
  private: false,
  default_branch: "main",
};

const installation = {
  id: 202,
  account: { login: "octo-org", type: "Organization" },
};

describe("lifecycle issue_comment event normalization", () => {
  it("ignores issue comments that are not on pull requests", () => {
    const res = normalizeGitHubAppWebhook({
      event: "issue_comment",
      delivery: "del-1",
      payload: {
        action: "created",
        repository,
        installation,
        issue: { number: 5 }, // No pull_request key
        comment: {
          id: 501,
          body: "/boardreadyops status",
          user: { login: "reviewer1" },
          author_association: "COLLABORATOR",
        },
      },
    });

    expect(res.accepted).toBe(true);
    expect(res.actions).toEqual([]);
  });

  it("ignores pull request comments that do not contain a /boardreadyops command", () => {
    const res = normalizeGitHubAppWebhook({
      event: "issue_comment",
      delivery: "del-2",
      payload: {
        action: "created",
        repository,
        installation,
        issue: { number: 42, pull_request: { url: "https://api.github.com/..." } },
        comment: {
          id: 502,
          body: "LGTM!",
          user: { login: "reviewer1" },
          author_association: "COLLABORATOR",
        },
      },
    });

    expect(res.accepted).toBe(true);
    expect(res.actions).toEqual([]);
  });

  it("ignores BoardReadyOps bot comments so command responses cannot recurse", () => {
    const res = normalizeGitHubAppWebhook({
      event: "issue_comment",
      delivery: "del-bot",
      payload: {
        action: "created",
        repository,
        installation,
        issue: { number: 42, pull_request: { url: "https://api.github.com/..." } },
        comment: {
          id: 599,
          body: "/boardreadyops rerun",
          user: { login: "boardreadyops[bot]", type: "Bot" },
          author_association: "CONTRIBUTOR",
        },
      },
    });

    expect(res.accepted).toBe(true);
    expect(res.actions).toEqual([]);
  });

  it("emits github_command.execute for pull request comments containing /boardreadyops command", () => {
    const res = normalizeGitHubAppWebhook({
      event: "issue_comment",
      delivery: "del-3",
      payload: {
        action: "created",
        repository,
        installation,
        issue: { number: 42, pull_request: { url: "https://api.github.com/..." } },
        comment: {
          id: 503,
          body: "/boardreadyops rerun",
          user: { login: "maintainer1" },
          author_association: "MEMBER",
        },
      },
    });

    expect(res.accepted).toBe(true);
    expect(res.actions).toHaveLength(1);
    expect(res.actions[0]).toEqual({
      type: "github_command.execute",
      installation: { id: 202, accountLogin: "octo-org", accountType: "Organization" },
      repository: {
        id: 101,
        owner: "octo-org",
        name: "hardware-board",
        fullName: "octo-org/hardware-board",
        private: false,
        defaultBranch: "main",
      },
      pullRequestNumber: 42,
      commentId: 503,
      commentBody: "/boardreadyops rerun",
      commentAuthor: "maintainer1",
      authorAssociation: "MEMBER",
    });
  });
});

describe("lifecycle pull_request_review event normalization", () => {
  it("emits pull_request_review.submitted when review is submitted", () => {
    const res = normalizeGitHubAppWebhook({
      event: "pull_request_review",
      delivery: "del-4",
      payload: {
        action: "submitted",
        repository,
        installation,
        pull_request: { number: 42 },
        review: {
          id: 601,
          state: "approved",
          user: { login: "lead-ee" },
        },
      },
    });

    expect(res.accepted).toBe(true);
    expect(res.actions).toHaveLength(1);
    expect(res.actions[0]).toEqual({
      type: "pull_request_review.submitted",
      installation: { id: 202, accountLogin: "octo-org", accountType: "Organization" },
      repository: {
        id: 101,
        owner: "octo-org",
        name: "hardware-board",
        fullName: "octo-org/hardware-board",
        private: false,
        defaultBranch: "main",
      },
      pullRequestNumber: 42,
      reviewId: 601,
      state: "approved",
      reviewer: "lead-ee",
    });
  });

  it("ignores non-submitted review events", () => {
    const res = normalizeGitHubAppWebhook({
      event: "pull_request_review",
      delivery: "del-5",
      payload: {
        action: "edited",
        repository,
        installation,
        pull_request: { number: 42 },
        review: { id: 601, state: "commented", user: { login: "lead-ee" } },
      },
    });

    expect(res.accepted).toBe(true);
    expect(res.actions).toEqual([]);
  });
});

describe("lifecycle workflow_run event normalization", () => {
  it("emits workflow_run.progress when workflow run completes", () => {
    const res = normalizeGitHubAppWebhook({
      event: "workflow_run",
      delivery: "del-6",
      payload: {
        action: "completed",
        repository,
        installation,
        workflow_run: {
          id: 701,
          name: "Hardware Readiness Runner",
          status: "completed",
          conclusion: "success",
        },
      },
    });

    expect(res.accepted).toBe(true);
    expect(res.actions).toHaveLength(1);
    expect(res.actions[0]).toEqual({
      type: "workflow_run.progress",
      installation: { id: 202, accountLogin: "octo-org", accountType: "Organization" },
      repository: {
        id: 101,
        owner: "octo-org",
        name: "hardware-board",
        fullName: "octo-org/hardware-board",
        private: false,
        defaultBranch: "main",
      },
      workflowRunId: 701,
      workflowName: "Hardware Readiness Runner",
      status: "completed",
      conclusion: "success",
    });
  });
});
