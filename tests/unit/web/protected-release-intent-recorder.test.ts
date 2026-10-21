import { describe, expect, it, vi } from "vitest";
import { recordProtectedReleaseIntentForViewer } from "../../../apps/web/lib/protected-release-intent-recorder.js";
import type { UserSession } from "../../../apps/web/lib/user-session.js";

const now = new Date("2026-10-13T08:00:00.000Z");
const sha = "a".repeat(40);
const session: UserSession = {
  userId: 701,
  login: "maintainer",
  installationIds: [501],
  issuedAt: "2026-10-13T07:00:00.000Z",
  expiresAt: "2026-10-13T09:00:00.000Z",
};
const repositoryRow = {
  repository_id: "repo-internal",
  installation_id: "install-internal",
  github_repo_id: "601",
  github_installation_id: "501",
  owner: "org",
  name: "board",
  default_branch: "main",
  repository_private: false,
};

function setup(
  overrides: {
    actorPermission?: string;
    actorId?: number;
    githubRepositoryId?: number;
    row?: Record<string, unknown> | null;
  } = {},
) {
  const queries: Array<{ sql: string; params: readonly unknown[] }> = [];
  const db = {
    async query(sql: string, params: readonly unknown[] = []) {
      queries.push({ sql, params });
      if (sql.includes("boardreadyops_record_protected_release_intent_candidate")) {
        return { rows: [{ candidate_id: "saved-candidate", inserted: true }] };
      }
      return { rows: overrides.row === null ? [] : [overrides.row ?? repositoryRow] };
    },
  };
  const githubRequest = vi.fn(async (url: string) => {
    if (url.endsWith("/collaborators/maintainer/permission")) {
      return Response.json({
        permission: overrides.actorPermission ?? "admin",
        user: {
          id: overrides.actorId ?? 701,
          login: "maintainer",
        },
      });
    }
    if (url.endsWith("/rules/branches/main"))
      return Response.json([
        { type: "pull_request", parameters: { required_review_thread_resolution: true } },
        {
          type: "required_status_checks",
          parameters: {
            strict_required_status_checks_policy: true,
            required_status_checks: [{ context: "CI" }],
          },
        },
      ]);
    if (url.endsWith("/branches/main"))
      return Response.json({
        name: "main",
        protected: true,
        commit: { sha },
      });
    if (url.endsWith("/repos/org/board"))
      return Response.json({
        id: overrides.githubRepositoryId ?? 601,
        full_name: "org/board",
        owner: { id: 901, login: "org" },
        default_branch: "main",
        archived: false,
        disabled: false,
        private: false,
      });
    throw new Error("unexpected URL");
  });
  const installationToken = vi.fn(async () => "install-token");
  const dependencies = { db, installationToken, githubRequest, now: () => now };
  return { queries, githubRequest, installationToken, dependencies };
}

const input = { session, repositoryId: "repo-internal", sha, requestId: "explicit-12345" };

describe("server-only protected branch intent evidence recorder", () => {
  it("rechecks repository and GitHub permissions before a single evidence-only transaction", async () => {
    const fixture = setup();
    await expect(recordProtectedReleaseIntentForViewer(input, fixture.dependencies)).resolves.toEqual({
      id: "saved-candidate",
      inserted: true,
    });
    expect(fixture.installationToken).toHaveBeenCalledWith(501);
    expect(fixture.githubRequest).toHaveBeenCalledTimes(6);
    expect(fixture.queries).toHaveLength(2);
    expect(fixture.queries[0]?.sql).toContain("repositories.disabled_at is null");
    expect(fixture.queries[0]?.sql).toContain("repositories.private = false");
    expect(fixture.queries[0]?.sql).toContain("installations.suspended_at is null");
    expect(fixture.queries[1]?.sql).toContain("boardreadyops_record_protected_release_intent_candidate");
    expect(fixture.queries[1]?.params.slice(0, 5)).toEqual(["install-internal", "repo-internal", 501, 601, 901]);
    expect(fixture.queries.map((q) => q.sql).join(" ")).not.toContain("control_plane_outbox");
  });

  it.each([
    ["expired session", { ...session, expiresAt: "2026-10-13T07:59:00.000Z" }],
    ["invalid expiration timestamp", { ...session, expiresAt: "not-a-date" }],
    ["invalid issuance timestamp", { ...session, issuedAt: "not-a-date" }],
    ["future-issued session", { ...session, issuedAt: "2026-10-13T08:01:00.000Z" }],
    ["no installation access", { ...session, installationIds: [502] }],
    ["missing GitHub actor ID", { ...session, userId: 0 }],
  ])("rejects %s without minting installation credentials", async (_name, badSession) => {
    const fixture = setup();
    await expect(
      recordProtectedReleaseIntentForViewer({ ...input, session: badSession }, fixture.dependencies),
    ).resolves.toBeUndefined();
    expect(fixture.installationToken).not.toHaveBeenCalled();
    expect(fixture.queries.filter((q) => q.sql.includes("record_protected_release"))).toHaveLength(0);
  });

  it.each([
    ["unavailable repository", { row: null }],
    ["different installation", { row: { ...repositoryRow, github_installation_id: "999" } }],
    ["private repository", { row: { ...repositoryRow, repository_private: true } }],
    ["wrong repository ID", { githubRepositoryId: 999 }],
    ["non-admin operator", { actorPermission: "write" }],
    ["different signed identity", { actorId: 999 }],
  ])("refuses to record when %s", async (_name, override) => {
    const fixture = setup(override);
    await expect(recordProtectedReleaseIntentForViewer(input, fixture.dependencies)).resolves.toBeUndefined();
    expect(fixture.queries.filter((q) => q.sql.includes("record_protected_release"))).toHaveLength(0);
  });
});
