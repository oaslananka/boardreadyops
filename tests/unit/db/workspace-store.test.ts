import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";
import { WorkspaceStore } from "../../../packages/db/src/workspace-store.js";

class MockWorkspaceDb implements SqlQueryExecutor {
  workspaces: Record<string, unknown>[] = [];
  members: Record<string, unknown>[] = [];
  projects: Record<string, unknown>[] = [];
  revisions: Record<string, unknown>[] = [];
  deliveries: Record<string, unknown>[] = [];

  async query(sql: string, params: readonly unknown[] = []): Promise<{ rows: unknown[] }> {
    const s = sql.toLowerCase();

    // Workspaces
    // One statement inserts the workspace and its owner membership together, so the mock records
    // both -- a workspace with no member is exactly the state that made the v2 API unauthorizable.
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
      if (s.includes("insert into workspace_members")) {
        this.members.push({ workspace_id: params[0], user_id: params[5], role: "owner" });
      }
      return { rows: [row] };
    }

    if (s.includes("from workspace_members") && s.includes("join workspaces")) {
      const rows = this.members
        .filter((m) => m.user_id === params[0])
        .flatMap((m) => {
          const workspace = this.workspaces.find((w) => w.id === m.workspace_id);
          return workspace ? [{ ...workspace, role: m.role }] : [];
        });
      return { rows };
    }

    if (s.includes("insert into workspace_members") && s.includes("on conflict")) {
      const existing = this.members.find((m) => m.workspace_id === params[0] && m.user_id === params[1]);
      if (existing) existing.role = params[2];
      else this.members.push({ workspace_id: params[0], user_id: params[1], role: params[2] });
      return {
        rows: [{ workspace_id: params[0], user_id: params[1], role: params[2], created_at: new Date().toISOString() }],
      };
    }

    if (s.includes("delete from workspace_members")) {
      const index = this.members.findIndex((m) => m.workspace_id === params[0] && m.user_id === params[1]);
      if (index === -1) return { rows: [] };
      const target = this.members[index] as Record<string, unknown>;
      // The real statement refuses in SQL; the mock mirrors that condition rather than the shape.
      const otherOwner = this.members.some(
        (m) => m.workspace_id === params[0] && m.user_id !== params[1] && m.role === "owner",
      );
      if (target.role === "owner" && !otherOwner) return { rows: [] };
      this.members.splice(index, 1);
      return { rows: [{ user_id: params[1] }] };
    }

    if (s.includes("from workspace_members") && s.includes("order by case role")) {
      const rows = this.members
        .filter((m) => m.workspace_id === params[0])
        .map((m) => ({ ...m, created_at: new Date().toISOString() }));
      return { rows };
    }

    if (s.includes("from workspace_members")) {
      const match = this.members.find((m) => m.workspace_id === params[0] && m.user_id === params[1]);
      return { rows: match ? [{ role: match.role }] : [] };
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

    if (s.includes("from revisions") && s.includes("join projects")) {
      const workspaceId = params[0];
      const rows = this.revisions
        .filter((r) => this.projects.some((p) => p.id === r.project_id && p.workspace_id === workspaceId))
        .map((r) => ({
          ...r,
          project_name: this.projects.find((p) => p.id === r.project_id)?.name,
        }));
      return { rows };
    }

    if (s.includes("from deliveries") && s.includes("join revisions")) {
      const workspaceId = params[0];
      const rows = this.deliveries.flatMap((d) => {
        const revision = this.revisions.find((r) => r.id === d.revision_id);
        const project = this.projects.find((p) => p.id === revision?.project_id);
        if (!revision || !project || project.workspace_id !== workspaceId) return [];
        return [
          {
            ...d,
            revision_label: revision.revision_label,
            project_id: project.id,
            project_name: project.name,
          },
        ];
      });
      return { rows };
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
      ownerUserId: "acme-admin",
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
      ownerUserId: "robotics-admin",
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
  it("makes the creator the owner, so the workspace can be authorized at all", async () => {
    const db = new MockWorkspaceDb();
    const store = new WorkspaceStore(db);

    const ws = await store.createWorkspace({
      name: "Acme Hardware",
      slug: "acme-hardware",
      ownerUserId: "acme-admin",
    });

    expect(await store.workspaceRoleFor(ws.id, "acme-admin")).toBe("owner");
    expect(await store.workspaceRoleFor(ws.id, "someone-else")).toBeNull();
  });

  it("reads a role outside the check constraint as no membership at all", async () => {
    const db = new MockWorkspaceDb();
    const store = new WorkspaceStore(db);
    const ws = await store.createWorkspace({ name: "Acme", slug: "acme", ownerUserId: "acme-admin" });
    // The column is text with a check constraint, and a constraint can be dropped or predate a
    // value. Narrowing here means callers get `WorkspaceRole | null` and never an unhandled role.
    db.members.push({ workspace_id: ws.id, user_id: "ghost", role: "superuser" });

    expect(await store.workspaceRoleFor(ws.id, "ghost")).toBeNull();
  });

  it("lists only the workspaces the user belongs to", async () => {
    const db = new MockWorkspaceDb();
    const store = new WorkspaceStore(db);

    const mine = await store.createWorkspace({ name: "Mine", slug: "mine", ownerUserId: "me" });
    await store.createWorkspace({ name: "Theirs", slug: "theirs", ownerUserId: "them" });

    const listed = await store.listWorkspacesForUser("me");
    expect(listed.map((workspace) => workspace.id)).toEqual([mine.id]);
    expect(listed[0]?.role).toBe("owner");
    expect(await store.listWorkspacesForUser("nobody")).toEqual([]);
  });
  it("lists a workspace's revisions with the project each belongs to", async () => {
    const db = new MockWorkspaceDb();
    const store = new WorkspaceStore(db);
    const ws = await store.createWorkspace({ name: "Acme", slug: "acme", ownerUserId: "acme-admin" });
    const project = await store.createProject({ workspaceId: ws.id, name: "Gateway board" });
    await store.createRevisionFromUpload({
      projectId: project.id,
      revisionLabel: "rev C",
      bundleSha256: "a".repeat(64),
    });

    const revisions = await store.listRevisionsByWorkspace(ws.id);

    expect(revisions).toHaveLength(1);
    // The project name is the point: a revision label alone does not say which board it is.
    expect(revisions[0]?.projectName).toBe("Gateway board");
    expect(revisions[0]?.revisionLabel).toBe("rev C");
  });

  it("lists a workspace's delivery links without their token hash", async () => {
    const db = new MockWorkspaceDb();
    const store = new WorkspaceStore(db);
    const ws = await store.createWorkspace({ name: "Acme", slug: "acme", ownerUserId: "acme-admin" });
    const project = await store.createProject({ workspaceId: ws.id, name: "Gateway board" });
    const revision = await store.createRevisionFromUpload({
      projectId: project.id,
      revisionLabel: "rev C",
      bundleSha256: "a".repeat(64),
    });
    await store.createDeliveryLink({
      revisionId: revision.id,
      expiresAt: new Date(Date.now() + 86_400_000),
      signedArchiveUrl: "https://storage.example.com/gateway.zip",
      recipientNotes: "Panelised",
    });

    const deliveries = await store.listDeliveriesByWorkspace(ws.id);

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      revisionLabel: "rev C",
      projectName: "Gateway board",
      signedArchiveUrl: "https://storage.example.com/gateway.zip",
      recipientNotes: "Panelised",
    });
    // The hash is the one stored value a guessed guest URL could be checked against, so a
    // listing must not carry it into a page.
    expect(deliveries[0]).not.toHaveProperty("accessTokenHash");
  });

