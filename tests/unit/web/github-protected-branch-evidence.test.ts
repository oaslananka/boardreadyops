import { describe, expect, it, vi } from "vitest";
import { inspectProtectedBranchHead } from "../../../apps/web/lib/github-protected-branch-evidence.js";

const sha = "a".repeat(40);
const input = {
  apiBaseUrl: "https://api.github.com",
  token: "test-installation-token",
  owner: "octo-org",
  repository: "example",
  branch: "main",
  ref: "refs/heads/main",
  sha,
};

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
    activeRules?: unknown;
    branchStatus?: number;
    ruleStatus?: number;
  } = {},
) {
  const first = options.first ?? branch();
  const second = options.second ?? branch();
  const activeRules = options.activeRules ?? rules;
  let branchReads = 0;
  return vi.fn(async (url: string) => {
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
      requiredRuleTypes: ["pull_request", "required_status_checks"],
    });
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      "https://api.github.com/repos/octo-org/example/branches/main",
      "https://api.github.com/repos/octo-org/example/rules/branches/main",
      "https://api.github.com/repos/octo-org/example/branches/main",
    ]);
  });

  it.each([
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
