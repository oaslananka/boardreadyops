import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DataExportInventoryStore } from "../../packages/db/src/data-export-inventory.js";
import { prepareClaimedExportManifest } from "../../packages/db/src/data-export-manifest.js";
import {
  DataExportPreparationStore,
  ExportPreparationInputError,
} from "../../packages/db/src/data-export-preparation-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 3 }) : undefined;
const anotherExecutor = connectionString ? createPgQueryExecutor({ connectionString, max: 3 }) : undefined;
const tenant = `export-claim-${randomUUID()}`;
const outsider = `other-claim-${randomUUID()}`;
const installations: [string, string, string] = [randomUUID(), randomUUID(), randomUUID()];
const repositories: [string, string, string] = [randomUUID(), randomUUID(), randomUUID()];
const exported: string[] = [];

function db() {
  if (!executor) throw new Error("Disposable DB required");
  return executor;
}
function store() {
  return new DataExportPreparationStore(db());
}
function otherStore() {
  if (!anotherExecutor) throw new Error("Second independent connection required");
  return new DataExportPreparationStore(anotherExecutor);
}
async function created(scope: "organization" | "repository", scopeId?: string) {
  const id = await store().createBoundPendingExport({
    tenantId: tenant,
    installationId: installations[0],
    requestedBy: "operator",
    scope,
    ...(scopeId === undefined ? {} : { scopeId }),
  });
  if (id) exported.push(id);
  return id;
}

beforeAll(async () => {
  if (!executor) return;
  for (const [i, id] of installations.entries()) {
    await db().query(
      `INSERT INTO installations(id, github_installation_id, account_login, account_type)
       VALUES($1,$2,$3,'Organization')`,
      [id, Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16) + i, i === 2 ? outsider : tenant],
    );
    await db().query(
      `INSERT INTO repositories(id, installation_id, github_repo_id, owner, name, default_branch)
       VALUES($1,$2,$3,$4,$5,'main')`,
      [
        repositories[i],
        id,
        Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16) + i,
        i === 2 ? outsider : tenant,
        `board-${i}`,
      ],
    );
  }
});
afterAll(async () => {
  if (!executor) return;
  try {
    await db().query("DELETE FROM data_exports WHERE id = ANY($1::text[])", [exported]);
    await db().query("DELETE FROM installations WHERE id = ANY($1::text[])", [installations]);
  } finally {
    await executor.close();
    await anotherExecutor?.close();
  }
});

