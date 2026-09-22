import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cloudDatabaseModels, cloudDatabaseSchemaVersion } from "../../../packages/db/src/index.js";

const migrationsDir = join(process.cwd(), "packages/db/migrations");

describe("BoardReadyOps Cloud migrations", () => {
  it("maintains schema version alignment with migration files", () => {
    expect(cloudDatabaseSchemaVersion).toBe(70);
  });

  it("exports known cloud database models", () => {
    expect(cloudDatabaseModels).toContain("Installation");
    expect(cloudDatabaseModels).toContain("ReleaseRun");
    expect(cloudDatabaseModels).toContain("RunnerRegistration");
    expect(cloudDatabaseModels).toContain("AuditEvent");
    expect(cloudDatabaseModels).toContain("ReviewApproval");
    expect(cloudDatabaseModels).toContain("Workspace");
    expect(cloudDatabaseModels).toContain("Project");
  });

  it("discovers SQL migrations in deterministic order", async () => {
    const files = (await readdir(migrationsDir)).filter((file) => /^\d+_.+\.sql$/u.test(file)).sort();
    expect(files.length).toBe(70);
    expect(files[0]).toBe("0001_cloud_schema.sql");
  });
});
