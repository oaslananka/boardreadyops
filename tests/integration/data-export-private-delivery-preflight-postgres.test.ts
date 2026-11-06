import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  prepareHistoricalUserPartialArchive,
  prepareVerifiedHistoricalUserMetadataOnlyArchive,
  verifyHistoricalUserMetadataOnlyArchive,
  verifyHistoricalUserPartialArchive,
} from "../../apps/web/lib/data-export-historical-archive.js";
import { assessHistoricalUserPrivateArchiveDisclosure } from "../../apps/web/lib/data-export-historical-disclosure-readiness.js";
import { stageLiveGitHubVerifiedHistoricalPrivatePreflight } from "../../apps/web/lib/data-export-historical-live-oauth.js";
import { cleanupHistoricalUserPrivatePartial } from "../../apps/web/lib/data-export-historical-partial-cleanup.js";
import { verifyReservedHistoricalUserPrivatePartial } from "../../apps/web/lib/data-export-historical-partial-read.js";
import { sealHistoricalUserPrivatePartial } from "../../apps/web/lib/data-export-historical-partial-storage.js";
import {
  inspectVerifiedHistoricalUserPrivateArchivePreflight,
  stageVerifiedHistoricalUserPrivateArchivePreflight,
} from "../../apps/web/lib/data-export-historical-private-preflight.js";
import {
  inspectSessionBoundHistoricalUserPrivatePreflight,
  revokeSessionBoundHistoricalUserPrivatePreflight,
  stageSessionBoundHistoricalUserPrivatePreflight,
} from "../../apps/web/lib/data-export-historical-signed-session.js";
import { encodeUserSession } from "../../apps/web/lib/user-session.js";
import { sanitizeAndExtractArchive } from "../../packages/cloud-core/src/archive-sanitizer.js";
import { prepareVerifiedHistoricalUserCompositePreflight } from "../../packages/db/src/data-export-historical-inventory.js";
import {
  releaseHistoricalUserPrivatePartialRead,
  reserveHistoricalUserPrivatePartialRead,
} from "../../packages/db/src/data-export-historical-partial-read.js";
import { assessHistoricalUserPrivateReadRecovery } from "../../packages/db/src/data-export-historical-partial-recovery.js";
import {
  inspectHistoricalUserPrivateDeliveryPreflight,
  revokeHistoricalUserPrivateDeliveryPreflight,
  stageHistoricalUserPrivateDeliveryPreflight,
} from "../../packages/db/src/data-export-historical-private-preflight.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";
import { createZipBuffer } from "../../src/util/zip.js";

const connectionString = getPostgresTestConnectionString();
const describeDb = connectionString ? describe : describe.skip;
const db = connectionString ? createPgQueryExecutor({ connectionString, max: 4 }) : null;
const installationId = randomUUID();
const repositoryId = randomUUID();
const expiringInstallationId = randomUUID();
const exportId = randomUUID();
const liveExportId = randomUUID();
const expiringExportId = randomUUID();
const holdId = randomUUID();
const erasureId = randomUUID();
const tenant = `private-preflight-${randomUUID()}`;
const expiringTenant = ["private-expiry", randomUUID()].join("-");
const liveTenant = ["private-live-reauth", randomUUID()].join("-");
const liveInstallationId = randomUUID();
const githubUserId = 9_235_789_401;
const liveGithubUserId = githubUserId + 23;
const authority = { exportId, verifiedGitHubUserId: githubUserId };
const sessionSecret = "private-historical-user-fixture-secret-2026-".repeat(2);
const signingEnvironment = { SESSION_SECRET: sessionSecret };
function recentOAuthSession(userId = githubUserId) {
  const now = new Date();
  const issuedAt = new Date(now.getTime() - 1000);
  return {
    now,
    environment: signingEnvironment,
    sessionCookie: encodeUserSession(
      {
        userId,
        login: "reused-original-login",
        installationIds: [], // original GitHub App already uninstalled
        issuedAt: issuedAt.toISOString(),
        expiresAt: new Date(issuedAt.getTime() + 8 * 60 * 60 * 1000).toISOString(),
      },
      sessionSecret,
    ),
  };
}

const expiringAuthority = { exportId: expiringExportId, verifiedGitHubUserId: githubUserId + 9 };
const fingerprints = {
  archiveSha256: "a".repeat(64),
  archiveByteLength: 423,
  coreSha256: "b".repeat(64),
  visualSha256: "c".repeat(64),
  mutationEpochSha256: "d".repeat(64),
};
let preflightId = "";
let verifiedArchiveBytes: Buffer = Buffer.alloc(0);
let liveVerifiedArchiveBytes: Buffer = Buffer.alloc(0);
let pendingPrivateReader: { token: string; preflightId: string; sha256: string; byteLength: number } | null = null;

