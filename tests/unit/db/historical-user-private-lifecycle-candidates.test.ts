import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { assessHistoricalUserPrivateLifecycleCandidates } from "../../../packages/db/src/data-export-historical-private-lifecycle-candidates.js";

const exportId = randomUUID();
const numeric = 9_443_127_625;
const authority = { exportId, verifiedGitHubUserId: numeric };
const row = {
  export_id: exportId,
  retained_suspended_user: true,
  competing_or_unbound_installation_identity: true,
  export_reservation_tenant_mismatch: false,
  conflicting_numeric_identity: false,
  copy_reservations: 1,
  unlink_fences: 2,
  archive_commitments: 3,
  live_oauth_proofs: 4,
  oauth_challenges: 5,
  cleanup_events: 6,
  read_reservations: 7,
  private_preflights: 8,
  private_events: 9,
};
const countKeys = [
  "copy_reservations",
  "unlink_fences",
  "archive_commitments",
  "live_oauth_proofs",
  "oauth_challenges",
  "cleanup_events",
  "read_reservations",
  "private_preflights",
  "private_events",
] as const;
function fixture(response: unknown = { rows: [row] }) {
  const query = vi.fn(async (_sql: string, _args: unknown[]): Promise<unknown> => response);
  const withTransaction = vi.fn(async (run: (tx: { query: typeof query }) => Promise<unknown>) => run({ query }));
  return { db: { withTransaction } as never, query, withTransaction };
}

