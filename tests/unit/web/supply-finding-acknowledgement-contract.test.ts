import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("supply finding repository-scoped server actions", () => {
  it("re-authorizes the repository and delegates a repository-scoped finding mutation", () => {
    const source = readFileSync("apps/web/app/repositories/[repositoryId]/actions.ts", "utf8");

    expect(source).toContain("resolveTokenAdminScope(session, input.repositoryId)");
    expect(source).toContain("createSqlSupplyFindingStore(executor).acknowledge(");
    expect(source).toContain("scope.selected.id");
    expect(source).toContain("input.findingId");
    expect(source).toContain("session.login");
    expect(source).not.toContain("acknowledgedBy: input");
  });

  it("re-authorizes time-bound suppression and clear operations instead of trusting form identity", () => {
    const source = readFileSync("apps/web/app/repositories/[repositoryId]/actions.ts", "utf8");

    expect(source).toContain("suppressSupplyFindingAction");
    expect(source).toContain("clearSupplyFindingSuppressionAction");
    expect(source.match(/resolveTokenAdminScope\(session, input\.repositoryId\)/gu)?.length).toBeGreaterThanOrEqual(3);
    expect(source).toContain('z.enum(["1d", "7d", "30d"])');
    expect(source).toContain("z.string().trim().min(3).max(500)");
    expect(source).toContain("createSqlSupplyFindingStore(executor).suppress(");
    expect(source).toContain("createSqlSupplyFindingStore(executor).clearSuppression(");
    expect(source).not.toContain("suppressedBy: input");
  });

  it("refreshes every customer surface that exposes open supply finding state", () => {
    const source = readFileSync("apps/web/app/repositories/[repositoryId]/actions.ts", "utf8");

    expect(source).toContain("revalidatePath");
    expect(source).toContain('"/dashboard"');
    expect(source).toContain('"/parts"');
  });
});
