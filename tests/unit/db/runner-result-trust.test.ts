import { describe, expect, it } from "vitest";
import { trustedSignerWorkflowRefSql } from "../../../packages/db/src/runner-result-trust.js";

describe("persisted signed-manufacturing signer identity", () => {
  it("compares the cryptographically verified signer ref to the repository's configured workflow branch", () => {
    expect(trustedSignerWorkflowRefSql("evidence", "repositories")).toBe(
      "evidence.source_ref = ('refs/heads/' || repositories.default_branch)",
    );
    expect(trustedSignerWorkflowRefSql("source_proof", "evidence_repository")).toBe(
      "source_proof.source_ref = ('refs/heads/' || evidence_repository.default_branch)",
    );
  });

  it("does not confuse the checked-out PR ref with the trusted workflow signer ref", () => {
    const sql = trustedSignerWorkflowRefSql("evidence", "repo");
    expect(sql).toContain("repo.default_branch");
    expect(sql).not.toContain("run.ref");
    expect(sql).not.toContain("release_runs.ref");
  });
});