  it("keeps another workspace's revisions and deliveries out of both listings", async () => {
    const db = new MockWorkspaceDb();
    const store = new WorkspaceStore(db);
    const mine = await store.createWorkspace({ name: "Mine", slug: "mine", ownerUserId: "me" });
    const theirs = await store.createWorkspace({ name: "Theirs", slug: "theirs", ownerUserId: "them" });
    const theirProject = await store.createProject({ workspaceId: theirs.id, name: "Secret board" });
    const theirRevision = await store.createRevisionFromUpload({
      projectId: theirProject.id,
      revisionLabel: "R1",
      bundleSha256: "b".repeat(64),
    });
    await store.createDeliveryLink({
      revisionId: theirRevision.id,
      expiresAt: new Date(Date.now() + 86_400_000),
      signedArchiveUrl: "https://storage.example.com/secret.zip",
    });

    expect(await store.listRevisionsByWorkspace(mine.id)).toEqual([]);
    expect(await store.listDeliveriesByWorkspace(mine.id)).toEqual([]);
    expect(await store.listDeliveriesByWorkspace(theirs.id)).toHaveLength(1);
  });
  it("grants access, and re-granting changes the role instead of failing", async () => {
    const db = new MockWorkspaceDb();
    const store = new WorkspaceStore(db);
    const ws = await store.createWorkspace({ name: "Acme", slug: "acme", ownerUserId: "alice" });

    await store.upsertWorkspaceMember({ workspaceId: ws.id, userId: "bob", role: "member" });
    expect(await store.workspaceRoleFor(ws.id, "bob")).toBe("member");

    // "Add them as an admin" when they are already a member has to mean promote, not error.
    await store.upsertWorkspaceMember({ workspaceId: ws.id, userId: "bob", role: "admin" });
    expect(await store.workspaceRoleFor(ws.id, "bob")).toBe("admin");
    expect(await store.listWorkspaceMembers(ws.id)).toHaveLength(2);
  });

  it("refuses to remove the last owner, because nobody could then administer the workspace", async () => {
    const db = new MockWorkspaceDb();
    const store = new WorkspaceStore(db);
    const ws = await store.createWorkspace({ name: "Acme", slug: "acme", ownerUserId: "alice" });
    await store.upsertWorkspaceMember({ workspaceId: ws.id, userId: "bob", role: "admin" });

    // Only owners and admins manage members, and an admin cannot promote themselves, so an
    // ownerless workspace is permanently unadministrable.
    expect(await store.removeWorkspaceMember(ws.id, "alice")).toBe(false);
    expect(await store.workspaceRoleFor(ws.id, "alice")).toBe("owner");
  });

  it("removes an owner once a second owner exists", async () => {
    const db = new MockWorkspaceDb();
    const store = new WorkspaceStore(db);
    const ws = await store.createWorkspace({ name: "Acme", slug: "acme", ownerUserId: "alice" });
    await store.upsertWorkspaceMember({ workspaceId: ws.id, userId: "bob", role: "owner" });

    expect(await store.removeWorkspaceMember(ws.id, "alice")).toBe(true);
    expect(await store.workspaceRoleFor(ws.id, "alice")).toBeNull();
    expect(await store.workspaceRoleFor(ws.id, "bob")).toBe("owner");
  });

  it("removes a non-owner freely and reports a member who was never there", async () => {
    const db = new MockWorkspaceDb();
    const store = new WorkspaceStore(db);
    const ws = await store.createWorkspace({ name: "Acme", slug: "acme", ownerUserId: "alice" });
    await store.upsertWorkspaceMember({ workspaceId: ws.id, userId: "bob", role: "viewer" });

    expect(await store.removeWorkspaceMember(ws.id, "bob")).toBe(true);
    expect(await store.removeWorkspaceMember(ws.id, "never-a-member")).toBe(false);
  });
});
