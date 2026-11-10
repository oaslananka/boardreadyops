import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assessHistoricalUserBillingOwnershipCandidates } from "../../../packages/db/src/data-export-historical-billing-ownership-candidates.js";
import { assessHistoricalUserExportIdentityReview } from "../../../packages/db/src/data-export-historical-export-identity-review.js";
import { assessHistoricalUserPrivateLifecycleCandidates } from "../../../packages/db/src/data-export-historical-private-lifecycle-candidates.js";
import { assessHistoricalUserSchemaCoverage } from "../../../packages/db/src/data-export-historical-schema-coverage.js";
import { assessHistoricalUserTenantOnlyLifecycleCandidates } from "../../../packages/db/src/data-export-historical-tenant-lifecycle-candidates.js";
import { assessHistoricalUserUnlinkedSnapshot } from "../../../packages/db/src/data-export-historical-unlinked-snapshot.js";
import { assessHistoricalUserUnresolvedSourceLineage } from "../../../packages/db/src/data-export-historical-unresolved-lineage.js";
import { assessHistoricalUserWorkspaceCandidates } from "../../../packages/db/src/data-export-historical-workspace-candidates.js";

vi.mock("../../../packages/db/src/data-export-historical-schema-coverage.js", () => ({
  assessHistoricalUserSchemaCoverage: vi.fn(),
}));
vi.mock("../../../packages/db/src/data-export-historical-unresolved-lineage.js", () => ({
  assessHistoricalUserUnresolvedSourceLineage: vi.fn(),
}));
vi.mock("../../../packages/db/src/data-export-historical-export-identity-review.js", () => ({
  assessHistoricalUserExportIdentityReview: vi.fn(),
}));
vi.mock("../../../packages/db/src/data-export-historical-tenant-lifecycle-candidates.js", () => ({
  assessHistoricalUserTenantOnlyLifecycleCandidates: vi.fn(),
}));
vi.mock("../../../packages/db/src/data-export-historical-billing-ownership-candidates.js", () => ({
  assessHistoricalUserBillingOwnershipCandidates: vi.fn(),
}));
vi.mock("../../../packages/db/src/data-export-historical-workspace-candidates.js", () => ({
  assessHistoricalUserWorkspaceCandidates: vi.fn(),
}));
vi.mock("../../../packages/db/src/data-export-historical-private-lifecycle-candidates.js", () => ({
  assessHistoricalUserPrivateLifecycleCandidates: vi.fn(),
}));

