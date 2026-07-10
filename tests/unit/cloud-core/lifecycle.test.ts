import { describe, expect, it } from "vitest";
import { normalizeGitHubAppWebhook } from "../../../packages/cloud-core/src/lifecycle.js";

const installation = {
  id: 12345,
  account: {
    login: "octo-org",
    type: "Organization",
  },
};

const repository = {
  id: 98765,
  name: "hardware-board",
  full_name: "octo-org/hardware-board",
  private: true,
  default_branch: "main",
  owner: {
    login: "octo-org",
  },
};

const publicRepository = {
  ...repository,
  private: false,
};

describe("GitHub App lifecycle normalization", () => {
  it("converts installation created events into installation and repository upserts", () => {
    const normalized = normalizeGitHubAppWebhook({
      event: "installation",
      delivery: "delivery-1",
      payload: {
        action: "created",
        installation,
        repositories: [repository],
      },
    });

    expect(normalized.accepted).toBe(true);
    expect(normalized.actions).toEqual([
      {
        type: "installation.upsert",
        installation: {
          id: 12345,
          accountLogin: "octo-org",
          accountType: "Organization",
        },
      },
      {
        type: "repository.upsert",
        installation: {
          id: 12345,
          accountLogin: "octo-org",
          accountType: "Organization",
        },
        repository: {
          id: 98765,
          owner: "octo-org",
          name: "hardware-board",
          fullName: "octo-org/hardware-board",
          private: true,
          defaultBranch: "main",
        },
      },
    ]);
  });

  it("converts repository add and remove events into repository actions", () => {
    const normalized = normalizeGitHubAppWebhook({
      event: "installation_repositories",
      delivery: "delivery-2",
      payload: {
        action: "added",
        installation,
        repositories_added: [repository],
        repositories_removed: [
          {
            ...repository,
            id: 87654,
            name: "old-board",
            full_name: "octo-org/old-board",
          },
        ],
      },
    });

    expect(normalized.accepted).toBe(true);
    expect(normalized.actions.map((action) => action.type)).toEqual(["repository.upsert", "repository.removed"]);
  });

  it("queues a safe-mode release run for private pull request opened events", () => {
    const normalized = normalizeGitHubAppWebhook({
      event: "pull_request",
      delivery: "delivery-3",
      payload: {
        action: "opened",
        installation,
        repository,
        pull_request: {
          number: 42,
          head: {
            ref: "feature/pcb-release",
            sha: "0123456789abcdef",
            repo: {
              full_name: "octo-org/hardware-board",
              fork: false,
            },
          },
        },
      },
    });

    expect(normalized.accepted).toBe(true);
    expect(normalized.actions).toEqual([
      {
        type: "installation.upsert",
        installation: {
          id: 12345,
          accountLogin: "octo-org",
          accountType: "Organization",
        },
      },
      {
        type: "repository.upsert",
        installation: {
          id: 12345,
          accountLogin: "octo-org",
          accountType: "Organization",
        },
        repository: {
          id: 98765,
          owner: "octo-org",
          name: "hardware-board",
          fullName: "octo-org/hardware-board",
          private: true,
          defaultBranch: "main",
        },
      },
      {
        type: "release_run.enqueue",
        installation: {
          id: 12345,
          accountLogin: "octo-org",
          accountType: "Organization",
        },
        repository: {
          id: 98765,
          owner: "octo-org",
          name: "hardware-board",
          fullName: "octo-org/hardware-board",
          private: true,
          defaultBranch: "main",
        },
        pullRequestNumber: 42,
        ref: "feature/pcb-release",
        commitSha: "0123456789abcdef",
        triggerKind: "pr",
        pullRequestDraft: false,
        pullRequestFromFork: false,
        safeMode: {
          enabled: true,
          reasons: ["private-repository"],
        },
      },
    ]);
  });

  it("annotates fork pull requests with safe mode", () => {
    const normalized = normalizeGitHubAppWebhook({
      event: "pull_request",
      delivery: "delivery-3b",
      payload: {
        action: "opened",
        installation,
        repository: publicRepository,
        pull_request: {
          number: 42,
          head: {
            ref: "feature/pcb-release",
            sha: "0123456789abcdef",
            repo: {
              full_name: "contributor/hardware-board",
              fork: true,
            },
          },
        },
      },
    });

    expect(normalized.accepted).toBe(true);
    expect(normalized.actions.at(-1)).toMatchObject({
      type: "release_run.enqueue",
      pullRequestDraft: false,
      pullRequestFromFork: true,
      safeMode: {
        enabled: true,
        reasons: ["fork-pull-request"],
      },
    });
  });

  it("orders draft, fork, and private safe-mode reasons deterministically", () => {
    const normalized = normalizeGitHubAppWebhook({
      event: "pull_request",
      delivery: "delivery-3c",
      payload: {
        action: "opened",
        installation,
        repository,
        pull_request: {
          number: 42,
          draft: true,
          head: {
            ref: "feature/pcb-release",
            sha: "0123456789abcdef",
            repo: {
              full_name: "contributor/hardware-board",
              fork: true,
            },
          },
        },
      },
    });

    expect(normalized.actions.at(-1)).toMatchObject({
      type: "release_run.enqueue",
      pullRequestDraft: true,
      pullRequestFromFork: true,
      safeMode: {
        enabled: true,
        reasons: ["draft-pull-request", "fork-pull-request", "private-repository"],
      },
    });
  });

  it("accepts ignored pull request actions without enqueueing work", () => {
    const normalized = normalizeGitHubAppWebhook({
      event: "pull_request",
      delivery: "delivery-4",
      payload: {
        action: "closed",
        installation,
        repository,
        pull_request: {
          number: 42,
          head: {
            ref: "feature/pcb-release",
            sha: "0123456789abcdef",
          },
        },
      },
    });

    expect(normalized.accepted).toBe(true);
    expect(normalized.actions).toEqual([]);
  });

  it("rejects malformed payloads as unsupported lifecycle events", () => {
    const normalized = normalizeGitHubAppWebhook({
      event: "pull_request",
      delivery: "delivery-5",
      payload: {
        action: "opened",
      },
    });

    expect(normalized.accepted).toBe(false);
    expect(normalized.reason).toMatch(/installation/iu);
  });
});
