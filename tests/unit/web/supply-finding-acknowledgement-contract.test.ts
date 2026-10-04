import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("supply finding acknowledgement server action", () => {
  it("re-authorizes the repository and delegates a repository-scoped finding mutation", () => {
    const source = readFileSync("apps/web/app/repositories/[repositoryId]/actions.ts", "utf8");

    expect(source).toContain("resolveTokenAdminScope(session, input.repositoryId)");
    expect(source).toContain("createSqlSupplyFindingStore(executor).acknowledge(");
    expect(source).toContain("scope.selected.id");
    expect(source).toContain("input.findingId");
    expect(source).toContain("session.login");
    expect(source).not.toContain("acknowledgedBy: input");
  });

  it("refreshes every customer surface that exposes open supply finding state", () => {
    const source = readFileSync("apps/web/app/repositories/[repositoryId]/actions.ts", "utf8");

    expect(source).toContain("revalidatePath");
    expect(source).toContain('"/dashboard"');
    expect(source).toContain('"/parts"');
  });
});
