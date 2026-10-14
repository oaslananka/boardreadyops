import { describe, expect, it, vi } from "vitest";
import {
  inspectProtectedBranchHead,
  inspectProtectedReleaseOperator,
} from "../../../apps/web/lib/github-protected-branch-evidence.js";

const sha = "a".repeat(40);
const repositoryId = 12345678;
const ownerId = 9876543;
const input = {
  apiBaseUrl: "https://api.github.com",
  token: "test-installation-token",
  owner: "octo-org",
  repository: "example",
  repositoryId,
  branch: "main",
  ref: "refs/heads/main",
  sha,
};

const repo = (id = repositoryId) => ({
  id,
  full_name: "octo-org/example",
  owner: { id: ownerId, login: "octo-org" },
  archived: false,
  disabled: false,
  private: false,
  default_branch: "main",
});
const branch = (commit = sha) => ({ name: "main", protected: true, commit: { sha: commit } });
const rules = [
  { type: "deletion", ruleset_id: 27 },
  { type: "non_fast_forward", ruleset_id: 27 },
  { type: "pull_request", ruleset_id: 27, parameters: { required_review_thread_resolution: true } },
  {
    type: "required_status_checks",
    ruleset_id: 27,
    parameters: {
      strict_required_status_checks_policy: true,
      required_status_checks: [{ context: "ci / test-unit" }],
    },
  },
];

function api(
  options: {
    first?: unknown;
    second?: unknown;
    firstRepo?: unknown;
    secondRepo?: unknown;
    activeRules?: unknown;
    branchStatus?: number;
    repositoryStatus?: number;
    ruleStatus?: number;
  } = {},
) {
  const first = options.first ?? branch();
  const second = options.second ?? branch();
  const activeRules = options.activeRules ?? rules;
  let branchReads = 0;
  let repositoryReads = 0;
  return vi.fn(async (url: string) => {
    if (url.endsWith("/repos/octo-org/example")) {
      return new Response(
        JSON.stringify(++repositoryReads === 1 ? (options.firstRepo ?? repo()) : (options.secondRepo ?? repo())),
        {
          status: options.repositoryStatus ?? 200,
        },
      );
    }
    if (url.endsWith("/rules/branches/main")) {
      return new Response(JSON.stringify(activeRules), { status: options.ruleStatus ?? 200 });
    }
    if (url.endsWith("/branches/main")) {
      return new Response(JSON.stringify(++branchReads === 1 ? first : second), {
        status: options.branchStatus ?? 200,
      });
    }
    throw new Error("unexpected endpoint");
  });
}

describe("protected branch evidence (not release authorization)", () => {
  it("reads effective active rules and double-checks an exact protected branch HEAD", async () => {
    const request = api();
    await expect(inspectProtectedBranchHead({ ...input, request })).resolves.toEqual({
      ref: "refs/heads/main",
      sha,
      source: "github-active-branch-rules",
      githubOwnerId: ownerId,
      requiredRuleTypes: ["pull_request", "required_status_checks"],
    });
    expect(request).toHaveBeenCalledTimes(5);
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      "https://api.github.com/repos/octo-org/example",
      "https://api.github.com/repos/octo-org/example/branches/main",
      "https://api.github.com/repos/octo-org/example/rules/branches/main",
      "https://api.github.com/repos/octo-org/example/branches/main",
      "https://api.github.com/repos/octo-org/example",
    ]);
  });

  it.each([
    ["different repo ID", { firstRepo: repo(repositoryId + 1) }],
    ["repo changed mid-verification", { secondRepo: repo(repositoryId + 1) }],
    ["missing owner identity", { firstRepo: { ...repo(), owner: undefined } }],
    ["malformed owner ID", { firstRepo: { ...repo(), owner: { id: "9876543", login: "octo-org" } } }],
    ["invalid owner ID", { firstRepo: { ...repo(), owner: { id: 0, login: "octo-org" } } }],
    ["wrong owner login", { firstRepo: { ...repo(), owner: { id: ownerId, login: "other-org" } } }],
    [
      "owner transferred during verification",
      { secondRepo: { ...repo(), owner: { id: ownerId + 1, login: "octo-org" } } },
    ],

    ["archived repository", { firstRepo: { ...repo(), archived: true } }],
    ["disabled repository", { firstRepo: { ...repo(), disabled: true } }],
    ["private repository", { firstRepo: { ...repo(), private: true } }],
    ["repository turned private during verification", { secondRepo: { ...repo(), private: true } }],
    ["default branch changed", { firstRepo: { ...repo(), default_branch: "other" } }],
    ["default branch changed mid-verification", { secondRepo: { ...repo(), default_branch: "other" } }],
    ["renamed repository", { firstRepo: { ...repo(), full_name: "octo-org/replaced" } }],
    ["unreadable repository", { repositoryStatus: 403 }],
    ["different head", { first: branch("b".repeat(40)) }],
    ["head changed during lookup", { second: branch("b".repeat(40)) }],
    ["unprotected branch", { first: { ...branch(), protected: false } }],
    ["missing review rule", { activeRules: rules.filter((rule) => rule.type !== "pull_request") }],
    ["missing required checks", { activeRules: rules.filter((rule) => rule.type !== "required_status_checks") }],
    [
      "insufficient review policy",
      { activeRules: [{ type: "pull_request", parameters: { required_review_thread_resolution: false } }, rules[3]] },
    ],
    [
      "non-strict status checks",
      {
        activeRules: [
          rules[2],
          {
            type: "required_status_checks",
            parameters: {
              required_status_checks: [{ context: "ci / test-unit" }],
              strict_required_status_checks_policy: false,
            },
          },
        ],
      },
    ],
    ["non-array active rules", { activeRules: { rules } }],
    ["denied repository access", { branchStatus: 403 }],
    ["denied rules access", { ruleStatus: 403 }],
  ])("fails closed for %s", async (_name, overrides) => {
    await expect(inspectProtectedBranchHead({ ...input, request: api(overrides) })).resolves.toBeUndefined();
  });

  it.each([
    "../main",
    "refs/heads/main/../untrusted",
    "refs/tags/main",
    "refs/heads/main?owner=other",
    "refs/heads/feature",
  ])("rejects invalid or non-target ref %s without making requests", async (ref) => {
    const request = api();
    await expect(inspectProtectedBranchHead({ ...input, ref, request })).resolves.toBeUndefined();
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects an invalid repository locator or commit SHA before a network request", async () => {
    const request = api();
    await expect(inspectProtectedBranchHead({ ...input, owner: "../another", request })).resolves.toBeUndefined();
    await expect(inspectProtectedBranchHead({ ...input, sha: "f".repeat(39), request })).resolves.toBeUndefined();
    await expect(inspectProtectedBranchHead({ ...input, repositoryId: -1, request })).resolves.toBeUndefined();
    expect(request).not.toHaveBeenCalled();
  });

  it("does not send the installation token to non-GitHub API origins", async () => {
    const request = api();
    await expect(
      inspectProtectedBranchHead({ ...input, apiBaseUrl: "https://example.org", request }),
    ).resolves.toBeUndefined();
    await expect(
      inspectProtectedBranchHead({ ...input, apiBaseUrl: "https://api.github.com.evil.test", request }),
    ).resolves.toBeUndefined();
    expect(request).not.toHaveBeenCalled();
  });

  it("fails closed on network exceptions", async () => {
    const request = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(inspectProtectedBranchHead({ ...input, request })).resolves.toBeUndefined();
  });
});