function executor() {
  if (!db) throw new Error("Disposable PostgreSQL required");
  return db;
}
async function rows(sql: string, params: unknown[] = []) {
  const result = await executor().query(sql, params);
  return (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
}

beforeAll(async () => {
  if (!db) return;
  await executor().query(
    "INSERT INTO installations(id,github_installation_id,account_login,account_type,account_user_id,suspended_at) VALUES($1,$2,$3,'User',$4,NOW())",
    [installationId, Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16), tenant, githubUserId],
  );
  await executor().query(
    "INSERT INTO installations(id,github_installation_id,account_login,account_type,account_user_id,suspended_at) VALUES($1,$2,$3,'User',$4,NOW())",
    [
      expiringInstallationId,
      Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16),
      expiringTenant,
      githubUserId + 9,
    ],
  );
  await executor().query(
    "INSERT INTO data_exports(id,tenant_id,requested_by,status,scope,scope_id,original_github_user_id) VALUES($1,$2,'github_app_uninstall','pending','user',$2,$3),($4,$5,'github_app_uninstall','pending','user',$5,$6)",
    [exportId, tenant, githubUserId, expiringExportId, expiringTenant, githubUserId + 9],
  );
  await executor().query(
    "INSERT INTO repositories(id,installation_id,github_repo_id,owner,name,default_branch,disabled_at) VALUES($1,$2,$3,$4,'original-preflight-repo','main',NOW())",
    [repositoryId, installationId, Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16), tenant],
  );
  // Independent suspended GitHub USER/tenant fixture respects the
  // unique active uninstall-export constraint; no duplicate or bypass.
  await executor().query(
    "INSERT INTO installations(id,github_installation_id,account_login,account_type,account_user_id,suspended_at) VALUES($1,$2,$3,'User',$4,NOW())",
    [
      liveInstallationId,
      Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16),
      liveTenant,
      liveGithubUserId,
    ],
  );
  await executor().query(
    "INSERT INTO data_exports(id,tenant_id,requested_by,status,scope,scope_id,original_github_user_id) VALUES($1,$2,'github_app_uninstall','pending','user',$2,$3)",
    [liveExportId, liveTenant, liveGithubUserId],
  );
  const liveInitial = await prepareVerifiedHistoricalUserCompositePreflight(executor(), {
    exportId: liveExportId,
    verifiedGitHubUserId: liveGithubUserId,
  });
  if (!liveInitial) throw new Error("Missing fresh OAuth original USER export fixture");
  liveVerifiedArchiveBytes = prepareHistoricalUserPartialArchive({
    snapshot: liveInitial.core,
    visualEvidence: liveInitial.visual,
    verifiedObjects: [],
    mutationEpochSha256: liveInitial.mutationEpochSha256,
  }).bytes;
  const initial = await prepareVerifiedHistoricalUserCompositePreflight(executor(), authority);
  if (!initial) throw new Error("Missing original user preflight fixture");
  fingerprints.coreSha256 = initial.core.sha256;
  fingerprints.visualSha256 = initial.visual.sha256;
  fingerprints.mutationEpochSha256 = initial.mutationEpochSha256;
  const archive = prepareHistoricalUserPartialArchive({
    snapshot: initial.core,
    visualEvidence: initial.visual,
    verifiedObjects: [],
    mutationEpochSha256: initial.mutationEpochSha256,
  });
  verifiedArchiveBytes = archive.bytes;
  fingerprints.archiveSha256 = archive.sha256;
  fingerprints.archiveByteLength = archive.byteLength;
});

afterAll(async () => {
  if (!db) return;
  try {
    await executor().query("DELETE FROM legal_holds WHERE id=$1", [holdId]);
    await executor().query("DELETE FROM erasure_requests WHERE id=$1", [erasureId]);
    await executor().query("DELETE FROM data_exports WHERE id IN ($1,$2,$3)", [
      exportId,
      expiringExportId,
      liveExportId,
    ]);
    await executor().query("DELETE FROM installations WHERE id=$1", [installationId]);
    await executor().query("DELETE FROM installations WHERE id=$1", [expiringInstallationId]);
    await executor().query("DELETE FROM installations WHERE id=$1", [liveInstallationId]);
  } finally {
    await executor().close();
  }
});

