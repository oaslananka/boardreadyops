import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DataLifecycleStore } from "../../packages/db/src/data-lifecycle-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 2 }) : undefined;
const tenants: string[] = [];

function requireExecutor() {
  if (!executor) throw new Error("Disposable PostgreSQL is required for this test.");
  return executor;
}

async function erasureStatuses(ids: readonly string[]): Promise<string[]> {
  const result = await requireExecutor().query(
    "select id, status from erasure_requests where id = any($1::text[]) order by id",
    [[...ids]],
  );
  return ((result as { rows: { id: string; status: string }[] }).rows ?? []).map((row) => row.status);
}

afterAll(async () => {
  if (executor) {
    try {
      if (tenants.length > 0) {
        await executor.query("delete from erasure_requests where tenant_id = any($1::text[])", [tenants]);
        await executor.query("delete from legal_holds where tenant_id = any($1::text[])", [tenants]);
      }
    } finally {
      await executor.close();
    }
  }
});

describeDatabase("legal-hold release must not authorize erasure (PostgreSQL)", () => {
  it("matches GitHub user-login hold scope case-insensitively, not repository scope or another tenant", async () => {
    const store = new DataLifecycleStore(requireExecutor());
    const tenant = `case-user-${randomUUID()}`;
    const otherTenant = `case-other-${randomUUID()}`;
    tenants.push(tenant, otherTenant);
    const userHold = await store.createLegalHold({
      tenantId: tenant,
      createdBy: "integration",
      reason: "Preserve personal GitHub account history",
      scope: "user",
      scopeId: tenant.toUpperCase(),
    });
    const repositoryHold = await store.createLegalHold({
      tenantId: tenant,
      createdBy: "integration",
      reason: "Preserve exact repository scope only",
      scope: "repository",
      scopeId: "BoardABC",
    });
    expect(userHold.active).toBe(true);
    expect(repositoryHold.active).toBe(true);

    await expect(store.hasActiveHold(tenant, "user", tenant)).resolves.toBe(true);
    await expect(store.hasActiveHold(otherTenant, "user", tenant)).resolves.toBe(false);
    await expect(store.hasActiveHold(tenant, "repository", "boardabc")).resolves.toBe(false);
    const held = await store.createErasure({
      tenantId: tenant,
      requestedBy: "integration",
      scope: "user",
      scopeId: tenant,
    });
    const unrelated = await store.createErasure({
      tenantId: otherTenant,
      requestedBy: "integration",
      scope: "user",
      scopeId: otherTenant,
    });
    const differentRepository = await store.createErasure({
      tenantId: tenant,
      requestedBy: "integration",
      scope: "repository",
      scopeId: "boardabc",
    });
    expect([held.status, unrelated.status, differentRepository.status]).toEqual([
      "blocked_by_hold",
      "pending",
      "pending",
    ]);
  });

  it("keeps a blocked real and dry-run erasure blocked after the final overlapping hold is released", async () => {
    const store = new DataLifecycleStore(requireExecutor());
    const tenantA = `legal-hold-a-${randomUUID()}`;
    const tenantB = `legal-hold-b-${randomUUID()}`;
    tenants.push(tenantA, tenantB);

    const shared = await store.createLegalHold({
      tenantId: tenantA,
      createdBy: "operator-a",
      reason: "Preserve records during audit.",
      scope: "organization",
    });
    const scoped = await store.createLegalHold({
      tenantId: tenantA,
      createdBy: "operator-a",
      reason: "Preserve selected board history.",
      scope: "repository",
      scopeId: "board-1",
    });
    const unrelated = await store.createLegalHold({
      tenantId: tenantB,
      createdBy: "operator-b",
      reason: "Separate tenant legal inquiry.",
      scope: "repository",
      scopeId: "board-1",
    });

    const heldReal = await store.createErasure({
      tenantId: tenantA,
      requestedBy: "operator-a",
      scope: "repository",
      scopeId: "board-1",
    });
    const heldPreview = await store.createErasure({
      tenantId: tenantA,
      requestedBy: "operator-a",
      scope: "repository",
      scopeId: "board-1",
      dryRun: true,
    });
    const otherTenant = await store.createErasure({
      tenantId: tenantB,
      requestedBy: "operator-b",
      scope: "repository",
      scopeId: "board-1",
    });
    const ids = [heldReal.id, heldPreview.id, otherTenant.id];
    expect([heldReal.status, heldPreview.status, otherTenant.status]).toEqual([
      "blocked_by_hold",
      "blocked_by_hold",
      "blocked_by_hold",
    ]);

    await expect(store.releaseLegalHold(tenantB, scoped.id, "operator-b")).resolves.toBe(false);
    await expect(store.releaseLegalHold(tenantA, scoped.id, "operator-a")).resolves.toBe(true);
    expect(await erasureStatuses(ids)).toEqual(["blocked_by_hold", "blocked_by_hold", "blocked_by_hold"]);

    await expect(store.releaseLegalHold(tenantA, shared.id, "operator-a")).resolves.toBe(true);
    await expect(store.releaseLegalHold(tenantA, shared.id, "operator-a")).resolves.toBe(false);
    expect(await erasureStatuses(ids)).toEqual(["blocked_by_hold", "blocked_by_hold", "blocked_by_hold"]);

    await expect(store.releaseLegalHold(tenantB, unrelated.id, "operator-b")).resolves.toBe(true);
    expect(await erasureStatuses(ids)).toEqual(["blocked_by_hold", "blocked_by_hold", "blocked_by_hold"]);
    const holds = await store.listLegalHolds(tenantA);
    expect(holds.filter((hold) => hold.active)).toEqual([]);
    expect(holds.filter((hold) => hold.releasedBy === "operator-a")).toHaveLength(2);
  });
});