describe("repository administrator evidence (not release authorization)", () => {
  const actorGithubUserId = 825312;
  const operator = { ...input, actorLogin: "octocat", actorGithubUserId };

  function permissionResponse(
    body: unknown = { permission: "admin", role_name: "admin", user: { id: actorGithubUserId, login: "octocat" } },
    status = 200,
  ) {
    return vi.fn(async () => new Response(JSON.stringify(body), { status }));
  }

  it("accepts a GitHub-verified admin login and numeric actor ID", async () => {
    const request = permissionResponse();
    await expect(inspectProtectedReleaseOperator({ ...operator, request })).resolves.toEqual({
      source: "github-repository-admin",
      actorGithubUserId,
    });
    expect(request).toHaveBeenCalledWith(
      "https://api.github.com/repos/octo-org/example/collaborators/octocat/permission",
      expect.objectContaining({ method: "GET", redirect: "error" }),
    );
  });

  it.each([
    ["write role", { permission: "write", user: { id: actorGithubUserId, login: "octocat" } }],
    [
      "custom non-admin role",
      { permission: "write", role_name: "custom", user: { id: actorGithubUserId, login: "octocat" } },
    ],
    ["different GitHub ID", { permission: "admin", user: { id: 123, login: "octocat" } }],
    ["different username", { permission: "admin", user: { id: actorGithubUserId, login: "other" } }],
    ["malformed response", { permission: "admin" }],
  ])("rejects %s", async (_case, body) => {
    await expect(
      inspectProtectedReleaseOperator({ ...operator, request: permissionResponse(body) }),
    ).resolves.toBeUndefined();
  });

  it.each([403, 404, 500])("fails closed for HTTP %d", async (status) => {
    await expect(
      inspectProtectedReleaseOperator({ ...operator, request: permissionResponse({}, status) }),
    ).resolves.toBeUndefined();
  });

  it("does not call GitHub for invalid actor identity or API origin", async () => {
    const request = permissionResponse();
    await expect(
      inspectProtectedReleaseOperator({ ...operator, actorLogin: "../other", request }),
    ).resolves.toBeUndefined();
    await expect(
      inspectProtectedReleaseOperator({ ...operator, actorGithubUserId: 0, request }),
    ).resolves.toBeUndefined();
    await expect(
      inspectProtectedReleaseOperator({ ...operator, apiBaseUrl: "https://evil.example", request }),
    ).resolves.toBeUndefined();
    expect(request).not.toHaveBeenCalled();
  });

  it("fails closed on network exceptions", async () => {
    const request = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(inspectProtectedReleaseOperator({ ...operator, request })).resolves.toBeUndefined();
  });
});
