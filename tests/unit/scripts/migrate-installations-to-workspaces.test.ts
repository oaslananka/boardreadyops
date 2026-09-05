import { describe, expect, it } from "vitest";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";
import { migrateInstallationsToWorkspaces } from "../../../scripts/migrate-installations-to-workspaces.mjs";

class MockMigrationDb implements SqlQueryExecutor {
  installations: Record<string, unknown>[] = [
    {
      id: "inst_1",
      account_login: "acme-corp",
      plan_tier: "team",
    },
    {
      id: "inst_2",
      account_login: "solo-dev",
      plan_tier: "community",
    },
  ];

  repositories: Record<string, unknown>[] = [
    {
      id: "repo_1",
      installation_id: "inst_1",
      owner: "acme-corp",
      name: "hardware-controller",
    },
    {
      id: "repo_2",
      installation_id: "inst_1",
      owner: "acme-corp",
      name: "sensor-node",
    },
  ];

  workspaces: Record<string, unknown>[] = [];
  projects: Record<string, unknown>[] = [];

  async query(sql: string, params: readonly unknown[] = []): Promise<{ rows: unknown[] }> {
    const s = sql.toLowerCase();

    if (s.includes("from installations")) {
      return { rows: [...this.installations] };
    }

    if (s.includes("from repositories")) {
      return { rows: [...this.repositories] };
    }

    if (s.includes("insert into workspaces")) {
      const row = {
        id: params[0],
        name: params[1],
        slug: params[2],
        plan_tier: params[3],
      };
      this.workspaces.push(row);
      return { rows: [row] };
    }

    if (s.includes("from workspaces where slug = $1")) {
      const match = this.workspaces.find((w) => w.slug === params[0]);
      return { rows: match ? [match] : [] };
    }

    if (s.includes("insert into projects")) {
      const row = {
        id: params[0],
        workspace_id: params[1],
        name: params[2],
        github_repo_full_name: params[3],
      };
      this.projects.push(row);
      return { rows: [row] };
    }

    if (s.includes("from projects where github_repo_full_name = $1")) {
      const match = this.projects.find((p) => p.github_repo_full_name === params[0]);
      return { rows: match ? [match] : [] };
    }

    return { rows: [] };
  }
}

describe("migrateInstallationsToWorkspaces", () => {
  it("migrates installations and repositories into workspaces and projects", async () => {
    const db = new MockMigrationDb();

    const result = await migrateInstallationsToWorkspaces(db);

    expect(result.workspacesCreated).toBe(2);
    expect(result.projectsCreated).toBe(2);

    expect(db.workspaces.map((w) => w.slug)).toEqual(["gh-acme-corp", "gh-solo-dev"]);
    expect(db.projects.map((p) => p.name)).toEqual(["hardware-controller", "sensor-node"]);

    // Idempotent: running again should not recreate
    const secondPass = await migrateInstallationsToWorkspaces(db);
    expect(secondPass.workspacesCreated).toBe(0);
    expect(secondPass.projectsCreated).toBe(0);
  });
});
