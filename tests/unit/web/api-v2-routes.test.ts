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

vi.mock("../../../packages/db/src/pg-executor.js", () => ({
  createPgQueryExecutor: vi.fn(() => ({
    query: (sql: string, params: readonly unknown[]) => {
      if (sql.includes("from workspace_memberships")) return mockMembershipQuery(sql, params);
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
      // First query finds workspace, second query inserts project
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            { id: "ws_123", name: "Alpha Corp", slug: "alpha-corp", plan_tier: "community", created_at: new Date() },
          ],
        })
        .mockResolvedValueOnce({
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
});
