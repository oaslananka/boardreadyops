import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { assessHistoricalUserWorkspaceCandidates } from "../../../packages/db/src/data-export-historical-workspace-candidates.js";

const exportId = randomUUID();
const originalId = 5_601_001_123;
const authority = { exportId, verifiedGitHubUserId: originalId };
const reportRow = {
  export_id: exportId,
  retained_suspended_user: true,
  competing_or_unbound_installation_identity: true,
  workspaces_numeric: 1,
  workspaces_legacy: 2,
  projects_numeric: 3,
  members_numeric: 4,
  members_legacy: 5,
  member_audit_actor: 6,
  member_audit_subject: 7,
  billing_seats: 8,
  review_policies: 9,
  policy_audit_actor: 10,
  policy_audit_other: 11,
};
const countKeys = [
  "workspaces_numeric",
  "workspaces_legacy",
  "projects_numeric",
  "members_numeric",
  "members_legacy",
  "member_audit_actor",
  "member_audit_subject",
  "billing_seats",
  "review_policies",
  "policy_audit_actor",
  "policy_audit_other",
] as const;
function mockDb(result: unknown = { rows: [reportRow] }) {
  const query = vi.fn(async (_sql: string, _args: unknown[]): Promise<unknown> => result);
  const withTransaction = vi.fn(async (fn: (tx: { query: typeof query }) => Promise<unknown>) => fn({ query }));
  return { query, withTransaction, db: { withTransaction } as never };
}

describe("historical original numeric USER workspace candidate counters are NOT ownership or archive rights", () => {
  it("separates exact member/actor identity from legacy login and multiuser rows", async () => {
    const f = mockDb();
    expect(await assessHistoricalUserWorkspaceCandidates(f.db, authority)).toEqual({
      status: "collaboration-candidates-not-customer-ownership",
      releaseDecision: "NO_GO",
      reviewedUnlinkedClasses: 7,
      completeCustomerExport: false,
      customerDeliveryAllowed: false,
      originalUserOwnershipVerified: false,
      allWorkspaceMembersConsented: false,
      thirdPartyDisclosureRightsVerified: false,
      orphanedWorkspaceAndAuditRowsUnresolved: true,
      competingOrUnboundInstallationIdentity: true,
      candidateCounts: {
        workspacesWithNumericMember: 1,
        workspacesWithUnboundLoginMember: 2,
        projectsInNumericallyJoinedWorkspaces: 3,
        numericWorkspaceMemberships: 4,
        unboundLoginWorkspaceMemberships: 5,
        auditEventsActedByNumericUser: 6,
        auditEventsAboutNumericUser: 7,
        billingSeatMembershipsWithLogin: 8,
        reviewPoliciesWithLogin: 9,
        policyAuditEventsActedByNumericUser: 10,
        policyAuditEventsWithLoginButOtherNumericActor: 11,
      },
    });
    expect(f.withTransaction).toHaveBeenCalledExactlyOnceWith(expect.any(Function), {
      consistentRead: true,
      statementTimeoutMs: 5000,
    });
    expect(f.query).toHaveBeenCalledExactlyOnceWith(expect.any(String), [exportId, originalId]);
    const sql = f.query.mock.calls[0]?.[0] ?? "";
    expect(sql).toContain("original_github_user_id=$2::bigint");
    expect(sql).toContain("former_installations");
    for (const table of [
      "workspace_members",
      "workspace_member_audit_events",
      "workspace_memberships",
      "workspaces",
      "projects",
      "review_policies",
      "review_policy_audit_events",
    ])
      expect(sql).toContain(["public.", table].join(""));
    expect(sql).toContain("m.github_user_id=target.original_github_user_id");
    expect(sql).toContain("m.github_user_id IS NULL");
    expect(sql).toContain("e.subject_github_user_id=target.original_github_user_id");
    expect(sql).toContain("e.actor_github_user_id<>target.original_github_user_id");
    expect(sql.match(/LIMIT 101/gu)).toHaveLength(11);
    expect(sql).not.toMatch(/SELECT\s+\*/iu);
    expect(sql).not.toContain("before_policy");
    expect(sql).not.toContain("after_policy");
    expect(sql).not.toContain("github_avatar_url");
    expect(sql).not.toContain("signed_archive_url");
  });

  it("never grants customer export even when zero workspace or policy matches exist", async () => {
    const none = { ...reportRow, competing_or_unbound_installation_identity: false };
    for (const key of countKeys) none[key] = 0;
    expect(await assessHistoricalUserWorkspaceCandidates(mockDb({ rows: [none] }).db, authority)).toMatchObject({
      originalUserOwnershipVerified: false,
      allWorkspaceMembersConsented: false,
      customerDeliveryAllowed: false,
      orphanedWorkspaceAndAuditRowsUnresolved: true,
      candidateCounts: { workspacesWithNumericMember: 0, policyAuditEventsActedByNumericUser: 0 },
    });
  });

  it("freezes caller numeric user and export ID before async transaction work", async () => {
    const f = mockDb();
    const mutable = { ...authority };
    f.withTransaction.mockImplementationOnce(async (fn) => {
      mutable.exportId = randomUUID();
      mutable.verifiedGitHubUserId = 1;
      return fn({ query: f.query });
    });
    expect(await assessHistoricalUserWorkspaceCandidates(f.db, mutable)).toMatchObject({
      customerDeliveryAllowed: false,
    });
    expect(f.query.mock.calls[0]?.[1]).toEqual([exportId, originalId]);
  });

  it("refuses malformed identifiers before touching PostgreSQL", async () => {
    const f = mockDb();
    expect(await assessHistoricalUserWorkspaceCandidates(f.db, { ...authority, exportId: "fake" })).toBeNull();
    for (const id of [0, -5, 0.1, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        await assessHistoricalUserWorkspaceCandidates(f.db, { ...authority, verifiedGitHubUserId: id }),
      ).toBeNull();
    }
    expect(await assessHistoricalUserWorkspaceCandidates(null as never, authority)).toBeNull();
    expect(f.withTransaction).not.toHaveBeenCalled();
  });

  it("denies missing owner row, forged response and malformed authority results", async () => {
    for (const response of [
      null,
      { invalid: [] },
      { rows: [] },
      { rows: [reportRow, reportRow] },
      { rows: [null] },
      { rows: [[]] },
      { rows: ["invalid"] },
      { rows: [{ ...reportRow, export_id: randomUUID() }] },
      { rows: [{ ...reportRow, retained_suspended_user: false }] },
      { rows: [{ ...reportRow, competing_or_unbound_installation_identity: "true" }] },
    ])
      expect(await assessHistoricalUserWorkspaceCandidates(mockDb(response).db, authority)).toBeNull();
  });

  it("denies any class with 101+ candidates, negative counts and corrupted PostgreSQL aggregate types", async () => {
    for (const key of countKeys) {
      for (const value of [-1, 101, Number.NaN, 1.5, "3", null]) {
        const row = { ...reportRow, [key]: value };
        expect(await assessHistoricalUserWorkspaceCandidates(mockDb({ rows: [row] }).db, authority)).toBeNull();
      }
    }
  });

  it("fails closed on query errors and snapshot adapter errors", async () => {
    const f = mockDb();
    f.query.mockRejectedValueOnce(new Error("statement timed out"));
    expect(await assessHistoricalUserWorkspaceCandidates(f.db, authority)).toBeNull();
    f.withTransaction.mockRejectedValueOnce(new Error("PG read-only transaction unavailable"));
    expect(await assessHistoricalUserWorkspaceCandidates(f.db, authority)).toBeNull();
  });
});
