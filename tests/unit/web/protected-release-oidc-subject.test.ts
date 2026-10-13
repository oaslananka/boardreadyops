import { describe, expect, it } from "vitest";
import { protectedReleaseSubjectMatches } from "../../../apps/web/lib/protected-release-oidc-subject.js";

const expected = { repository: "org/board", repositoryId: "601", ref: "refs/heads/main" };
const claims = {
  repository: "org/board",
  repository_id: "601",
  repository_owner_id: "501",
  ref: "refs/heads/main",
  sub: "repo:org/board:ref:refs/heads/main",
};

describe("future protected-release signed GitHub OIDC subject", () => {
  it("accepts the exact legacy default ref subject with a signed matching repository ID", () => {
    expect(protectedReleaseSubjectMatches(claims, expected)).toBe(true);
  });

  it("accepts GitHub's immutable owner ID and repository ID subject with matching signed claims", () => {
    expect(
      protectedReleaseSubjectMatches(
        {
          ...claims,
          sub: "repo:org@501/board@601:ref:refs/heads/main",
        },
        expected,
      ),
    ).toBe(true);
  });

  it.each([
    ["wrong repository ID", { repository_id: "602" }],
    ["renamed name", { repository: "other/board" }],
    ["wrong ref", { ref: "refs/heads/develop" }],
    ["wrong sub ref", { sub: "repo:org/board:ref:refs/heads/develop" }],
    ["immovable ID mismatch", { sub: "repo:org@501/board@602:ref:refs/heads/main" }],
    ["reassigned owner ID", { sub: "repo:org@502/board@601:ref:refs/heads/main" }],
    ["malformed owner ID", { repository_owner_id: "invalid", sub: "repo:org@501/board@601:ref:refs/heads/main" }],
    ["custom template", { sub: "repo:org/board:environment:production" }],
    ["pull request subject", { sub: "repo:org/board:pull_request" }],
    ["missing subject", { sub: undefined }],
  ])("rejects %s", async (_label, patch) => {
    expect(protectedReleaseSubjectMatches({ ...claims, ...patch }, expected)).toBe(false);
  });

  it("rejects a subject without a nonzero, stable repository ID", () => {
    expect(protectedReleaseSubjectMatches({ ...claims, repository_id: "0" }, expected)).toBe(false);
    expect(protectedReleaseSubjectMatches(claims, { ...expected, repositoryId: "0" })).toBe(false);
  });
});
