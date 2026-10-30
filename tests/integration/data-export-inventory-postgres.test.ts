import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DataExportInventoryStore,
  ExportInventoryUnavailableError,
} from "../../packages/db/src/data-export-inventory.js";
import { preparePendingExportManifest } from "../../packages/db/src/data-export-manifest.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 2 }) : undefined;

const tenant = `export-inventory-${randomUUID()}`;
const outsider = `export-outsider-${randomUUID()}`;
const installations: [string, string, string] = [randomUUID(), randomUUID(), randomUUID()];
const repositories: [string, string, string] = [randomUUID(), randomUUID(), randomUUID()];
const exports: [string, string, string, string, string] = [
  randomUUID(),
  randomUUID(),
  randomUUID(),
  randomUUID(),
  randomUUID(),
];

function database() {
  if (!executor) throw new Error("Disposable PostgreSQL is required");
  return executor;
}

function store() {
  return new DataExportInventoryStore(database());
}

beforeAll(async () => {
  if (!executor) return;
  for (const [index, id] of installations.entries()) {
    await database().query(
      `INSERT INTO installations (id, github_installation_id, account_login, account_type)
       VALUES ($1, $2, $3, 'Organization')`,
      [id, Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16) + index, index === 2 ? outsider : tenant],
    );
  }
  for (const [index, id] of repositories.entries()) {
    await database().query(
      `INSERT INTO repositories (id, installation_id, github_repo_id, owner, name, private, default_branch)
       VALUES ($1, $2, $3, $4, $5, $6, 'main')`,
      [
        id,
        installations[index],
        Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16) + index,
        index === 2 ? outsider : tenant,
        `repo-${index}`,
        index === 0,
      ],
    );
  }
  const cases = [
    { id: exports[0], owner: tenant, scope: "organization", scopeId: null, status: "pending" },
    { id: exports[1], owner: tenant, scope: "repository", scopeId: repositories[0], status: "pending" },
    { id: exports[2], owner: tenant, scope: "repository", scopeId: repositories[1], status: "pending" },
    { id: exports[3], owner: tenant, scope: "user", scopeId: tenant, status: "pending" },
    { id: exports[4], owner: tenant, scope: "organization", scopeId: null, status: "completed" },
  ];
  for (const item of cases) {
    await database().query(
      `INSERT INTO data_exports (id, tenant_id, requested_by, status, scope, scope_id)
       VALUES ($1, $2, 'integration', $3, $4, $5)`,
      [item.id, item.owner, item.status, item.scope, item.scopeId],
    );
  }
});

afterAll(async () => {
  if (!executor) return;
  try {
    await database().query("DELETE FROM data_exports WHERE id = ANY($1::text[])", [exports]);
    await database().query("DELETE FROM installations WHERE id = ANY($1::text[])", [installations]);
  } finally {
    await database().close();
  }
});

describeDatabase("pending data export inventory boundary (PostgreSQL)", () => {
  it("returns only repositories owned by the selected active installation", async () => {
    const inventory = await store().previewPendingExport({
      exportId: exports[0],
      tenantId: tenant.toUpperCase(),
      installationId: installations[0],
    });
    expect(inventory).toMatchObject({
      formatVersion: 1,
      exportId: exports[0],
      tenantId: tenant,
      coverage: "selected-installation-repositories-only",
      repositories: [{ repositoryId: repositories[0], name: "repo-0", private: true }],
    });
    expect(inventory?.repositories).toHaveLength(1);
    expect(JSON.stringify(inventory)).not.toContain("storage_path");
  });

  it("prepares a stable, allowlisted JSON manifest from persisted tenant-owned data without changing export status", async () => {
    const request = { exportId: exports[0], tenantId: tenant, installationId: installations[0] };
    const first = await preparePendingExportManifest(store(), request);
    const second = await preparePendingExportManifest(store(), request);
    expect(first).not.toBeNull();
    expect(first?.sha256).toBe(second?.sha256);
    const body = JSON.parse(first?.bytes.toString("utf8") ?? "") as Record<string, unknown>;
    expect(body).toMatchObject({
      kind: "boardreadyops.repository-metadata-export",
      coverage: "selected-installation-repositories-only",
      repositories: [{ repositoryId: repositories[0], private: true }],
    });
    expect(JSON.stringify(body)).not.toContain("repo-1");
    expect(JSON.stringify(body)).not.toContain("storage_path");
    const persisted = await database().query("SELECT status, download_url FROM data_exports WHERE id=$1", [exports[0]]);
    expect((persisted as { rows: Array<{ status: string; download_url: string | null }> }).rows[0]).toEqual({
      status: "pending",
      download_url: null,
    });
  });

  it("does not confuse two installations sharing an account login", async () => {
    const inventory = await store().previewPendingExport({
      exportId: exports[0],
      tenantId: tenant,
      installationId: installations[1],
    });
    expect(inventory?.repositories.map((r) => r.repositoryId)).toEqual([repositories[1]]);
  });

  it("does not read another tenant, unknown installation or completed export", async () => {
    const make = (changes: Partial<Parameters<ReturnType<typeof store>["previewPendingExport"]>[0]>) =>
      store().previewPendingExport({
        exportId: exports[0],
        tenantId: tenant,
        installationId: installations[0],
        ...changes,
      });
    await expect(make({ tenantId: outsider })).resolves.toBeNull();
    await expect(make({ installationId: installations[2] })).resolves.toBeNull();
    await expect(make({ installationId: randomUUID() })).resolves.toBeNull();
    await expect(make({ exportId: exports[4] })).resolves.toBeNull();
  });

  it("never broadens repository scope to a different repository or installation", async () => {
    const correct = await store().previewPendingExport({
      exportId: exports[1],
      tenantId: tenant,
      installationId: installations[0],
    });
    expect(correct?.repositories.map((r) => r.repositoryId)).toEqual([repositories[0]]);
    await expect(
      store().previewPendingExport({
        exportId: exports[2],
        tenantId: tenant,
        installationId: installations[0],
      }),
    ).rejects.toBeInstanceOf(ExportInventoryUnavailableError);
  });

  it("rejects unsupported user scope and suspended installations", async () => {
    await expect(
      store().previewPendingExport({
        exportId: exports[3],
        tenantId: tenant,
        installationId: installations[0],
      }),
    ).rejects.toBeInstanceOf(ExportInventoryUnavailableError);
    await database().query("UPDATE installations SET suspended_at = NOW() WHERE id=$1", [installations[0]]);
    await expect(
      store().previewPendingExport({
        exportId: exports[0],
        tenantId: tenant,
        installationId: installations[0],
      }),
    ).resolves.toBeNull();
  });
});
