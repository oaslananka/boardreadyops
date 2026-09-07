import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as createDelivery, GET as getDeliveries } from "../../../apps/web/app/api/v2/deliveries/route.js";
import { POST as createProject, GET as getProjects } from "../../../apps/web/app/api/v2/projects/route.js";
import { POST as createRevision } from "../../../apps/web/app/api/v2/revisions/upload/route.js";
import { POST as createWorkspace, GET as getWorkspaces } from "../../../apps/web/app/api/v2/workspaces/route.js";
import * as apiAuth from "../../../apps/web/lib/api-auth.js";
import * as cloudConfig from "../../../apps/web/lib/cloud-runtime-config.js";

const mockQuery = vi.fn();
const mockClose = vi.fn();
const mockMembershipQuery = vi.fn();
const mockProjectQuery = vi.fn();
const mockRevisionWorkspaceQuery = vi.fn();

/**
 * The authorization lookups are routed to their own mocks so `mockQuery` keeps carrying only the
 * store calls each test is about, and its positional `mockResolvedValueOnce` chains stay readable.
 *
 * The membership branch used to match `from workspace_memberships` and never fired: no route
 * queried it, because migration 0063's table of that name was never created (0052 owned the name
 * already). The mock made the suite look like it covered tenant scoping while the routes had
 * none. It now matches `workspace_members`, the table 0064 adds, which the routes really read.
 */
vi.mock("../../../packages/db/src/pg-executor.js", () => ({
  createPgQueryExecutor: vi.fn(() => ({
    query: (sql: string, params: readonly unknown[]) => {
      if (sql.includes("from workspace_members")) return mockMembershipQuery(sql, params);
      if (sql.includes("from revisions") && sql.includes("join projects")) {
        return mockRevisionWorkspaceQuery(sql, params);
      }
      if (sql.includes("from projects") && sql.includes("where id = $1")) return mockProjectQuery(sql, params);
      return mockQuery(sql, params);
    },
    close: mockClose,
  })),
}));