describe("historical USER nine private control classes and three platform-only exclusions", () => {
  it("returns bounded private counts only, no customer disclosure, and excludes three platform classes", async () => {
    const f = fixture();
    expect(await assessHistoricalUserPrivateLifecycleCandidates(f.db, authority)).toEqual({
      status: "historical-private-control-records-not-customer-payload",
      releaseDecision: "NO_GO",
      reviewedUnlinkedPrivateClasses: 9,
      classifiedPlatformOnlyClasses: [
        "cloud_schema_migrations",
        "component_lifecycle_observations",
        "control_plane_jobs",
      ],
      completeCustomerExport: false,
      customerDeliveryAllowed: false,
      originalUserOwnershipVerified: false,
      independentArchiveCompletenessVerified: false,
      platformOperationalRecordsExcludedFromCustomerPayload: true,
      historicalTenantLoginIsNotIdentity: true,
      competingOrUnboundInstallationIdentity: true,
      conflictingOriginalNumericIdDetected: false,
      exportReservationTenantMismatchDetected: false,
      candidateCounts: {
        artifactExportCopyReservations: 1,
        tenantLoginOnlyUnlinkFences: 2,
        legacyArchiveCommitments: 3,
        liveOAuthProofs: 4,
        oauthChallenges: 5,
        partialCleanupEvents: 6,
        partialReadReservations: 7,
        privateDeliveryPreflights: 8,
        privatePreflightEvents: 9,
      },
    });
    expect(f.withTransaction).toHaveBeenCalledExactlyOnceWith(expect.any(Function), {
      consistentRead: true,
      statementTimeoutMs: 5000,
    });
    expect(f.query).toHaveBeenCalledExactlyOnceWith(expect.any(String), [exportId, numeric]);
    const sql = f.query.mock.calls[0]?.[0] ?? "";
    expect(sql).toContain("original_github_user_id=$2::bigint");
    expect(sql).toContain("former_installations");
    expect(sql).toContain("r.tenant_key<>lower(target.tenant_id)");
    expect(sql.match(/LIMIT 101/gu)).toHaveLength(9);
    for (const table of [
      "artifact_export_copy_reservations",
      "artifact_unlink_fences",
      "data_export_archive_commitments",
      "historical_user_live_oauth_verified_proofs",
      "historical_user_oauth_challenges",
      "historical_user_partial_cleanup_events",
      "historical_user_partial_read_reservations",
      "historical_user_private_delivery_preflights",
      "historical_user_private_preflight_events",
    ])
      expect(sql).toContain(["public.", table].join(""));
    for (const table of ["cloud_schema_migrations", "component_lifecycle_observations", "control_plane_jobs"]) {
      expect(sql).not.toContain(table);
    }
    expect(sql).not.toMatch(/SELECT\s+\*/iu);
    expect(sql).not.toContain("state_sha256 AS");
    expect(sql).not.toContain("storage_path AS");
    expect(sql).not.toContain("worker_id AS");
  });

  it("empty and competing-login candidate result still cannot prove original USER data ownership", async () => {
    const zero = { ...row, competing_or_unbound_installation_identity: false };
    for (const key of countKeys) zero[key] = 0;
    expect(await assessHistoricalUserPrivateLifecycleCandidates(fixture({ rows: [zero] }).db, authority)).toMatchObject(
      {
        originalUserOwnershipVerified: false,
        customerDeliveryAllowed: false,
        completeCustomerExport: false,
        historicalTenantLoginIsNotIdentity: true,
        candidateCounts: { tenantLoginOnlyUnlinkFences: 0, liveOAuthProofs: 0 },
      },
    );
  });

  it("denies a conflicting original numeric USER in any private record", async () => {
    expect(
      await assessHistoricalUserPrivateLifecycleCandidates(
        fixture({ rows: [{ ...row, conflicting_numeric_identity: true }] }).db,
        authority,
      ),
    ).toBeNull();
    expect(
      await assessHistoricalUserPrivateLifecycleCandidates(
        fixture({ rows: [{ ...row, export_reservation_tenant_mismatch: true }] }).db,
        authority,
      ),
    ).toBeNull();
  });

  it("freezes mutable caller identity before starting async consistent-read transaction", async () => {
    const f = fixture();
    const input = { ...authority };
    f.withTransaction.mockImplementationOnce(async (run) => {
      input.exportId = randomUUID();
      input.verifiedGitHubUserId = 1;
      return run({ query: f.query });
    });
    expect(await assessHistoricalUserPrivateLifecycleCandidates(f.db, input)).toMatchObject({
      customerDeliveryAllowed: false,
    });
    expect(f.query.mock.calls[0]?.[1]).toEqual([exportId, numeric]);
  });

  it("denies malformed numeric GitHub user, export ID or missing transaction adapter", async () => {
    const f = fixture();
    expect(await assessHistoricalUserPrivateLifecycleCandidates(f.db, { ...authority, exportId: "bogus" })).toBeNull();
    for (const bad of [0, -4, Number.NaN, 1.25, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        await assessHistoricalUserPrivateLifecycleCandidates(f.db, { ...authority, verifiedGitHubUserId: bad }),
      ).toBeNull();
    }
    expect(await assessHistoricalUserPrivateLifecycleCandidates(null as never, authority)).toBeNull();
    expect(f.withTransaction).not.toHaveBeenCalled();
  });

  it("denies missing authority, multiple rows, wrong result types or falsified booleans", async () => {
    for (const response of [
      null,
      { unexpected: [] },
      { rows: [] },
      { rows: [row, row] },
      { rows: [null] },
      { rows: [[]] },
      { rows: [{ ...row, export_id: randomUUID() }] },
      { rows: [{ ...row, retained_suspended_user: false }] },
      { rows: [{ ...row, competing_or_unbound_installation_identity: null }] },
      { rows: [{ ...row, export_reservation_tenant_mismatch: "false" }] },
      { rows: [{ ...row, conflicting_numeric_identity: "false" }] },
    ])
      expect(await assessHistoricalUserPrivateLifecycleCandidates(fixture(response).db, authority)).toBeNull();
  });

  it("denies any malformed or over-cap class count and SQL/transaction failure", async () => {
    for (const key of countKeys) {
      for (const value of [101, -1, null, "3", Number.NaN, 0.5]) {
        expect(
          await assessHistoricalUserPrivateLifecycleCandidates(
            fixture({ rows: [{ ...row, [key]: value }] }).db,
            authority,
          ),
        ).toBeNull();
      }
    }
    const f = fixture();
    f.query.mockRejectedValueOnce(new Error("read statement timeout"));
    expect(await assessHistoricalUserPrivateLifecycleCandidates(f.db, authority)).toBeNull();
    f.withTransaction.mockRejectedValueOnce(new Error("cannot begin read-only snapshot"));
    expect(await assessHistoricalUserPrivateLifecycleCandidates(f.db, authority)).toBeNull();
  });
});
