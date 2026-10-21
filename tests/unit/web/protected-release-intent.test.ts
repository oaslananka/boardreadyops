import { describe, expect, it, vi } from "vitest";
import {
  inspectProtectedReleaseIntentCandidate,
  type ProtectedReleaseRequestInput,
} from "../../../apps/web/lib/protected-release-intent.js";

const sha = "a".repeat(40);
const base: Omit<ProtectedReleaseRequestInput, "request"> = {
  actor: { authType: "session", login: "maintainer", githubUserId: 345, installationIds: [567] },
  repository: {
    repositoryId: "repo-123",
    githubRepositoryId: 456,
    installationId: 567,
    owner: "example-org",
    name: "board",
    defaultBranch: "main",
  },
  intent: { kind: "protected-branch", ref: "refs/heads/main", sha, requestId: "request-12345" },
  installation: { id: 567, token: "installation-test-token" },
  apiBaseUrl: "https://api.github.com",
};

function github(role = "admin", head = sha) {
  return vi.fn(async (url: string) => {
    if (url.endsWith("/collaborators/maintainer/permission")) {
      return Response.json({ permission: role, user: { id: 345, login: "maintainer" } });
    }
    if (url.endsWith("/rules/branches/main")) {
      return Response.json([
        { type: "pull_request", parameters: { required_review_thread_resolution: true } },
        {
          type: "required_status_checks",
          parameters: {
            strict_required_status_checks_policy: true,
            required_status_checks: [{ context: "ci / test-unit" }],
          },
        },
      ]);
    }
    if (url.endsWith("/branches/main")) return Response.json({ name: "main", protected: true, commit: { sha: head } });
    if (url.endsWith("/repos/example-org/board")) {
      return Response.json({
        id: 456,
        full_name: "example-org/board",
        owner: { id: 901, login: "example-org" },
        default_branch: "main",
        archived: false,
        disabled: false,
        private: false,
      });
    }
    throw new Error("unexpected endpoint");
  });
}

describe("non-authorizing protected-release intent evidence", () => {
  it("binds operator, installation, repository, branch, SHA and idempotency ID", async () => {
    const request = github();
    const result = await inspectProtectedReleaseIntentCandidate({ ...base, request });
    expect(result).toMatchObject({
      version: 2,
      githubOwnerId: 901,
      kind: "protected-branch",
      installationId: 567,
      repositoryId: "repo-123",
      githubRepositoryId: 456,
      actorGithubUserId: 345,
      ref: "refs/heads/main",
      sha,
      requestId: "request-12345",
    });
    expect(result?.digest).toMatch(/^[0-9a-f]{64}$/u);
    expect(request).toHaveBeenCalledTimes(6);
  });

  it.each([
    ["bearer token", { actor: { ...base.actor, authType: "bearer_token" as const } }],
    ["foreign installation", { actor: { ...base.actor, installationIds: [999] } }],
    ["no actor ID", { actor: { ...base.actor, githubUserId: undefined } }],
    ["installation mismatch", { installation: { ...base.installation, id: 999 } }],
    ["repository identity missing", { repository: { ...base.repository, githubRepositoryId: 0 } }],
    ["PR code ref", { intent: { ...base.intent, ref: "refs/pull/5/merge" } }],
    ["wrong branch", { intent: { ...base.intent, ref: "refs/heads/develop" } }],
    ["invalid SHA", { intent: { ...base.intent, sha: "not-a-sha" } }],
    ["invalid request ID", { intent: { ...base.intent, requestId: "bad" } }],
  ])("rejects %s before any GitHub API call", async (_name, patch) => {
    const request = github();
    await expect(inspectProtectedReleaseIntentCandidate({ ...base, ...patch, request })).resolves.toBeUndefined();
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects non-admin operators and moving branches", async () => {
    await expect(
      inspectProtectedReleaseIntentCandidate({ ...base, request: github("write") }),
    ).resolves.toBeUndefined();
    await expect(
      inspectProtectedReleaseIntentCandidate({ ...base, request: github("admin", "b".repeat(40)) }),
    ).resolves.toBeUndefined();
  });
});