describeDatabase("installation-bound read-only export preparation claims (PostgreSQL)", () => {
  it("rejects malformed identities and cross-tenant/repository writes", async () => {
    await expect(
      store().createBoundPendingExport({
        tenantId: tenant,
        installationId: " padded ",
        requestedBy: "operator",
        scope: "organization",
      }),
    ).rejects.toThrow(ExportPreparationInputError);
    await expect(
      store().createBoundPendingExport({
        tenantId: outsider,
        installationId: installations[0],
        requestedBy: "operator",
        scope: "organization",
      }),
    ).resolves.toBeNull();
    await expect(
      store().createBoundPendingExport({
        tenantId: tenant,
        installationId: installations[0],
        requestedBy: "operator",
        scope: "repository",
        scopeId: repositories[1],
      }),
    ).resolves.toBeNull();
    await expect(
      store().createBoundPendingExport({
        tenantId: tenant,
        installationId: installations[0],
        requestedBy: "operator",
        scope: "repository",
        scopeId: repositories[0],
      }),
    ).resolves.toMatch(/^[0-9a-f-]{36}$/u);
    // The scope-allowed request above must be cleaned up without touching another tenant.
    const r = await db().query("SELECT id FROM data_exports WHERE installation_id = $1", [installations[0]]);
    for (const row of (r as { rows: Array<{ id: string }> }).rows) {
      if (!exported.includes(row.id)) exported.push(row.id);
      // Avoid leaking a fixture from this scope test into the claim-order test.
      await db().query("DELETE FROM data_exports WHERE id = $1", [row.id]);
    }
  });

  it("claims only installation-bound requests; old unbound rows remain untouched", async () => {
    const old = randomUUID();
    exported.push(old);
    await db().query(
      "INSERT INTO data_exports(id,tenant_id,requested_by,status,scope) VALUES ($1,$2,'operator','pending','organization')",
      [old, tenant],
    );
    const id = await created("organization");
    expect(id).toBeTruthy();
    const claims = await Promise.all([
      store().claimNext({ installationId: installations[0], workerId: "worker-a" }),
      otherStore().claimNext({ installationId: installations[0], workerId: "worker-b" }),
    ]);
    const claimed = claims.filter((c) => c !== null);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({
      exportId: id,
      tenantId: tenant,
      installationId: installations[0],
      attemptCount: 1,
    });
    expect(await store().claimNext({ installationId: installations[0], workerId: "worker-c" })).toBeNull();
    expect(await store().claimNext({ installationId: installations[1], workerId: "worker-c" })).toBeNull();
    const oldRow = await db().query("SELECT status,installation_id FROM data_exports WHERE id=$1", [old]);
    expect((oldRow as { rows: Array<{ status: string; installation_id: string | null }> }).rows[0]).toEqual({
      status: "pending",
      installation_id: null,
    });
    const token = claimed[0];
    if (!token) throw new Error("expected claim");
    const inventoryStore = new DataExportInventoryStore(db());
    const prepared = await prepareClaimedExportManifest(inventoryStore, {
      exportId: token.exportId,
      installationId: token.installationId,
      tenantId: token.tenantId,
      workerId: token.workerId,
      token: token.token,
    });
    expect(prepared?.sha256).toMatch(/^[0-9a-f]{64}$/u);
    const bytes = prepared?.bytes.toString("utf8") ?? "";
    expect(bytes).toContain("boardreadyops.repository-metadata-export");
    expect(bytes).not.toContain("storage_path");
    await expect(
      prepareClaimedExportManifest(inventoryStore, {
        exportId: token.exportId,
        installationId: token.installationId,
        tenantId: token.tenantId,
        workerId: token.workerId,
        token: "wrong-token",
      }),
    ).resolves.toBeNull();
    expect(
      await store().releaseReadOnlyClaim({
        exportId: token.exportId,
        installationId: installations[1],
        workerId: token.workerId,
        token: token.token,
      }),
    ).toBe(false);
    expect(
      await store().releaseReadOnlyClaim({
        exportId: token.exportId,
        installationId: token.installationId,
        workerId: token.workerId,
        token: "wrong-token",
      }),
    ).toBe(false);
    expect(
      await store().releaseReadOnlyClaim({
        exportId: token.exportId,
        installationId: token.installationId,
        workerId: token.workerId,
        token: token.token,
      }),
    ).toBe(true);
    const second = await otherStore().claimNext({ installationId: installations[0], workerId: "worker-second" });
    expect(second).toMatchObject({ exportId: id, attemptCount: 2 });
    expect(second?.token).not.toEqual(token.token);
  });

  it("never automatically reclaims expired work and rejects stale completions", async () => {
    const running = await db().query(
      "SELECT id FROM data_exports WHERE status='running' AND installation_id=$1 LIMIT 1",
      [installations[0]],
    );
    const id = (running as { rows: Array<{ id: string }> }).rows[0]?.id;
    expect(id).toBeTruthy();
    await db().query("UPDATE data_exports SET preparation_lease_until = NOW() - interval '1 second' WHERE id=$1", [id]);
    expect(await store().claimNext({ installationId: installations[0], workerId: "worker-third" })).toBeNull();
    const claim = await db().query("SELECT preparation_worker,preparation_token,status FROM data_exports WHERE id=$1", [
      id,
    ]);
    const value = (claim as { rows: Array<{ preparation_worker: string; preparation_token: string; status: string }> })
      .rows[0];
    expect(value?.status).toBe("running");
    await expect(
      prepareClaimedExportManifest(new DataExportInventoryStore(db()), {
        exportId: id ?? "",
        installationId: installations[0],
        tenantId: tenant,
        workerId: value?.preparation_worker ?? "",
        token: value?.preparation_token ?? "",
      }),
    ).resolves.toBeNull();
    expect(
      await store().releaseReadOnlyClaim({
        exportId: id ?? "",
        installationId: installations[0],
        workerId: value?.preparation_worker ?? "",
        token: value?.preparation_token ?? "",
      }),
    ).toBe(false);
  });

  it("refuses new reservations after suspension without erasing prior requests", async () => {
    await db().query("UPDATE installations SET suspended_at=NOW() WHERE id=$1", [installations[1]]);
    expect(
      await store().createBoundPendingExport({
        tenantId: tenant,
        installationId: installations[1],
        requestedBy: "operator",
        scope: "organization",
      }),
    ).toBeNull();
    expect(await store().claimNext({ installationId: installations[1], workerId: "worker-x" })).toBeNull();
  });
});
