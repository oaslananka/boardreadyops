import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { assessHistoricalUserPrivateLifecycleCandidates } from "../../packages/db/src/data-export-historical-private-lifecycle-candidates.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const suite = connectionString ? describe : describe.skip;
const db = connectionString ? createPgQueryExecutor({ connectionString }) : null;
const tenant = ["historical-private-", randomUUID().slice(0, 10)].join("");
const numericUser = 8_123_456_789;
const anotherUser = numericUser + 1;
const exportId = randomUUID();
const installationId = randomUUID();
const foreignInstallationId = randomUUID();
const preflightId = randomUUID();
const oauthChallengeSha = "a".repeat(64);
const archiveSha = "b".repeat(64);
const sourceSha = "c".repeat(64);
const authorities = { exportId, verifiedGitHubUserId: numericUser };
const externalInstallation = () => Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16);

suite("disposable PostgreSQL: nine PRIVATE historical USER trace classes, platform rows excluded", () => {
  afterAll(async () => {
    // Immutable OAuth and preflight audit records must not be selectively
    // deleted. The isolated PostgreSQL instance is destroyed after this suite.
    if (db) await db.close();
  });

  it("counts nine real control records without selecting hashes, credentials or customer ZIP payload", async () => {
    if (!db) throw new Error("Disposable PostgreSQL required");
    await db.query(
      `INSERT INTO installations(id,github_installation_id,account_login,account_type,account_user_id,suspended_at)
       VALUES($1,$2,$3,'User',$4,NOW())`,
      [installationId, externalInstallation(), tenant, numericUser],
    );
    await db.query(
      `INSERT INTO data_exports(id,tenant_id,requested_by,status,scope,scope_id,original_github_user_id)
       VALUES($1,$2,'github_app_uninstall','pending','user',$2,$3)`,
      [exportId, tenant, numericUser],
    );
    await db.query(
      `INSERT INTO artifact_export_copy_reservations(token,export_id,artifact_id,tenant_key,storage_path,worker_id)
       VALUES($1,$2,$3,$4,'private-synthetic-object-path','synthetic-worker')`,
      [randomUUID(), exportId, randomUUID(), tenant],
    );
    await db.query(
      `INSERT INTO artifact_unlink_fences(token,deletion_job_id,tenant_key,worker_id,settled_at,outcome)
       VALUES($1,$2,$3,'synthetic-worker',NOW(),'missing')`,
      [randomUUID(), randomUUID(), tenant],
    );
    await db.query(
      `INSERT INTO data_export_archive_commitments(
         export_id,installation_id,archive_sha256,archive_byte_length,archive_files,expires_at
       ) VALUES($1,$2,$3,2048,9,NOW()+INTERVAL '1 hour')`,
      [exportId, installationId, archiveSha],
    );
    await db.query(
      `INSERT INTO historical_user_private_delivery_preflights(
         id,export_id,original_github_user_id,expected_archive_sha256,expected_archive_bytes,
         expected_core_sha256,expected_visual_sha256,expected_mutation_epoch_sha256,expires_at
       ) VALUES($1,$2,$3,$4,2048,$5,$5,$5,NOW()+INTERVAL '2 minutes')`,
      [preflightId, exportId, numericUser, archiveSha, sourceSha],
    );
    await db.query(
      `INSERT INTO historical_user_oauth_challenges(
         state_sha256,export_id,original_github_user_id,expires_at
       ) VALUES($1,$2,$3,NOW()+INTERVAL '2 minutes')`,
      [oauthChallengeSha, exportId, numericUser],
    );
    await db.query(
      `INSERT INTO historical_user_live_oauth_verified_proofs(
         id,state_sha256,export_id,original_github_user_id,expires_at
       ) VALUES($1,$2,$3,$4,NOW()+INTERVAL '2 minutes')`,
      [randomUUID(), oauthChallengeSha, exportId, numericUser],
    );
    await db.query(
      `INSERT INTO historical_user_partial_cleanup_events(
         export_id,original_github_user_id,preflight_id,archive_sha256,archive_byte_length,outcome
       ) VALUES($1,$2,$3,$4,2048,'missing')`,
      [exportId, numericUser, preflightId, archiveSha],
    );
    await db.query(
      `INSERT INTO historical_user_partial_read_reservations(
         token,export_id,preflight_id,original_github_user_id,archive_sha256,archive_byte_length
       ) VALUES($1,$2,$3,$4,$5,2048)`,
      [randomUUID(), exportId, preflightId, numericUser, archiveSha],
    );
    expect(await assessHistoricalUserPrivateLifecycleCandidates(db, authorities)).toEqual({
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
      competingOrUnboundInstallationIdentity: false,
      conflictingOriginalNumericIdDetected: false,
      exportReservationTenantMismatchDetected: false,
      candidateCounts: {
        artifactExportCopyReservations: 1,
        tenantLoginOnlyUnlinkFences: 1,
        legacyArchiveCommitments: 1,
        liveOAuthProofs: 1,
        oauthChallenges: 1,
        partialCleanupEvents: 1,
        partialReadReservations: 1,
        privateDeliveryPreflights: 1,
        privatePreflightEvents: 1,
      },
    });
    await db.query(
      `INSERT INTO installations(id,github_installation_id,account_login,account_type,account_user_id,suspended_at)
       VALUES($1,$2,$3,'User',$4,NOW())`,
      [foreignInstallationId, externalInstallation(), tenant, anotherUser],
    );
    expect(await assessHistoricalUserPrivateLifecycleCandidates(db, authorities)).toMatchObject({
      competingOrUnboundInstallationIdentity: true,
      customerDeliveryAllowed: false,
      historicalTenantLoginIsNotIdentity: true,
    });
    expect(
      await assessHistoricalUserPrivateLifecycleCandidates(db, {
        exportId,
        verifiedGitHubUserId: anotherUser,
      }),
    ).toBeNull();
  });

  it("vetoes any active hold or non-dry-run erasure before reading control evidence", async () => {
    if (!db) throw new Error("Disposable PostgreSQL required");
    const holdId = randomUUID();
    const erasureId = randomUUID();
    try {
      await db.query(
        `INSERT INTO legal_holds(id,tenant_id,created_by,reason,scope,scope_id,active)
         VALUES($1,$2,'synthetic','Private customer disclosure hold','user',$2,TRUE)`,
        [holdId, tenant],
      );
      expect(await assessHistoricalUserPrivateLifecycleCandidates(db, authorities)).toBeNull();
      await db.query("UPDATE legal_holds SET active=FALSE WHERE id=$1", [holdId]);
      await db.query(
        `INSERT INTO erasure_requests(id,tenant_id,requested_by,scope,scope_id,status,dry_run)
         VALUES($1,$2,'synthetic','user',$2,'running',FALSE)`,
        [erasureId, tenant],
      );
      expect(await assessHistoricalUserPrivateLifecycleCandidates(db, authorities)).toBeNull();
      await db.query("UPDATE erasure_requests SET status='preview',dry_run=TRUE WHERE id=$1", [erasureId]);
      expect(await assessHistoricalUserPrivateLifecycleCandidates(db, authorities)).toMatchObject({
        customerDeliveryAllowed: false,
        completeCustomerExport: false,
      });
    } finally {
      await db.query("DELETE FROM erasure_requests WHERE id=$1", [erasureId]);
      await db.query("DELETE FROM legal_holds WHERE id=$1", [holdId]);
    }
  });

  it("denies cross-tenant reservation replay rather than attributing private bytes to a matching export UUID", async () => {
    if (!db) throw new Error("Disposable PostgreSQL required");
    const reservation = randomUUID();
    await db.query(
      `INSERT INTO artifact_export_copy_reservations(token,export_id,artifact_id,tenant_key,storage_path,worker_id)
       VALUES($1,$2,$3,$4,'private-other-source','synthetic-worker')`,
      [reservation, exportId, randomUUID(), ["other-", tenant].join("")],
    );
    expect(await assessHistoricalUserPrivateLifecycleCandidates(db, authorities)).toBeNull();
    await db.query("DELETE FROM artifact_export_copy_reservations WHERE token=$1", [reservation]);
    expect(await assessHistoricalUserPrivateLifecycleCandidates(db, authorities)).toMatchObject({
      customerDeliveryAllowed: false,
      conflictingOriginalNumericIdDetected: false,
    });
  });

  it("denies an immutable OAuth challenge for a different numeric GitHub USER on the same export", async () => {
    if (!db) throw new Error("Disposable PostgreSQL required");
    const isolatedTenant = ["historical-mismatch-", randomUUID().slice(0, 10)].join("");
    const isolatedExport = randomUUID();
    await db.query(
      `INSERT INTO installations(id,github_installation_id,account_login,account_type,account_user_id,suspended_at)
       VALUES($1,$2,$3,'User',$4,NOW())`,
      [randomUUID(), externalInstallation(), isolatedTenant, numericUser],
    );
    await db.query(
      `INSERT INTO data_exports(id,tenant_id,requested_by,status,scope,scope_id,original_github_user_id)
       VALUES($1,$2,'github_app_uninstall','pending','user',$2,$3)`,
      [isolatedExport, isolatedTenant, numericUser],
    );
    await db.query(
      `INSERT INTO historical_user_oauth_challenges(
         state_sha256,export_id,original_github_user_id,expires_at
       ) VALUES($1,$2,$3,NOW()+INTERVAL '2 minutes')`,
      ["d".repeat(64), isolatedExport, anotherUser],
    );
    expect(
      await assessHistoricalUserPrivateLifecycleCandidates(db, {
        exportId: isolatedExport,
        verifiedGitHubUserId: numericUser,
      }),
    ).toBeNull();
  });

  it("rejects a tenant with 101 unresolved unlink fences instead of silently truncating", async () => {
    if (!db) throw new Error("Disposable PostgreSQL required");
    await db.query(
      `INSERT INTO artifact_unlink_fences(token,deletion_job_id,tenant_key,worker_id)
       SELECT gen_random_uuid(),gen_random_uuid()::text,$1,'synthetic-overflow-worker'
       FROM generate_series(1,100)`,
      [tenant],
    );
    expect(await assessHistoricalUserPrivateLifecycleCandidates(db, authorities)).toBeNull();
  });
});