describe("API v2 Routes", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockClose.mockReset();
    mockMembershipQuery.mockReset().mockResolvedValue({ rows: [{ role: "owner" }] });
    mockRevisionWorkspaceQuery.mockReset().mockResolvedValue({ rows: [{ workspace_id: "ws_123" }] });
    mockProjectQuery.mockReset().mockResolvedValue({
      rows: [
        {
          id: "prj_001",
          workspace_id: "ws_123",
          name: "Board",
          description: null,
          default_cad_format: "kicad",
          github_repo_full_name: null,
          created_at: new Date(),
        },
      ],
    });
    vi.spyOn(cloudConfig, "resolveCloudPersistenceConfiguration").mockReturnValue({
      mode: "postgres",
      databaseUrl: "postgresql://postgres:postgres@localhost:5432/boardreadyops",
    });
    vi.spyOn(apiAuth, "authenticateApiRequest").mockResolvedValue({
      ok: true,
      actorId: "user-1",
      scopes: ["admin", "runs:write", "reviews:read", "reviews:write"],
      authType: "session",
    });
  });

  describe("workspaces", () => {
    it("rejects client-selected paid entitlements", async () => {
      const response = await createWorkspace(
        new Request("https://boardreadyops.test/api/v2/workspaces", {
          method: "POST",
          headers: { origin: "https://boardreadyops.test", "content-type": "application/json" },
          body: JSON.stringify({ name: "Paid", slug: "paid", planTier: "business" }),
        }),
      );
      expect(response.status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });
    it("creates workspace and checks slug collision", async () => {
      // First call checks slug (empty), second call inserts
      mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
        rows: [
          {
            id: "ws_123",
            name: "Alpha Corp",
            slug: "alpha-corp",
            plan_tier: "community",
            stripe_customer_id: null,
            created_at: new Date().toISOString(),
          },
        ],
      });

      const req = new Request("https://boardreadyops.test/api/v2/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://boardreadyops.test" },
        body: JSON.stringify({
          name: "Alpha Corp",
          slug: "alpha-corp",
          planTier: "community",
        }),
      });

      const res = await createWorkspace(req);
      expect(res.status).toBe(201);
      const data = (await res.json()) as { ok: boolean; workspace: { id: string; slug: string } };
      expect(data.ok).toBe(true);
      expect(data.workspace.id).toBe("ws_123");
      expect(data.workspace.slug).toBe("alpha-corp");
    });

    it("rejects duplicate slug with 409", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { id: "ws_existing", name: "Existing", slug: "alpha-corp", plan_tier: "community", created_at: new Date() },
        ],
      });

      const req = new Request("https://boardreadyops.test/api/v2/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://boardreadyops.test" },
        body: JSON.stringify({
          name: "Alpha Corp",
          slug: "alpha-corp",
        }),
      });

      const res = await createWorkspace(req);
      expect(res.status).toBe(409);
    });

    it("retrieves workspace by slug", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "ws_456",
            name: "Beta Labs",
            slug: "beta-labs",
            plan_tier: "community",
            stripe_customer_id: null,
            created_at: new Date().toISOString(),
          },
        ],
      });

      const req = new Request("https://boardreadyops.test/api/v2/workspaces?slug=beta-labs");
      const res = await getWorkspaces(req);
      expect(res.status).toBe(200);
      const data = (await res.json()) as { ok: boolean; workspace: { slug: string } };
      expect(data.workspace.slug).toBe("beta-labs");
    });
  });

  describe("projects", () => {
    it("creates project under existing workspace", async () => {
      // Membership answers the "may they?" question (its own mock), so the only store call left
      // here is the insert. The route no longer loads the workspace first: a caller who is not a
      // member must not learn whether the id exists.
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "prj_001",
            workspace_id: "ws_123",
            name: "Power Module",
            description: "High voltage regulator",
            default_cad_format: "altium",
            github_repo_full_name: null,
            created_at: new Date().toISOString(),
          },
        ],
      });

      const req = new Request("https://boardreadyops.test/api/v2/projects", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://boardreadyops.test" },
        body: JSON.stringify({
          workspaceId: "ws_123",
          name: "Power Module",
          description: "High voltage regulator",
          defaultCadFormat: "altium",
        }),
      });

      const res = await createProject(req);
      expect(res.status).toBe(201);
      const data = (await res.json()) as { ok: boolean; project: { id: string; defaultCadFormat: string } };
      expect(data.project.id).toBe("prj_001");
      expect(data.project.defaultCadFormat).toBe("altium");
    });

    it("lists projects for workspace", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "prj_001",
            workspace_id: "ws_123",
            name: "Power Module",
            description: null,
            default_cad_format: "kicad",
            github_repo_full_name: null,
            created_at: new Date().toISOString(),
          },
        ],
      });

      const req = new Request("https://boardreadyops.test/api/v2/projects?workspaceId=ws_123");
      const res = await getProjects(req);
      expect(res.status).toBe(200);
      const data = (await res.json()) as { ok: boolean; projects: Array<{ id: string }> };
      expect(data.projects).toHaveLength(1);
    });
  });

  describe("revisions/upload", () => {
    it("creates revision with valid sha256 and summary", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "rev_001",
            project_id: "prj_001",
            revision_label: "v1.2",
            source_kind: "direct_upload",
            commit_sha: null,
            bundle_sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            normalized_summary: { layerCount: 4 },
            created_at: new Date().toISOString(),
          },
        ],
      });

      const req = new Request("https://boardreadyops.test/api/v2/revisions/upload", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://boardreadyops.test" },
        body: JSON.stringify({
          projectId: "prj_001",
          revisionLabel: "v1.2",
          bundleSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          normalizedSummary: { layerCount: 4 },
        }),
      });

      const res = await createRevision(req);
      expect(res.status).toBe(201);
      const data = (await res.json()) as { ok: boolean; revision: { id: string; revisionLabel: string } };
      expect(data.revision.id).toBe("rev_001");
      expect(data.revision.revisionLabel).toBe("v1.2");
    });

    it("rejects invalid bundleSha256 with 400", async () => {
      const req = new Request("https://boardreadyops.test/api/v2/revisions/upload", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://boardreadyops.test" },
        body: JSON.stringify({
          projectId: "prj_001",
          revisionLabel: "v1.2",
          bundleSha256: "invalid-short-hash",
        }),
      });

      const res = await createRevision(req);
      expect(res.status).toBe(400);
    });
  });

  describe("deliveries", () => {
    it("creates delivery link and returns rawToken", async () => {
      // First check revision exists, second insert delivery
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: "rev_001",
              project_id: "prj_001",
              revision_label: "v1.2",
              source_kind: "direct_upload",
              commit_sha: null,
              bundle_sha256: "a".repeat(64),
              normalized_summary: {},
              created_at: new Date(),
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: "del_001",
              revision_id: "rev_001",
              access_token_hash: "hash",
              expires_at: new Date(Date.now() + 86400 * 1000).toISOString(),
              signed_archive_url: "https://storage.example.com/bundle.zip",
              recipient_notes: "Fab notes",
              created_at: new Date().toISOString(),
            },
          ],
        });

      const req = new Request("https://boardreadyops.test/api/v2/deliveries", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://boardreadyops.test" },
        body: JSON.stringify({
          revisionId: "rev_001",
          signedArchiveUrl: "https://storage.example.com/bundle.zip",
          recipientNotes: "Fab notes",
        }),
      });

      const res = await createDelivery(req);
      expect(res.status).toBe(201);
      const data = (await res.json()) as { ok: boolean; rawToken: string; delivery: { id: string } };
      expect(data.ok).toBe(true);
      expect(data.rawToken).toBeDefined();
      expect(data.delivery.id).toBe("del_001");
    });

    it("retrieves delivery by token", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "del_001",
            revision_id: "rev_001",
            access_token_hash: "hash",
            expires_at: new Date(Date.now() + 86400 * 1000).toISOString(),
            signed_archive_url: "https://storage.example.com/bundle.zip",
            recipient_notes: null,
            created_at: new Date().toISOString(),
          },
        ],
      });

      const req = new Request("https://boardreadyops.test/api/v2/deliveries?token=raw_token_xyz");
      const res = await getDeliveries(req);
      expect(res.status).toBe(200);
      const data = (await res.json()) as { ok: boolean; delivery: { id: string } };
      expect(data.delivery.id).toBe("del_001");
    });
  });
  /**
   * Every v2 route reached the store straight from `authenticateApiRequest`, which proves who is
   * calling and never what they may reach. Verified against a real database before this was
   * written: one tenant's API token read another tenant's workspace and projects, wrote a project
   * into it, and minted a public guest delivery link for its revision — all 200/201.
   */
  describe("workspace authorization", () => {
    function sessionAs(login: string) {
      vi.spyOn(apiAuth, "authenticateApiRequest").mockResolvedValue({
        ok: true,
        actorId: login,
        scopes: ["admin", "runs:write", "reviews:read", "reviews:write"],
        authType: "session",
      });
    }

    function bearerToken() {
      vi.spyOn(apiAuth, "authenticateApiRequest").mockResolvedValue({
        ok: true,
        actorId: "tok_123",
        repositoryId: "repo_1",
        scopes: ["admin", "runs:write", "reviews:read", "reviews:write"],
        authType: "bearer_token",
      });
    }

    /** A non-member gets the same answer as for a workspace that does not exist. */
    function notAMember() {
      mockMembershipQuery.mockResolvedValue({ rows: [] });
    }

    it("hides another tenant's workspace behind the same 404 as a missing one", async () => {
      sessionAs("alpha-admin");
      notAMember();
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "ws_beta",
            name: "Beta Corp",
            slug: "beta-corp",
            plan_tier: "team",
            stripe_customer_id: "cus_beta",
            created_at: new Date().toISOString(),
          },
        ],
      });

      const res = await getWorkspaces(new Request("https://boardreadyops.test/api/v2/workspaces?slug=beta-corp"));
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain("cus_beta");
    });

    it("refuses to list projects in a workspace the caller does not belong to", async () => {
      sessionAs("alpha-admin");
      notAMember();

      const res = await getProjects(new Request("https://boardreadyops.test/api/v2/projects?workspaceId=ws_beta"));
      expect(res.status).toBe(404);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it("refuses to create a project in a workspace the caller does not belong to", async () => {
      sessionAs("alpha-admin");
      notAMember();

      const res = await createProject(
        new Request("https://boardreadyops.test/api/v2/projects", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "https://boardreadyops.test" },
          body: JSON.stringify({ workspaceId: "ws_beta", name: "Injected" }),
        }),
      );
      expect(res.status).toBe(404);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it("refuses to mint a guest delivery link for another tenant's revision", async () => {
      sessionAs("alpha-admin");
      notAMember();
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "rev_beta",
            project_id: "prj_beta",
            revision_label: "B1",
            source_kind: "direct_upload",
            commit_sha: null,
            bundle_sha256: "b".repeat(64),
            normalized_summary: {},
            created_at: new Date().toISOString(),
          },
        ],
      });

      const res = await createDelivery(
        new Request("https://boardreadyops.test/api/v2/deliveries", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "https://boardreadyops.test" },
          body: JSON.stringify({ revisionId: "rev_beta", signedArchiveUrl: "https://example.invalid/beta.zip" }),
        }),
      );
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain("rawToken");
    });

    it("refuses to upload a revision into another tenant's project", async () => {
      sessionAs("alpha-admin");
      notAMember();

      const res = await createRevision(
        new Request("https://boardreadyops.test/api/v2/revisions/upload", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "https://boardreadyops.test" },
          body: JSON.stringify({
            projectId: "prj_beta",
            revisionLabel: "v1",
            bundleSha256: "c".repeat(64),
          }),
        }),
      );
      expect(res.status).toBe(404);
    });

    it("lets a member through to their own workspace", async () => {
      sessionAs("alpha-admin");
      mockMembershipQuery.mockResolvedValue({ rows: [{ role: "member" }] });
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await getProjects(new Request("https://boardreadyops.test/api/v2/projects?workspaceId=ws_alpha"));
      expect(res.status).toBe(200);
    });

    it("stops a viewer from writing while still letting them read", async () => {
      sessionAs("alpha-viewer");
      mockMembershipQuery.mockResolvedValue({ rows: [{ role: "viewer" }] });

      const res = await createProject(
        new Request("https://boardreadyops.test/api/v2/projects", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "https://boardreadyops.test" },
          body: JSON.stringify({ workspaceId: "ws_alpha", name: "Nope" }),
        }),
      );
      expect(res.status).toBe(403);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it("turns away a repository-scoped API token, which has no workspace identity", async () => {
      bearerToken();

      const res = await getProjects(new Request("https://boardreadyops.test/api/v2/projects?workspaceId=ws_alpha"));
      expect(res.status).toBe(403);
      expect(mockMembershipQuery).not.toHaveBeenCalled();
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });
});