const original = { exportId: randomUUID(), verifiedGitHubUserId: 9_810_111_222 };
const unlinked = [
  "data_exports",
  "retention_policies",
  "legal_holds",
  "erasure_requests",
  "product_events",
  "billing_activity",
  "billing_customers",
  "billing_events",
  "billing_subscriptions",
  "github_marketplace_subscriptions",
  "workspaces",
  "projects",
  "workspace_members",
  "workspace_member_audit_events",
  "workspace_memberships",
  "review_policies",
  "review_policy_audit_events",
  "artifact_export_copy_reservations",
  "artifact_unlink_fences",
  "data_export_archive_commitments",
  "historical_user_live_oauth_verified_proofs",
  "historical_user_oauth_challenges",
  "historical_user_partial_cleanup_events",
  "historical_user_partial_read_reservations",
  "historical_user_private_delivery_preflights",
  "historical_user_private_preflight_events",
  "cloud_schema_migrations",
  "component_lifecycle_observations",
  "control_plane_jobs",
];
const makeLineage = () => ({
  releaseDecision: "NO_GO",
  reviewedClasses: 63,
  noPathCount: 29,
  pathToInstallationCount: 34,
  entries: [
    ...unlinked.map((table) => ({ table, installationPath: null })),
    ...Array.from({ length: 34 }, (_, n) => ({ table: `known_${n}`, installationPath: ["installations"] })),
  ],
});
const catalog = vi.mocked(assessHistoricalUserSchemaCoverage);
const lineage = vi.mocked(assessHistoricalUserUnresolvedSourceLineage);
const candidates = [
  vi.mocked(assessHistoricalUserExportIdentityReview),
  vi.mocked(assessHistoricalUserTenantOnlyLifecycleCandidates),
  vi.mocked(assessHistoricalUserBillingOwnershipCandidates),
  vi.mocked(assessHistoricalUserWorkspaceCandidates),
  vi.mocked(assessHistoricalUserPrivateLifecycleCandidates),
];
const guard = { completeCustomerExport: false, customerDeliveryAllowed: false };
const proof = [
  { ...guard, releaseDecision: "NO_GO", independentOwnershipComplete: false, candidateCount: 1 },
  { ...guard, releaseDecision: "NO_GO", reviewedUnlinkedClasses: 4, loginOnlyCandidateCounts: { productEvents: 1 } },
  { ...guard, releaseDecision: "NO_GO", reviewedUnlinkedClasses: 5, exactNumericMarketplaceAccountCount: 0 },
  {
    ...guard,
    releaseDecision: "NO_GO",
    reviewedUnlinkedClasses: 7,
    candidateCounts: { workspacesWithNumericMember: 1 },
  },
  {
    ...guard,
    releaseDecision: "NO_GO",
    reviewedUnlinkedPrivateClasses: 9,
    classifiedPlatformOnlyClasses: [
      "cloud_schema_migrations",
      "component_lifecycle_observations",
      "control_plane_jobs",
    ],
  },
];
function fixture() {
  const tx = { query: vi.fn() };
  const withTransaction = vi.fn(async (fn: (connection: typeof tx) => Promise<unknown>, options: unknown) => {
    expect(options).toEqual({ consistentRead: true, statementTimeoutMs: 10000 });
    return fn(tx);
  });
  return { db: { withTransaction } as never, withTransaction, tx };
}
beforeEach(() => {
  vi.resetAllMocks();
  catalog.mockImplementation(async (db) =>
    db.withTransaction(
      async () => ({ status: "known_schema_scope_unapproved", tableCount: 92, schemaSha256: "a".repeat(64) }) as never,
      { consistentRead: true, statementTimeoutMs: 5000 },
    ),
  );
  lineage.mockImplementation(async (db) =>
    db.withTransaction(async () => makeLineage() as never, { consistentRead: true, statementTimeoutMs: 5000 }),
  );
  candidates.forEach((mock, n) => {
    mock.mockImplementation(
      async (db, input) =>
        db.withTransaction(
          async () => {
            expect(input).toEqual(original);
            return proof[n] as never;
          },
          { consistentRead: true, statementTimeoutMs: 5000 },
        ) as never,
    );
  });
});

