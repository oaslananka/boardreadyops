import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("supply finding repository-scoped server actions", () => {
  it("centralizes repository re-authorization and store lifecycle in one helper", () => {
    const source = readFileSync("apps/web/app/repositories/[repositoryId]/actions.ts", "utf8");

    expect(source).toContain("async function withSupplyFindingStore");
    expect(source).toContain("resolveTokenAdminScope(session, requestedRepositoryId)");
    expect(source).toContain("repositoryId: scope.selected.id");
    expect(source).toContain("actor: session.login");
    expect(source).toContain("store: createSqlSupplyFindingStore(executor)");
    expect(source).toContain("await executor.close()");
    expect(source).not.toContain("acknowledgedBy: input");
    expect(source).not.toContain("suppressedBy: input");
  });

  it("routes acknowledgement, suppression, and clear operations through the shared scoped helper", () => {
    const source = readFileSync("apps/web/app/repositories/[repositoryId]/actions.ts", "utf8");

    expect(source).toContain("acknowledgeSupplyFindingAction");
    expect(source).toContain("suppressSupplyFindingAction");
    expect(source).toContain("clearSupplyFindingSuppressionAction");
    expect(source.match(/withSupplyFindingStore\(session, input\.repositoryId/gu)?.length).toBe(3);
    expect(source).toContain("store.acknowledge(repositoryId, input.findingId, actor");
    expect(source).toContain("store.suppress(repositoryId, input.findingId, actor");
    expect(source).toContain("store.clearSuppression(repositoryId, input.findingId, actor");
    expect(source).toContain('z.enum(["1d", "7d", "30d"])');
    expect(source).toContain("z.string().trim().min(3).max(500)");
  });

  it("refreshes every customer surface that exposes open supply finding state", () => {
    const source = readFileSync("apps/web/app/repositories/[repositoryId]/actions.ts", "utf8");

    expect(source).toContain("revalidatePath");
    expect(source).toContain('"/dashboard"');
    expect(source).toContain('"/parts"');
  });
});