describeDb("original USER private non-customer delivery preflight", () => {
  it("builds three-file metadata-only ZIP for exact original numeric USER without file access", async () => {
    const result = await prepareVerifiedHistoricalUserMetadataOnlyArchive({
      db: executor(),
      authority,
    });
    expect(result).not.toBeNull();
    if (!result) throw new Error("Missing original USER metadata-only ZIP");
    expect(result.files).toBe(3);
    expect(verifyHistoricalUserMetadataOnlyArchive(result.bytes, result.sha256, exportId)).toBe(true);
    expect(verifyHistoricalUserPartialArchive(result.bytes, result.sha256, exportId)).toBe(false);
    const files = sanitizeAndExtractArchive(result.bytes).files;
    expect(files).toHaveLength(3);
    expect(files.map((item) => item.path).sort()).toEqual([
      "metadata/historical-core.json",
      "metadata/historical-metadata-only-integrity.json",
      "metadata/historical-private-visual-evidence.json",
    ]);
    const core = files.find((item) => item.path === "metadata/historical-core.json");
    const receiptFile = files.find((item) => item.path === "metadata/historical-metadata-only-integrity.json");
    expect(core).toBeDefined();
    expect(receiptFile).toBeDefined();
    const parsedCore = JSON.parse(core?.data.toString("utf8") ?? "{}");
    const receipt = JSON.parse(receiptFile?.data.toString("utf8") ?? "{}");
    expect(parsedCore).toMatchObject({
      exportId,
      completeCustomerExport: false,
      repositories: [{ repositoryId, owner: "", name: "" }],
    });
    expect(receipt).toMatchObject({
      artifactDescriptorCount: 0,
      physicalArtifactContentsIncluded: false,
      privateVisualContentsIncluded: false,
      customerDeliveryReady: false,
      completeCustomerExport: false,
      originalUserMutationEpochSha256: fingerprints.mutationEpochSha256,
    });
    expect(JSON.stringify(parsedCore)).not.toContain(tenant);
    expect(JSON.stringify(parsedCore)).not.toContain("original-preflight-repo");
    expect(
      await prepareVerifiedHistoricalUserMetadataOnlyArchive({
        db: executor(),
        authority: { exportId, verifiedGitHubUserId: githubUserId + 9 },
      }),
    ).toBeNull();
    expect(
      await prepareVerifiedHistoricalUserMetadataOnlyArchive({
        db: executor(),
        authority: { exportId: expiringExportId, verifiedGitHubUserId: githubUserId },
      }),
    ).toBeNull();
    expect(verifyHistoricalUserMetadataOnlyArchive(result.bytes, result.sha256, expiringExportId)).toBe(false);
  });

  it("produces a count-only disclosure diagnostic from real original USER PostgreSQL ZIP", () => {
    const report = assessHistoricalUserPrivateArchiveDisclosure({
      archiveBytes: verifiedArchiveBytes,
      exportId,
    });
    expect(report).toMatchObject({
      privateDiagnosticOnly: true,
      customerDeliveryReady: false,
      completeCustomerExport: false,
      verifiedArchiveSha256: fingerprints.archiveSha256,
      sourceRowCounts: { repositories: 1, runs: 0, artifacts: 0 },
      excludedSensitiveSourceCounts: { runSnapshots: 0 },
    });
    expect(report?.formatVersion).toBe(2);
    expect(report?.releaseDecision).toBe("NO_GO");
    expect(report?.textRightsAcceptance).toHaveLength(6);
    expect(
      report?.textRightsAcceptance.every(
        (r) => r.customerDisclosureAllowed === false && r.authorProvenanceVerified === false,
      ),
    ).toBe(true);
    expect(report?.deliveryAcceptance).toHaveLength(8);
    expect(
      report?.deliveryAcceptance.every(
        (r) => r.evidenceStatus === "not_verified" && r.customerDeliveryAllowed === false,
      ),
    ).toBe(true);
    expect(report?.blockers).toContain("partial_source_coverage");
    expect(report?.blockers).toContain("third_party_content_disclosure_rights_unverified");
    expect(report?.blockers).toContain("no_in_flight_revocation_hold_erasure_acceptance");
    expect(JSON.stringify(report)).not.toContain(tenant);
    expect(JSON.stringify(report)).not.toContain(repositoryId);
    expect(JSON.stringify(report)).not.toContain("original-preflight-repo");
    expect(
      assessHistoricalUserPrivateArchiveDisclosure({
        archiveBytes: verifiedArchiveBytes,
        exportId: expiringExportId,
      }),
    ).toBeNull();
  });

  it("stages only the numeric original owner with immutable hashes and customer delivery permanently denied", async () => {
    expect(
      await stageHistoricalUserPrivateDeliveryPreflight({
        db: executor(),
        authority: { exportId, verifiedGitHubUserId: githubUserId + 1 },
        fingerprint: fingerprints,
        ttlSeconds: 60,
      }),
    ).toBeNull();
    expect(
      await stageHistoricalUserPrivateDeliveryPreflight({
        db: executor(),
        authority,
        fingerprint: { ...fingerprints, coreSha256: "invalid" },
        ttlSeconds: 60,
      }),
    ).toBeNull();
    expect(
      await stageHistoricalUserPrivateDeliveryPreflight({
        db: executor(),
        authority,
        fingerprint: fingerprints,
        ttlSeconds: 601,
      }),
    ).toBeNull();

    expect(
      await stageVerifiedHistoricalUserPrivateArchivePreflight({
        db: executor(),
        authority,
        archiveBytes: Buffer.from("forged-historical-zip"),
        ttlSeconds: 60,
      }),
    ).toBeNull();
    const tampered = Buffer.from(verifiedArchiveBytes);
    // Alter the first ZIP entry's compressed metadata payload (not an
    // irrelevant ZIP header flag): the canonical receipt must fail.
    const fileNameLength = tampered.readUInt16LE(26);
    const extraLength = tampered.readUInt16LE(28);
    const dataOffset = 30 + fileNameLength + extraLength;
    expect(dataOffset + 4).toBeLessThan(tampered.length);
    tampered[dataOffset + 3] = (tampered[dataOffset + 3] ?? 0) ^ 0xff;
    expect(
      await stageVerifiedHistoricalUserPrivateArchivePreflight({
        db: executor(),
        authority,
        archiveBytes: tampered,
        ttlSeconds: 60,
      }),
    ).toBeNull();

    // An attacker may recalculate every ZIP digest after injecting an
    // unforeseen private field. Byte integrity alone must not promote that
    // content into this trusted original-USER private archive boundary.
    const injectedEntries = sanitizeAndExtractArchive(verifiedArchiveBytes).files.map((entry) => ({
      name: entry.path,
      data: Buffer.from(entry.data),
    }));
    const coreEntry = injectedEntries.find((entry) => entry.name === "metadata/historical-core.json");
    const integrityEntry = injectedEntries.find((entry) => entry.name === "metadata/historical-integrity.json");
    if (!coreEntry || !integrityEntry) throw new Error("Missing original private fixture metadata");
    const injectedCore = JSON.parse(coreEntry.data.toString("utf8")) as Record<string, unknown>;
    injectedCore.originalUserOauthToken = "private-token-never-export";
    coreEntry.data = Buffer.from(JSON.stringify(injectedCore));
    const injectedReceipt = JSON.parse(integrityEntry.data.toString("utf8")) as {
      entries: Array<{ path: string; sha256: string; byteLength: number }>;
    };
    const originalMetadataEntry = injectedReceipt.entries.find((entry) => entry.path === coreEntry.name);
    if (!originalMetadataEntry) throw new Error("Missing original metadata digest");
    originalMetadataEntry.sha256 = createHash("sha256").update(coreEntry.data).digest("hex");
    originalMetadataEntry.byteLength = coreEntry.data.length;
    integrityEntry.data = Buffer.from(JSON.stringify(injectedReceipt));
    const injectedZip = createZipBuffer(injectedEntries);
    const injectedZipSha = createHash("sha256").update(injectedZip).digest("hex");
    expect(verifyHistoricalUserPartialArchive(injectedZip, injectedZipSha, exportId)).toBe(false);
    expect(
      assessHistoricalUserPrivateArchiveDisclosure({
        archiveBytes: injectedZip,
        exportId,
      }),
    ).toBeNull();
    expect(
      await stageVerifiedHistoricalUserPrivateArchivePreflight({
        db: executor(),
        authority,
        archiveBytes: injectedZip,
        ttlSeconds: 60,
      }),
    ).toBeNull();

    const forgedEntries = sanitizeAndExtractArchive(verifiedArchiveBytes).files.map((entry) => {
      if (entry.path !== "metadata/historical-integrity.json") {
        return { name: entry.path, data: entry.data };
      }
      const receipt = JSON.parse(entry.data.toString("utf8")) as Record<string, unknown>;
      receipt.originalUserMutationEpochSha256 = "e".repeat(64);
      return { name: entry.path, data: Buffer.from(JSON.stringify(receipt)) };
    });
    const forgedSelfConsistentZip = createZipBuffer(forgedEntries);
    const forgedSelfConsistentHash = createHash("sha256").update(forgedSelfConsistentZip).digest("hex");
    // A self-consistent ZIP and receipt are insufficient without the
    // original suspended USER's actual committed mutation epoch.
    expect(verifyHistoricalUserPartialArchive(forgedSelfConsistentZip, forgedSelfConsistentHash, exportId)).toBe(true);
    expect(
      await stageVerifiedHistoricalUserPrivateArchivePreflight({
        db: executor(),
        authority,
        archiveBytes: forgedSelfConsistentZip,
        ttlSeconds: 60,
      }),
    ).toBeNull();

    // Signed, RECENT GitHub OAuth is necessary before this private stage.
    // A recycled login from a different numeric GitHub USER must not work.
    expect(
      await stageSessionBoundHistoricalUserPrivatePreflight({
        db: executor(),
        exportId,
        ...recentOAuthSession(githubUserId + 1),
        archiveBytes: verifiedArchiveBytes,
        ttlSeconds: 60,
      }),
    ).toBeNull();
    expect(
      await stageSessionBoundHistoricalUserPrivatePreflight({
        db: executor(),
        exportId,
        ...recentOAuthSession(),
        sessionCookie: "forged-signed-session",
        archiveBytes: verifiedArchiveBytes,
        ttlSeconds: 60,
      }),
    ).toBeNull();
    const staged = await stageSessionBoundHistoricalUserPrivatePreflight({
      db: executor(),
      exportId,
      ...recentOAuthSession(),
      archiveBytes: verifiedArchiveBytes,
      ttlSeconds: 60,
    });
    expect(staged?.id).toMatch(/^[0-9a-f-]{36}$/u);
    if (!staged) throw new Error("Missing private staged record");
    preflightId = staged.id;
    expect(
      await inspectVerifiedHistoricalUserPrivateArchivePreflight({
        db: executor(),
        authority,
        id: preflightId,
        archiveBytes: verifiedArchiveBytes,
      }),
    ).toBe("current");
    expect(
      await inspectVerifiedHistoricalUserPrivateArchivePreflight({
        db: executor(),
        authority,
        id: preflightId,
        archiveBytes: Buffer.from("invalid ZIP"),
      }),
    ).toBe("stale");
    expect(
      await stageHistoricalUserPrivateDeliveryPreflight({
        db: executor(),
        authority,
        fingerprint: fingerprints,
        ttlSeconds: 60,
      }),
    ).toBeNull();
    expect(
      await inspectHistoricalUserPrivateDeliveryPreflight({
        db: executor(),
        authority,
        id: preflightId,
        fingerprint: fingerprints,
      }),
    ).toBe("current");
    expect(
      await inspectHistoricalUserPrivateDeliveryPreflight({
        db: executor(),
        authority,
        id: preflightId,
        fingerprint: { ...fingerprints, archiveSha256: "f".repeat(64) },
      }),
    ).toBe("stale");
    expect(
      await inspectHistoricalUserPrivateDeliveryPreflight({
        db: executor(),
        authority: { exportId, verifiedGitHubUserId: githubUserId + 1 },
        id: preflightId,
        fingerprint: fingerprints,
      }),
    ).toBe("stale");
    const recorded = await rows(
      "SELECT customer_delivery_allowed,complete_customer_export,purpose,revoked_at,expires_at>clock_timestamp() AS active FROM historical_user_private_delivery_preflights WHERE id=$1",
      [preflightId],
    );
    expect(recorded).toEqual([
      expect.objectContaining({
        customer_delivery_allowed: false,
        complete_customer_export: false,
        purpose: "private-source-only-preflight",
        revoked_at: null,
        active: true,
      }),
    ]);
    expect(
      await rows("SELECT event_type FROM historical_user_private_preflight_events WHERE preflight_id=$1", [
        preflightId,
      ]),
    ).toEqual([{ event_type: "staged" }]);
    await expect(
      executor().query(
        "UPDATE historical_user_private_delivery_preflights SET expected_archive_sha256=$1 WHERE id=$2",
        ["f".repeat(64), preflightId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      executor().query(
        "UPDATE historical_user_private_delivery_preflights SET customer_delivery_allowed=TRUE WHERE id=$1",
        [preflightId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      executor().query("DELETE FROM historical_user_private_preflight_events WHERE preflight_id=$1", [preflightId]),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("authenticates private inspect using RECENT signed numeric OAuth identity, never installed App membership or mutable login", async () => {
    const checked = {
      db: executor(),
      exportId,
      id: preflightId,
      archiveBytes: verifiedArchiveBytes,
    };
    expect(
      await inspectSessionBoundHistoricalUserPrivatePreflight({
        ...checked,
        ...recentOAuthSession(),
      }),
    ).toBe("current");
    expect(
      await inspectSessionBoundHistoricalUserPrivatePreflight({
        ...checked,
        ...recentOAuthSession(githubUserId + 1),
      }),
    ).toBe("stale");
    expect(
      await inspectSessionBoundHistoricalUserPrivatePreflight({
        ...checked,
        ...recentOAuthSession(),
        sessionCookie: "forged-session",
      }),
    ).toBe("stale");
    const staleSignedIn = recentOAuthSession();
    const oldIssuedAt = new Date(staleSignedIn.now.getTime() - 6 * 60 * 1000);
    expect(
      await inspectSessionBoundHistoricalUserPrivatePreflight({
        ...checked,
        ...staleSignedIn,
        sessionCookie: encodeUserSession(
          {
            userId: githubUserId,
            login: "reused-original-login",
            installationIds: [],
            issuedAt: oldIssuedAt.toISOString(),
            expiresAt: new Date(oldIssuedAt.getTime() + 8 * 60 * 60 * 1000).toISOString(),
          },
          sessionSecret,
        ),
      }),
    ).toBe("stale");
  });

  it("stops staged private checks while legal hold or real erasure is active", async () => {
    await executor().query(
      "INSERT INTO legal_holds(id,tenant_id,created_by,reason,scope,scope_id) VALUES($1,$2,'test','preserve historical export','user',$2)",
      [holdId, tenant],
    );
    try {
      expect(
        await inspectHistoricalUserPrivateDeliveryPreflight({
          db: executor(),
          authority,
          id: preflightId,
          fingerprint: fingerprints,
        }),
      ).toBe("stale");
    } finally {
      await executor().query("DELETE FROM legal_holds WHERE id=$1", [holdId]);
    }
    expect(
      await inspectHistoricalUserPrivateDeliveryPreflight({
        db: executor(),
        authority,
        id: preflightId,
        fingerprint: fingerprints,
      }),
    ).toBe("current");
    await executor().query(
      "INSERT INTO erasure_requests(id,tenant_id,requested_by,scope,scope_id,status,dry_run) VALUES($1,$2,'test','user',$2,'running',FALSE)",
      [erasureId, tenant],
    );
    try {
      expect(
        await inspectHistoricalUserPrivateDeliveryPreflight({
          db: executor(),
          authority,
          id: preflightId,
          fingerprint: fingerprints,
        }),
      ).toBe("stale");
    } finally {
      await executor().query("DELETE FROM erasure_requests WHERE id=$1", [erasureId]);
    }
    expect(
      await inspectHistoricalUserPrivateDeliveryPreflight({
        db: executor(),
        authority,
        id: preflightId,
        fingerprint: fingerprints,
      }),
    ).toBe("current");
  });

  it("expires a second private candidate without any customer publication capability", async () => {
    const expiringSnapshot = await prepareVerifiedHistoricalUserCompositePreflight(executor(), expiringAuthority);
    if (!expiringSnapshot) throw new Error("Missing other numeric USER fixture");
    const expiringFingerprint = {
      ...fingerprints,
      coreSha256: expiringSnapshot.core.sha256,
      visualSha256: expiringSnapshot.visual.sha256,
      mutationEpochSha256: expiringSnapshot.mutationEpochSha256,
    };
    const temporary = await stageHistoricalUserPrivateDeliveryPreflight({
      db: executor(),
      authority: expiringAuthority,
      fingerprint: expiringFingerprint,
      ttlSeconds: 1,
    });
    expect(temporary).not.toBeNull();
    if (!temporary) throw new Error("Missing expiring private candidate");
    await executor().query("SELECT pg_sleep(1.1)");
    expect(
      await inspectHistoricalUserPrivateDeliveryPreflight({
        db: executor(),
        authority: expiringAuthority,
        id: temporary.id,
        fingerprint: expiringFingerprint,
      }),
    ).toBe("stale");
  });

  it("requires a live GitHub OAuth /user match, export-bound CSRF state and exact original USER before any private stage", async () => {
    const csrfState = "G".repeat(48);
    const callbackState = csrfState;
    const oauthStateCookie = `${csrfState}.${encodeURIComponent(`/dashboard?historical_user_export=${liveExportId}`)}`;
    const liveOAuthFetch = (liveUserId: number) =>
      (async (url: string | URL | Request) => {
        const endpoint = String(url);
        if (endpoint === "https://github.com/login/oauth/access_token")
          return new Response(JSON.stringify({ access_token: "ephemeral-fixture-token" }));
        if (endpoint === "https://api.github.com/user")
          return new Response(JSON.stringify({ id: liveUserId, login: "reused-original-login" }));
        if (endpoint.startsWith("https://api.github.com/user/installations?"))
          return new Response(JSON.stringify({ installations: [] }));
        throw new Error("Unexpected external endpoint");
      }) as typeof fetch;
    const data = {
      db: executor(),
      exportId: liveExportId,
      ...recentOAuthSession(liveGithubUserId),
      environment: {
        ...signingEnvironment,
        GITHUB_CLIENT_ID: "Iv1.test-app",
        GITHUB_CLIENT_SECRET: "fixture-secret",
        BOARDREADYOPS_PUBLIC_URL: "https://boardreadyops.example/",
      },
      oauthStateCookie,
      callbackState,
      authorizationCode: "one-time-fixture-code",
      archiveBytes: liveVerifiedArchiveBytes,
      ttlSeconds: 60,
    };

    // A recycled login with a DIFFERENT immutable /user numeric ID is not authority.
    expect(
      await stageLiveGitHubVerifiedHistoricalPrivatePreflight({
        ...data,
        fetch: liveOAuthFetch(liveGithubUserId + 1),
      }),
    ).toBeNull();
    expect(
      await stageLiveGitHubVerifiedHistoricalPrivatePreflight({
        ...data,
        callbackState: "H".repeat(48),
        fetch: liveOAuthFetch(liveGithubUserId),
      }),
    ).toBeNull();
    expect(
      await stageLiveGitHubVerifiedHistoricalPrivatePreflight({
        ...data,
        oauthStateCookie: `${csrfState}.${encodeURIComponent(`/dashboard?historical_user_export=${expiringExportId}`)}`,
        fetch: liveOAuthFetch(liveGithubUserId),
      }),
    ).toBeNull();

    const allowed = await stageLiveGitHubVerifiedHistoricalPrivatePreflight({
      ...data,
      fetch: liveOAuthFetch(liveGithubUserId),
    });
    expect(allowed?.id).toMatch(/^[0-9a-f-]{36}$/u);
    if (!allowed) throw new Error("Missing private GitHub reauthenticated preflight");
    const saved = await rows(
      "SELECT customer_delivery_allowed,complete_customer_export,purpose,original_github_user_id FROM historical_user_private_delivery_preflights WHERE id=$1",
      [allowed.id],
    );
    expect(saved).toEqual([
      expect.objectContaining({
        customer_delivery_allowed: false,
        complete_customer_export: false,
        purpose: "private-source-only-preflight",
        original_github_user_id: String(liveGithubUserId),
      }),
    ]);
    const privateRootParent = await mkdtemp(join(tmpdir(), "bro44-private-reader-"));
    const privateRoot = join(privateRootParent, ".private-export-archives");
    const archiveSha256 = createHash("sha256").update(liveVerifiedArchiveBytes).digest("hex");
    const binding = {
      exportId: liveExportId,
      verifiedGitHubUserId: liveGithubUserId,
      preflightId: allowed.id,
      sha256: archiveSha256,
      byteLength: liveVerifiedArchiveBytes.length,
    };
    try {
      await mkdir(privateRoot, { mode: 0o700 });
      const sealed = await sealHistoricalUserPrivatePartial({
        archiveRoot: privateRoot,
        exportId: liveExportId,
        archive: {
          bytes: liveVerifiedArchiveBytes,
          sha256: archiveSha256,
          byteLength: liveVerifiedArchiveBytes.length,
        },
      });
      expect(sealed).not.toBeNull();
      // Real private disk verification requires DB reservation, full ZIP SHA,
      // original numeric USER and CURRENT private preflight.
      expect(
        await verifyReservedHistoricalUserPrivatePartial({
          db: executor(),
          archiveRoot: privateRoot,
          authority: { exportId: liveExportId, verifiedGitHubUserId: liveGithubUserId },
          preflightId: allowed.id,
          sha256: archiveSha256,
          byteLength: liveVerifiedArchiveBytes.length,
        }),
      ).toEqual({
        sha256: archiveSha256,
        byteLength: liveVerifiedArchiveBytes.length,
        completeCustomerExport: false,
        customerDeliveryAllowed: false,
      });
      const accepted = await rows(
        "SELECT released_at,customer_delivery_allowed FROM historical_user_partial_read_reservations WHERE export_id=$1",
        [liveExportId],
      );
      expect(accepted).toEqual([
        {
          released_at: expect.any(Date),
          customer_delivery_allowed: false,
        },
      ]);
      expect(
        await reserveHistoricalUserPrivatePartialRead(executor(), {
          ...binding,
          verifiedGitHubUserId: liveGithubUserId + 1,
        }),
      ).toBeNull();
      expect(
        await reserveHistoricalUserPrivatePartialRead(executor(), {
          ...binding,
          sha256: "0".repeat(64),
        }),
      ).toBeNull();
      expect(
        await reserveHistoricalUserPrivatePartialRead(executor(), {
          ...binding,
          preflightId: randomUUID(),
        }),
      ).toBeNull();
      const pending = await reserveHistoricalUserPrivatePartialRead(executor(), binding);
      expect(pending?.token).toMatch(/^[0-9a-f-]{36}$/u);
      if (!pending) throw new Error("Private ZIP reader reservation was not persisted");
      pendingPrivateReader = {
        ...pending,
        preflightId: allowed.id,
        sha256: archiveSha256,
        byteLength: liveVerifiedArchiveBytes.length,
      };
      expect(
        await rows("SELECT released_at FROM historical_user_partial_read_reservations WHERE token=$1", [pending.token]),
      ).toEqual([{ released_at: null }]);
      const recovery = () =>
        assessHistoricalUserPrivateReadRecovery({
          db: executor(),
          authority: { exportId: liveExportId, verifiedGitHubUserId: liveGithubUserId },
          preflightId: allowed.id,
        });
      expect(await recovery()).toEqual({
        status: "active_export",
        releaseAllowed: false,
        unresolvedReaders: 1,
      });
      expect(
        await assessHistoricalUserPrivateReadRecovery({
          db: executor(),
          authority: { exportId: liveExportId, verifiedGitHubUserId: liveGithubUserId + 1 },
          preflightId: allowed.id,
        }),
      ).toEqual({ status: "unverified", releaseAllowed: false });
    } finally {
      await rm(privateRootParent, { recursive: true, force: true });
    }
    expect(
      await revokeHistoricalUserPrivateDeliveryPreflight({
        db: executor(),
        authority: { exportId: liveExportId, verifiedGitHubUserId: liveGithubUserId },
        id: allowed.id,
      }),
    ).toBe("revoked");
    expect(
      await inspectVerifiedHistoricalUserPrivateArchivePreflight({
        db: executor(),
        authority: { exportId: liveExportId, verifiedGitHubUserId: liveGithubUserId },
        id: allowed.id,
        archiveBytes: liveVerifiedArchiveBytes,
      }),
    ).toBe("stale");
    expect(await reserveHistoricalUserPrivatePartialRead(executor(), binding)).toBeNull();
  });

  it("revokes irreversibly with a durable private audit event, blocking subsequent checks", async () => {
    expect(
      await revokeSessionBoundHistoricalUserPrivatePreflight({
        db: executor(),
        exportId,
        id: preflightId,
        ...recentOAuthSession(githubUserId + 1),
      }),
    ).toBe("stale");
    expect(
      await inspectHistoricalUserPrivateDeliveryPreflight({
        db: executor(),
        authority,
        id: preflightId,
        fingerprint: fingerprints,
      }),
    ).toBe("current");
    await executor().query("UPDATE repositories SET name='changed-private-preflight-repo' WHERE id=$1", [repositoryId]);
    await executor().query("UPDATE repositories SET name='original-preflight-repo' WHERE id=$1", [repositoryId]);
    const restored = await prepareVerifiedHistoricalUserCompositePreflight(executor(), authority);
    expect(restored?.core.sha256).toBe(fingerprints.coreSha256);
    expect(restored?.mutationEpochSha256).not.toBe(fingerprints.mutationEpochSha256);
    expect(
      await inspectVerifiedHistoricalUserPrivateArchivePreflight({
        db: executor(),
        authority,
        id: preflightId,
        archiveBytes: verifiedArchiveBytes,
      }),
    ).toBe("stale");
    expect(
      await inspectHistoricalUserPrivateDeliveryPreflight({
        db: executor(),
        authority,
        id: preflightId,
        fingerprint: fingerprints,
      }),
    ).toBe("stale");
    expect(
      await revokeSessionBoundHistoricalUserPrivatePreflight({
        db: executor(),
        exportId,
        id: preflightId,
        ...recentOAuthSession(),
      }),
    ).toBe("revoked");
    expect(
      await inspectHistoricalUserPrivateDeliveryPreflight({
        db: executor(),
        authority,
        id: preflightId,
        fingerprint: fingerprints,
      }),
    ).toBe("stale");
    expect(
      await revokeHistoricalUserPrivateDeliveryPreflight({
        db: executor(),
        authority,
        id: preflightId,
      }),
    ).toBe("stale");
    expect(
      await rows(
        "SELECT event_type FROM historical_user_private_preflight_events WHERE preflight_id=$1 ORDER BY created_at,id",
        [preflightId],
      ),
    ).toEqual([{ event_type: "staged" }, { event_type: "revoked" }]);
    await expect(
      executor().query("UPDATE historical_user_private_delivery_preflights SET revoked_at=NULL WHERE id=$1", [
        preflightId,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("manually cleans only an immutable revoked original-USER preflight ZIP after terminal expiry with an auditable result", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bro44-cleanup-known-"));
    const archiveRoot = join(parent, ".private-export-archives");
    const liveAuthority = { exportId: liveExportId, verifiedGitHubUserId: liveGithubUserId };
    const file = join(archiveRoot, `${liveExportId}.historical-private-partial-v3.zip`);
    const checksum = createHash("sha256").update(liveVerifiedArchiveBytes).digest("hex");
    const cleanup = (checkedAuthority = liveAuthority) =>
      cleanupHistoricalUserPrivatePartial({ db: executor(), archiveRoot, authority: checkedAuthority });
    const holdId = randomUUID();
    try {
      await mkdir(archiveRoot, { mode: 0o700 });
      const persisted = await sealHistoricalUserPrivatePartial({
        archiveRoot,
        exportId: liveExportId,
        archive: {
          bytes: liveVerifiedArchiveBytes,
          sha256: checksum,
          byteLength: liveVerifiedArchiveBytes.length,
        },
      });
      expect(persisted).toMatchObject({
        completeCustomerExport: false,
        customerDeliveryAllowed: false,
      });
      expect(await cleanup()).toBe("quarantined"); // active export
      expect(await cleanup({ exportId: liveExportId, verifiedGitHubUserId: liveGithubUserId + 1 })).toBe("quarantined");
      expect((await lstat(file)).isFile()).toBe(true);
      const unknownExportId = randomUUID();
      const unknownFile = join(archiveRoot, `${unknownExportId}.historical-private-partial-v3.zip`);
      await writeFile(unknownFile, Buffer.from("unbound private bytes"), { mode: 0o600 });
      try {
        expect(
          await cleanupHistoricalUserPrivatePartial({
            db: executor(),
            archiveRoot,
            authority: { exportId: unknownExportId, verifiedGitHubUserId: liveGithubUserId },
          }),
        ).toBe("quarantined");
        expect((await lstat(unknownFile)).isFile()).toBe(true);
      } finally {
        await rm(unknownFile, { force: true });
      }

      await executor().query(
        "UPDATE data_exports SET status='failed',created_at=NOW()-INTERVAL '2 hours' WHERE id=$1",
        [liveExportId],
      );
      await chmod(archiveRoot, 0o755);
      expect(await cleanup()).toBe("quarantined"); // private root
      await chmod(archiveRoot, 0o700);

      await executor().query(
        "INSERT INTO legal_holds(id,tenant_id,created_by,reason,scope,scope_id) VALUES($1,$2,'test','Historical cleanup hold','user',$2)",
        [holdId, liveTenant],
      );
      expect(await cleanup()).toBe("quarantined");
      expect(
        await assessHistoricalUserPrivateReadRecovery({
          db: executor(),
          authority: { exportId: liveExportId, verifiedGitHubUserId: liveGithubUserId },
          preflightId: pendingPrivateReader?.preflightId ?? randomUUID(),
        }),
      ).toEqual({ status: "legal_hold", releaseAllowed: false });
      await executor().query("DELETE FROM legal_holds WHERE id=$1", [holdId]);

      // A different transaction's UNCOMMITTED hold must be blocked by SHARE NOWAIT.
      let readySignal: () => void = () => undefined;
      let releaseWriter: () => void = () => undefined;
      const ready = new Promise<void>((resolve) => {
        readySignal = resolve;
      });
      const released = new Promise<void>((resolve) => {
        releaseWriter = resolve;
      });
      const writer = executor().withTransaction(async (tx) => {
        await tx.query(
          "INSERT INTO legal_holds(id,tenant_id,created_by,reason,scope,scope_id) VALUES($1,$2,'test','Uncommitted cleanup hold','user',$2)",
          [holdId, liveTenant],
        );
        readySignal();
        await released;
      });
      await ready;
      try {
        expect(await cleanup()).toBe("busy");
        expect(
          await assessHistoricalUserPrivateReadRecovery({
            db: executor(),
            authority: { exportId: liveExportId, verifiedGitHubUserId: liveGithubUserId },
            preflightId: pendingPrivateReader?.preflightId ?? randomUUID(),
          }),
        ).toEqual({ status: "busy", releaseAllowed: false });
      } finally {
        releaseWriter();
        await writer;
      }
      expect(await cleanup()).toBe("quarantined");
      await executor().query("DELETE FROM legal_holds WHERE id=$1", [holdId]);

      // Outstanding physical source readers and running real erasure
      // deny cleanup of the same original numeric USER export.
      const reservation = randomUUID();
      await executor().query(
        "INSERT INTO artifact_export_copy_reservations(token,export_id,artifact_id,tenant_key,storage_path,worker_id) VALUES($1,$2,$3,$4,$5,'test-private-cleanup')",
        [reservation, liveExportId, randomUUID(), liveTenant.toLowerCase(), "artifacts/test-historical-private.bin"],
      );
      expect(await cleanup()).toBe("quarantined");
      await executor().query("UPDATE artifact_export_copy_reservations SET released_at=NOW() WHERE token=$1", [
        reservation,
      ]);
      const realErasureId = randomUUID();
      await executor().query(
        "INSERT INTO erasure_requests(id,tenant_id,requested_by,scope,scope_id,status,dry_run) VALUES($1,$2,'test','user',$2,'running',FALSE)",
        [realErasureId, liveTenant],
      );
      try {
        expect(await cleanup()).toBe("quarantined");
        expect(
          await assessHistoricalUserPrivateReadRecovery({
            db: executor(),
            authority: { exportId: liveExportId, verifiedGitHubUserId: liveGithubUserId },
            preflightId: pendingPrivateReader?.preflightId ?? randomUUID(),
          }),
        ).toEqual({ status: "real_erasure", releaseAllowed: false });
      } finally {
        await executor().query("DELETE FROM erasure_requests WHERE id=$1", [realErasureId]);
      }

      // Original private reader began before revocation, survived it,
      // and must still protect the file after the original export failed.
      if (!pendingPrivateReader) throw new Error("Pending original-user private read missing");
      const readerBinding = {
        exportId: liveExportId,
        verifiedGitHubUserId: liveGithubUserId,
        preflightId: pendingPrivateReader.preflightId,
        sha256: pendingPrivateReader.sha256,
        byteLength: pendingPrivateReader.byteLength,
      };
      expect(await cleanup()).toBe("quarantined");
      const recoveryBinding = {
        authority: { exportId: liveExportId, verifiedGitHubUserId: liveGithubUserId },
        preflightId: readerBinding.preflightId,
      };
      const assessment = await assessHistoricalUserPrivateReadRecovery({
        db: executor(),
        ...recoveryBinding,
      });
      expect(assessment).toMatchObject({
        status: "manual_host_review",
        releaseAllowed: false,
        unresolvedReaders: 1,
        workerLivenessProven: false,
      });
      if (assessment.status !== "manual_host_review") throw new Error("Expected manual-only unresolved reader review");
      expect(Number.isFinite(Date.parse(assessment.oldestReaderStartedAt))).toBe(true);
      const crossWorkerDb = createPgQueryExecutor({
        connectionString: getPostgresTestConnectionString() ?? "invalid",
        max: 2,
      });
      try {
        expect(
          await cleanupHistoricalUserPrivatePartial({
            db: crossWorkerDb,
            archiveRoot,
            authority: { exportId: liveExportId, verifiedGitHubUserId: liveGithubUserId },
          }),
        ).toBe("quarantined");
        expect((await lstat(file)).isFile()).toBe(true);
        expect(
          await assessHistoricalUserPrivateReadRecovery({
            db: crossWorkerDb,
            ...recoveryBinding,
          }),
        ).toMatchObject({
          status: "manual_host_review",
          releaseAllowed: false,
          unresolvedReaders: 1,
          workerLivenessProven: false,
        });
      } finally {
        await crossWorkerDb.close();
      }
      expect(
        await releaseHistoricalUserPrivatePartialRead(executor(), {
          ...readerBinding,
          token: randomUUID(),
        }),
      ).toBe(false);
      expect(
        await releaseHistoricalUserPrivatePartialRead(executor(), {
          ...readerBinding,
          token: pendingPrivateReader.token,
        }),
      ).toBe(true);
      expect(
        await releaseHistoricalUserPrivatePartialRead(executor(), {
          ...readerBinding,
          token: pendingPrivateReader.token,
        }),
      ).toBe(false);
      await expect(
        executor().query("UPDATE historical_user_partial_read_reservations SET released_at=NULL WHERE token=$1", [
          pendingPrivateReader.token,
        ]),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        executor().query("DELETE FROM historical_user_partial_read_reservations WHERE token=$1", [
          pendingPrivateReader.token,
        ]),
      ).rejects.toMatchObject({ code: "23514" });
      expect(
        await rows("SELECT released_at FROM historical_user_partial_read_reservations WHERE token=$1", [
          pendingPrivateReader.token,
        ]),
      ).toEqual([{ released_at: expect.any(Date) }]);
      expect(
        await assessHistoricalUserPrivateReadRecovery({
          db: executor(),
          ...recoveryBinding,
        }),
      ).toEqual({ status: "no_unresolved", releaseAllowed: false, unresolvedReaders: 0 });

      await writeFile(file, Buffer.from("corrupt-but-still-private"));
      expect(await cleanup()).toBe("quarantined"); // not deleting unknown bytes
      expect((await lstat(file)).isFile()).toBe(true);
      await writeFile(file, liveVerifiedArchiveBytes);
      expect(await cleanup()).toBe("deleted");
      await expect(lstat(file)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await cleanup()).toBe("cleaned");
      expect(
        await rows(
          "SELECT outcome,original_github_user_id,archive_sha256,customer_delivery_allowed FROM historical_user_partial_cleanup_events WHERE export_id=$1",
          [liveExportId],
        ),
      ).toEqual([
        expect.objectContaining({
          outcome: "deleted",
          original_github_user_id: String(liveGithubUserId),
          archive_sha256: checksum,
          customer_delivery_allowed: false,
        }),
      ]);
      await expect(
        executor().query("UPDATE historical_user_partial_cleanup_events SET outcome='missing' WHERE export_id=$1", [
          liveExportId,
        ]),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        executor().query("DELETE FROM historical_user_partial_cleanup_events WHERE export_id=$1", [liveExportId]),
      ).rejects.toMatchObject({ code: "23514" });

      // An independently expired original USER preflight with no matching
      // file yields an immutable 'missing' record, not false deletion.
      await executor().query(
        "UPDATE data_exports SET status='failed',created_at=NOW()-INTERVAL '2 hours' WHERE id=$1",
        [expiringExportId],
      );
      const missing = () =>
        cleanupHistoricalUserPrivatePartial({
          db: executor(),
          archiveRoot,
          authority: expiringAuthority,
        });
      expect(await missing()).toBe("missing");
      expect(await missing()).toBe("cleaned");
      expect(
        await rows(
          "SELECT outcome,customer_delivery_allowed FROM historical_user_partial_cleanup_events WHERE export_id=$1",
          [expiringExportId],
        ),
      ).toEqual([{ outcome: "missing", customer_delivery_allowed: false }]);
    } finally {
      await executor().query("DELETE FROM legal_holds WHERE id=$1", [holdId]);
      await rm(parent, { recursive: true, force: true });
    }
  });
});