describe("same-snapshot 29 unlinked original-user source classes remain private NO_GO", () => {
  it("uses exactly one read-only PostgreSQL transaction and returns only a count-only digest", async () => {
    const f = fixture();
    const result = await assessHistoricalUserUnlinkedSnapshot(f.db, original);
    expect(result).toEqual({
      status: "unlinked-source-candidates-unapproved",
      releaseDecision: "NO_GO",
      completeCustomerExport: false,
      customerDeliveryAllowed: false,
      originalUserOwnershipVerified: false,
      thirdPartyDisclosureRightsVerified: false,
      reviewedCandidateClasses: 26,
      excludedPlatformClasses: 3,
      countOnlySnapshotSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(JSON.stringify(result)).not.toContain(original.exportId);
    expect(JSON.stringify(result)).not.toContain(String(original.verifiedGitHubUserId));
    expect(f.withTransaction).toHaveBeenCalledOnce();
    for (const mock of [catalog, lineage, ...candidates]) expect(mock).toHaveBeenCalledOnce();
    for (const mock of [lineage, ...candidates]) expect(mock.mock.calls[0]?.[0]).toBe(catalog.mock.calls[0]?.[0]);
    expect(result).toEqual(await assessHistoricalUserUnlinkedSnapshot(f.db, original));
  });

  it("rejects bad immutable USER authority before touching PostgreSQL", async () => {
    const f = fixture();
    for (const input of [
      { ...original, exportId: "other" },
      { ...original, verifiedGitHubUserId: 0 },
      { ...original, verifiedGitHubUserId: Number.MAX_SAFE_INTEGER + 1 },
    ])
      expect(await assessHistoricalUserUnlinkedSnapshot(f.db, input)).toBeNull();
    expect(await assessHistoricalUserUnlinkedSnapshot(null as never, original)).toBeNull();
    expect(f.withTransaction).not.toHaveBeenCalled();
  });

  it("freezes numeric account and export identity before any awaited source read", async () => {
    const f = fixture();
    const input = { ...original };
    const normal = catalog.getMockImplementation();
    catalog.mockImplementationOnce(async (db) => {
      input.exportId = randomUUID();
      input.verifiedGitHubUserId = 1;
      return normal?.(db) as never;
    });
    expect(await assessHistoricalUserUnlinkedSnapshot(f.db, input)).not.toBeNull();
  });

  it("refuses drifted tables, missing/ambiguous FK paths, or changed platform exclusion", async () => {
    const f = fixture();
    catalog.mockResolvedValueOnce({ status: "schema_drift" } as never);
    expect(await assessHistoricalUserUnlinkedSnapshot(f.db, original)).toBeNull();
    lineage.mockResolvedValueOnce({ ...makeLineage(), noPathCount: 28 } as never);
    expect(await assessHistoricalUserUnlinkedSnapshot(f.db, original)).toBeNull();
    lineage.mockResolvedValueOnce({
      ...makeLineage(),
      entries: [{ table: "unknown", installationPath: null }, ...makeLineage().entries.slice(1)],
    } as never);
    expect(await assessHistoricalUserUnlinkedSnapshot(f.db, original)).toBeNull();
    candidates[4]?.mockResolvedValueOnce({ ...proof[4], classifiedPlatformOnlyClasses: ["other"] } as never);
    expect(await assessHistoricalUserUnlinkedSnapshot(f.db, original)).toBeNull();
  });

  it("fails closed if any of the five original-user authorities refuses its read", async () => {
    const f = fixture();
    for (const mock of candidates) {
      mock.mockResolvedValueOnce(null);
      expect(await assessHistoricalUserUnlinkedSnapshot(f.db, original)).toBeNull();
    }
    candidates[2]?.mockResolvedValueOnce({ ...proof[2], customerDeliveryAllowed: true } as never);
    expect(await assessHistoricalUserUnlinkedSnapshot(f.db, original)).toBeNull();
    candidates[2]?.mockResolvedValueOnce({ releaseDecision: "GO", reviewedUnlinkedClasses: 5 } as never);
    expect(await assessHistoricalUserUnlinkedSnapshot(f.db, original)).toBeNull();
    catalog.mockImplementationOnce(async (db) =>
      db.withTransaction(
        async () => ({ status: "known_schema_scope_unapproved", tableCount: 92, schemaSha256: null }) as never,
        { consistentRead: true, statementTimeoutMs: 5000 },
      ),
    );
    expect(await assessHistoricalUserUnlinkedSnapshot(f.db, original)).toBeNull();
  });

  it("refuses any assessor that tries to escape the pinned transaction", async () => {
    const f = fixture();
    candidates[0]?.mockImplementationOnce(
      async (db) =>
        db.withTransaction(async () => proof[0] as never, { consistentRead: true, statementTimeoutMs: 15000 }) as never,
    );
    expect(await assessHistoricalUserUnlinkedSnapshot(f.db, original)).toBeNull();
  });

  it("changes count-only fingerprint when a candidate count changes, while never granting delivery", async () => {
    const f = fixture();
    const before = await assessHistoricalUserUnlinkedSnapshot(f.db, original);
    candidates[0]?.mockImplementationOnce(async () => ({ ...proof[0], candidateCount: 2 }) as never);
    const after = await assessHistoricalUserUnlinkedSnapshot(f.db, original);
    expect(after?.countOnlySnapshotSha256).not.toBe(before?.countOnlySnapshotSha256);
    expect(after?.customerDeliveryAllowed).toBe(false);
  });
});
