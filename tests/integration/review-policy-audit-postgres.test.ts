import { afterAll, describe, expect, it } from "vitest";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { ReviewPolicyStore } from "../../packages/db/src/review-policy-store.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 2 }) : undefined;
const tenantId = "policy-audit-integration";
const actor = { githubUserId: 424242, login: "policy-auditor" };

function database() {
  if (!executor) throw new Error("DATABASE_URL is required");
  return executor;
}

afterAll(async () => {
  if (!executor) return;
  await database().query("delete from review_policies where tenant_id = $1", [tenantId]);
  await executor.close();
});

describeDatabase("review policy audit history", () => {
  it("persists create/update/delete snapshots and keeps the history after policy deletion", async () => {
    const store = new ReviewPolicyStore(database());
    const created = await store.createPolicy(
      {
        tenantId,
        scope: "organization",
        name: "Integration baseline",
        requiredChecklist: ["DFM sign-off"],
        severityGate: "high",
        requireEvidencePack: true,
      },
      actor,
    );

    const updated = await store.updatePolicy(
      created.id,
      { severityGate: "medium", requireExternalReview: true },
      actor,
    );
    expect(updated?.severityGate).toBe("medium");

    await expect(store.deletePolicy(created.id, actor)).resolves.toBe(true);

    const events = await store.listAuditEvents(tenantId, created.id);
    expect(events.map((event) => event.action)).toEqual(["delete", "update", "create"]);
    expect(events[2]?.beforePolicy).toBeNull();
    expect(events[2]?.afterPolicy).toMatchObject({ id: created.id, severityGate: "high" });
    expect(events[1]?.beforePolicy).toMatchObject({ id: created.id, severityGate: "high" });
    expect(events[1]?.afterPolicy).toMatchObject({
      id: created.id,
      severityGate: "medium",
      requireExternalReview: true,
    });
    expect(events[0]?.beforePolicy).toMatchObject({ id: created.id, severityGate: "medium" });
    expect(events[0]?.afterPolicy).toBeNull();
    expect(events.every((event) => event.actorLogin === actor.login)).toBe(true);
  });

  it("rejects mutation or deletion of persisted policy audit events", async () => {
    const rows = await database().query(
      "select id from review_policy_audit_events where tenant_id = $1 order by created_at desc limit 1",
      [tenantId],
    );
    const id = (rows as { rows?: Array<{ id?: string }> }).rows?.[0]?.id;
    expect(id).toBeTruthy();

    await expect(
      database().query("update review_policy_audit_events set actor_login = 'tampered' where id = $1", [id]),
    ).rejects.toThrow(/append-only/u);
    await expect(database().query("delete from review_policy_audit_events where id = $1", [id])).rejects.toThrow(
      /append-only/u,
    );
  });
});
