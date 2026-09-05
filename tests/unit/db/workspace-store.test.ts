import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";
import { WorkspaceStore } from "../../../packages/db/src/workspace-store.js";

class MockWorkspaceDb implements SqlQueryExecutor {
  workspaces: Record<string, unknown>[] = [];
  projects: Record<string, unknown>[] = [];
  revisions: Record<string, unknown>[] = [];
  deliveries: Record<string, unknown>[] = [];

  async query(sql: string, params: readonly unknown[] = []): Promise<{ rows: unknown[] }> {
    const s = sql.toLowerCase();

    // Workspaces
    if (s.includes("insert into workspaces")) {
      const row = {
        id: params[0],
        name: params[1],
        slug: params[2],
        plan_tier: params[3],
        stripe_customer_id: params[4],
        created_at: new Date().toISOString(),
      };
      this.workspaces.push(row);
      return { rows: [row] };
    }

    if (s.includes("from workspaces") && s.includes("where slug = $1")) {
      const match = this.workspaces.find((w) => w.slug === params[0]);
      return { rows: match ? [match] : [] };
    }

    if (s.includes("from workspaces") && s.includes("where id = $1")) {
      const match = this.workspaces.find((w) => w.id === params[0]);
      return { rows: match ? [match] : [] };
    }

    // Projects
    if (s.includes("insert into projects")) {
      const row = {
        id: params[0],
        workspace_id: params[1],
        name: params[2],
        description: params[3],
        default_cad_format: params[4],
        github_repo_full_name: params[5],
        created_at: new Date().toISOString(),
      };
      this.projects.push(row);
      return { rows: [row] };
    }

    if (s.includes("from projects") && s.includes("where workspace_id = $1")) {
      const matches = this.projects.filter((p) => p.workspace_id === params[0]);
      return { rows: matches };
    }

    // Revisions
    if (s.includes("insert into revisions")) {
      const row = {
        id: params[0],
        project_id: params[1],
        revision_label: params[2],
        source_kind: params[3],
        commit_sha: params[4],
        bundle_sha256: params[5],
        normalized_summary: params[6],
        created_at: new Date().toISOString(),
      };
      this.revisions.push(row);
      return { rows: [row] };
    }

    if (s.includes("from revisions") && s.includes("where id = $1")) {
      const match = this.revisions.find((r) => r.id === params[0]);
      return { rows: match ? [match] : [] };
    }

    // Deliveries
    if (s.includes("insert into deliveries")) {
      const row = {
        id: params[0],
        revision_id: params[1],
        access_token_hash: params[2],
        expires_at: params[3],
        signed_archive_url: params[4],
        recipient_notes: params[5],
        created_at: new Date().toISOString(),
      };
      this.deliveries.push(row);
      return { rows: [row] };
    }

    if (s.includes("from deliveries") && s.includes("access_token_hash = $1")) {
      const hash = params[0] as string;
      const match = this.deliveries.find(
        (d) => d.access_token_hash === hash && new Date(String(d.expires_at)).getTime() > Date.now(),
      );
      return { rows: match ? [match] : [] };
    }

    return { rows: [] };
  }
}

describe("WorkspaceStore", () => {
  it("creates and retrieves workspaces by slug and id", async () => {
    const db = new MockWorkspaceDb();
    const store = new WorkspaceStore(db);

    const created = await store.createWorkspace({
      name: "Acme Hardware",
      slug: "acme-hardware",
      planTier: "team",
    });

    expect(created.name).toBe("Acme Hardware");
    expect(created.slug).toBe("acme-hardware");
    expect(created.planTier).toBe("team");

    const bySlug = await store.getWorkspaceBySlug("acme-hardware");
    expect(bySlug).toEqual(created);

    const byId = await store.getWorkspaceById(created.id);
    expect(byId).toEqual(created);
  });

  it("creates and lists projects under a workspace", async () => {
    const db = new MockWorkspaceDb();
    const store = new WorkspaceStore(db);

    const ws = await store.createWorkspace({
      name: "Robotics Co",
      slug: "robotics-co",
    });

    const prj1 = await store.createProject({
      workspaceId: ws.id,
      name: "Sensor Board",
      defaultCadFormat: "altium",
    });

    const prj2 = await store.createProject({
      workspaceId: ws.id,
      name: "Power Module",
      defaultCadFormat: "kicad",
    });

    expect(prj1.name).toBe("Sensor Board");
    expect(prj2.name).toBe("Power Module");

    const list = await store.listProjectsByWorkspace(ws.id);
    expect(list).toHaveLength(2);
    expect(list.map((p) => p.name)).toContain("Sensor Board");
    expect(list.map((p) => p.name)).toContain("Power Module");
  });

  it("creates revisions from uploads and stores normalized summaries", async () => {
    const db = new MockWorkspaceDb();
    const store = new WorkspaceStore(db);

    const rev = await store.createRevisionFromUpload({
      projectId: "prj_test_123",
      revisionLabel: "rev-c",
      bundleSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      normalizedSummary: {
        layerCount: 4,
        componentCount: 42,
      },
    });

    expect(rev.revisionLabel).toBe("rev-c");
    expect(rev.sourceKind).toBe("direct_upload");
    expect(rev.normalizedSummary).toEqual({
      layerCount: 4,
      componentCount: 42,
    });

    const fetched = await store.getRevisionById(rev.id);
    expect(fetched).toEqual(rev);
  });

  it("creates and retrieves delivery links with token hashing and expiration", async () => {
    const db = new MockWorkspaceDb();
    const store = new WorkspaceStore(db);

    const expiresAt = new Date(Date.now() + 86400 * 1000).toISOString();
    const { delivery, rawToken } = await store.createDeliveryLink({
      revisionId: "rev_test_123",
      expiresAt,
      signedArchiveUrl: "https://storage.example.com/archive.zip",
      recipientNotes: "For JLCPCB fab review",
    });

    expect(rawToken).toBeDefined();
    expect(delivery.accessTokenHash).toBe(createHash("sha256").update(rawToken).digest("hex"));
    expect(delivery.signedArchiveUrl).toBe("https://storage.example.com/archive.zip");

    const resolved = await store.getDeliveryByToken(rawToken);
    expect(resolved).toEqual(delivery);

    // Invalid token returns null
    const invalid = await store.getDeliveryByToken("invalid_token_1234");
    expect(invalid).toBeNull();
  });
});
