import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assessHistoricalUserHardwareOwnedRowCounts } from "../../packages/db/src/data-export-historical-hardware-owner-counts.js";
import { assessHistoricalUserSourceScope } from "../../packages/db/src/data-export-historical-source-scope.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDb = connectionString ? describe : describe.skip;
const db = connectionString ? createPgQueryExecutor({ connectionString, max: 3 }) : null;
const ids = {
  installation: randomUUID(),
  foreignInstallation: randomUUID(),
  exportId: randomUUID(),
  repository: randomUUID(),
  foreignRepository: randomUUID(),
  run: randomUUID(),
  foreignRun: randomUUID(),
  board: randomUUID(),
  foreignBoard: randomUUID(),
  boardSnapshot: randomUUID(),
  foreignBoardSnapshot: randomUUID(),
  firmwareSnapshot: randomUUID(),
  foreignFirmwareSnapshot: randomUUID(),
  productionBatch: randomUUID(),
  foreignProductionBatch: randomUUID(),
  attempt: randomUUID(),
  foreignAttempt: randomUUID(),
  transition: randomUUID(),
  foreignTransition: randomUUID(),
  finding: randomUUID(),
  foreignFinding: randomUUID(),
  suppression: randomUUID(),
  foreignSuppression: randomUUID(),
  intent: randomUUID(),
  foreignIntent: randomUUID(),
  seal: randomUUID(),
  foreignSeal: randomUUID(),
  sealRun: randomUUID(),
  foreignSealRun: randomUUID(),
  sealAttempt: randomUUID(),
  foreignSealAttempt: randomUUID(),
  artifact: randomUUID(),
  foreignArtifact: randomUUID(),
  workspace: randomUUID(),
  foreignWorkspace: randomUUID(),
  project: randomUUID(),
  foreignProject: randomUUID(),
  revision: randomUUID(),
  foreignRevision: randomUUID(),
  crossBom: randomUUID(),
  crossFirmware: randomUUID(),
  crossFootprint: randomUUID(),
  hold: randomUUID(),
  erasure: randomUUID(),
};
const originalUserId = 9_778_123_457;
const otherUserId = originalUserId + 1;
const owner = `hardware-verified-user-${randomUUID()}`;
const foreignOwner = `hardware-other-user-${randomUUID()}`;
const sha = "a".repeat(40);

function database() {
  if (!db) throw new Error("Disposable PostgreSQL is required");
  return db;
}
const identity = (override?: Partial<{ exportId: string; verifiedGitHubUserId: number }>) => ({
  exportId: ids.exportId,
  verifiedGitHubUserId: originalUserId,
  ...override,
});

beforeAll(async () => {
  if (!db) return;
  await db.query(
    `INSERT INTO installations (id, github_installation_id, account_login, account_type, account_user_id, suspended_at)
     VALUES ($1,$2,$3,'User',$4,now()),($5,$6,$7,'User',$8,now())`,
    [
      ids.installation,
      Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16),
      owner,
      originalUserId,
      ids.foreignInstallation,
      Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16),
      foreignOwner,
      otherUserId,
    ],
  );
  await db.query(
    `INSERT INTO data_exports (id, tenant_id, requested_by, status, scope, scope_id, original_github_user_id)
     VALUES ($1,$2,'github_app_uninstall','pending','user',$2,$3)`,
    [ids.exportId, owner, originalUserId],
  );
  await db.query(
    `INSERT INTO repositories(id, installation_id, github_repo_id, owner, name, default_branch)
     VALUES($1,$2,$3,$4,'pcb', 'main'),($5,$6,$7,$8,'foreign','main')`,
    [
      ids.repository,
      ids.installation,
      Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16),
      owner,
      ids.foreignRepository,
      ids.foreignInstallation,
      Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16),
      foreignOwner,
    ],
  );
  await db.query(
    `INSERT INTO release_runs(id,repository_id,commit_sha,ref,trigger_kind,status)
     VALUES($1,$2,$5,'refs/heads/main','pr','completed'),
           ($3,$4,$5,'refs/heads/main','pr','completed')`,
    [ids.run, ids.repository, ids.foreignRun, ids.foreignRepository, sha],
  );
  await db.query(
    `INSERT INTO boards(id,repository_id,project_path,display_name)
     VALUES($1,$2,'pcb/hardware.kicad_pro','hardware')`,
    [ids.board, ids.repository],
  );
  await db.query(
    `INSERT INTO board_bom_snapshots(id,board_id,run_id,commit_sha)
     VALUES($1,$2,$3,$4)`,
    [ids.boardSnapshot, ids.board, ids.run, sha],
  );
  await db.query(
    `INSERT INTO board_bom_components(id,snapshot_id,reference,value)
     VALUES($1,$2,'R1','10k')`,
    [randomUUID(), ids.boardSnapshot],
  );
  await db.query(
    `INSERT INTO repository_firmware_snapshots(id,repository_id,run_id,commit_sha)
     VALUES($1,$2,$3,$4)`,
    [ids.firmwareSnapshot, ids.repository, ids.run, sha],
  );
  await db.query(
    `INSERT INTO repository_firmware_dependencies(id,snapshot_id,name,manifest_path,origin)
     VALUES($1,$2,'core','src/manifest.json','local')`,
    [randomUUID(), ids.firmwareSnapshot],
  );
  await db.query("INSERT INTO repository_firmware_advisory_watch(repository_id) VALUES ($1)", [ids.repository]);
  // A second original numeric GitHub USER has the same source classes, but
  // NONE of its rows can appear in the first user's count-only diagnostic.
  await db.query(
    "INSERT INTO boards(id,repository_id,project_path,display_name) VALUES($1,$2,'foreign/private.kicad_pro','private')",
    [ids.foreignBoard, ids.foreignRepository],
  );
  await db.query("INSERT INTO board_bom_snapshots(id,board_id,run_id,commit_sha) VALUES($1,$2,$3,$4)", [
    ids.foreignBoardSnapshot,
    ids.foreignBoard,
    ids.foreignRun,
    sha,
  ]);
  await db.query("INSERT INTO board_bom_components(id,snapshot_id,reference,value) VALUES($1,$2,'U1','SECRET')", [
    randomUUID(),
    ids.foreignBoardSnapshot,
  ]);
  await db.query("INSERT INTO repository_firmware_snapshots(id,repository_id,run_id,commit_sha) VALUES($1,$2,$3,$4)", [
    ids.foreignFirmwareSnapshot,
    ids.foreignRepository,
    ids.foreignRun,
    sha,
  ]);
  await db.query(
    "INSERT INTO repository_firmware_dependencies(id,snapshot_id,name,manifest_path,origin) VALUES($1,$2,'secret','private/pom.xml','local')",
    [randomUUID(), ids.foreignFirmwareSnapshot],
  );
  await db.query("INSERT INTO repository_firmware_advisory_watch(repository_id) VALUES ($1)", [ids.foreignRepository]);
  await db.query("INSERT INTO board_supply_watch(board_id) VALUES($1),($2)", [ids.board, ids.foreignBoard]);
  await db.query(
    `INSERT INTO board_supply_findings(id,board_id,mpn,status,severity)
     VALUES($1,$2,'own-part','nrnd','high'),($3,$4,'foreign-part','eol','critical')`,
    [ids.finding, ids.board, ids.foreignFinding, ids.foreignBoard],
  );
  await db.query(
    `INSERT INTO supply_finding_suppressions(id,finding_id,reason,created_by,expires_at)
     VALUES($1,$2,'owned test suppression','owner',now()+interval '1 day'),
           ($3,$4,'foreign suppression','foreign',now()+interval '1 day')`,
    [ids.suppression, ids.finding, ids.foreignSuppression, ids.foreignFinding],
  );
  await db.query(
    `INSERT INTO production_batches(id,release_run_id,external_batch_id,manufacturer,manufactured_on,quantity,source_kind,source_sha256)
     VALUES($1,$2,'own-lot','owned-mfg',DATE '2026-08-05',2,'manual',$5),
           ($3,$4,'foreign-lot','foreign-mfg',DATE '2026-08-05',2,'manual',$5)`,
    [ids.productionBatch, ids.run, ids.foreignProductionBatch, ids.foreignRun, "b".repeat(64)],
  );
  await db.query(
    `INSERT INTO production_batch_defects(production_batch_id,category,code,defect_count)
     VALUES($1,'aoi','owned-defect',1),($2,'aoi','foreign-defect',1)`,
    [ids.productionBatch, ids.foreignProductionBatch],
  );
  await db.query(
    `INSERT INTO release_run_attempts(id,run_id,attempt_number,status)
     VALUES($1,$2,1,'queued'),($3,$4,1,'queued')`,
    [ids.attempt, ids.run, ids.foreignAttempt, ids.foreignRun],
  );
  await db.query(
    `INSERT INTO release_run_results(run_id,execution_attempt_id,contract_version,status,conclusion,payload,result_digest)
     VALUES($1,$2,1,'completed','success','{}'::jsonb,$5),
           ($3,$4,1,'completed','success','{}'::jsonb,$6)`,
    [ids.run, ids.attempt, ids.foreignRun, ids.foreignAttempt, "c".repeat(64), "d".repeat(64)],
  );
  await db.query(
    `INSERT INTO release_run_transition_events(
       id,installation_id,repository_id,release_run_id,entity_type,
       from_status,to_status,from_version,to_version,reason_code)
     VALUES($1,$2,$3,$4,'release_run','queued','running',0,1,'test_transition'),
           ($5,$6,$7,$8,'release_run','queued','running',0,1,'test_transition')`,
    [
      ids.transition,
      ids.installation,
      ids.repository,
      ids.run,
      ids.foreignTransition,
      ids.foreignInstallation,
      ids.foreignRepository,
      ids.foreignRun,
    ],
  );
  await db.query(
    `INSERT INTO protected_release_intent_candidates
       (id,installation_id,repository_id,github_repository_id,actor_github_user_id,actor_login,
        ref,commit_sha,request_id,evidence_digest,observed_at)
     SELECT $1,r.installation_id,r.id,r.github_repo_id,$2,$3,'refs/heads/main',$4,$5,$6,now()
       FROM repositories r WHERE r.id=$7`,
    [ids.intent, originalUserId, "owned-user", sha, "own-release-request", "e".repeat(64), ids.repository],
  );
  await db.query(
    `INSERT INTO protected_release_intent_candidates
       (id,installation_id,repository_id,github_repository_id,actor_github_user_id,actor_login,
        ref,commit_sha,request_id,evidence_digest,observed_at)
     SELECT $1,r.installation_id,r.id,r.github_repo_id,$2,$3,'refs/heads/main',$4,$5,$6,now()
       FROM repositories r WHERE r.id=$7`,
    [
      ids.foreignIntent,
      otherUserId,
      "other-user",
      sha,
      "foreign-release-request",
      "f".repeat(64),
      ids.foreignRepository,
    ],
  );
  await db.query(
    `INSERT INTO protected_release_execution_seals
       (id,candidate_id,installation_id,repository_id,github_repository_id,actor_github_user_id,
        ref,commit_sha,evidence_digest,run_id,execution_attempt_id,snapshot_digest,sealed_at)
     SELECT $1,c.id,c.installation_id,c.repository_id,c.github_repository_id,c.actor_github_user_id,
            c.ref,c.commit_sha,c.evidence_digest,$2,$3,$4,now()
       FROM protected_release_intent_candidates c WHERE c.id=$5`,
    [ids.seal, ids.sealRun, ids.sealAttempt, "1".repeat(64), ids.intent],
  );
  await db.query(
    `INSERT INTO protected_release_execution_seals
       (id,candidate_id,installation_id,repository_id,github_repository_id,actor_github_user_id,
        ref,commit_sha,evidence_digest,run_id,execution_attempt_id,snapshot_digest,sealed_at)
     SELECT $1,c.id,c.installation_id,c.repository_id,c.github_repository_id,c.actor_github_user_id,
            c.ref,c.commit_sha,c.evidence_digest,$2,$3,$4,now()
       FROM protected_release_intent_candidates c WHERE c.id=$5`,
    [ids.foreignSeal, ids.foreignSealRun, ids.foreignSealAttempt, "2".repeat(64), ids.foreignIntent],
  );
  await db.query(
    `INSERT INTO artifacts(id,run_id,execution_attempt_id,kind,name,storage_path,sha256,bytes,role)
     VALUES($1,$2,$3,'archive','manufacturing.tar.gz','private/own.tar.gz',$4,24,'manufacturing'),
           ($5,$6,$7,'archive','foreign-manufacturing.tar.gz','private/foreign.tar.gz',$8,25,'manufacturing')`,
    [
      ids.artifact,
      ids.run,
      ids.attempt,
      "a".repeat(64),
      ids.foreignArtifact,
      ids.foreignRun,
      ids.foreignAttempt,
      "b".repeat(64),
    ],
  );
  await db.query(
    `INSERT INTO signed_manufacturing_export_evidence
       (run_id,execution_attempt_id,repository_id,installation_id,artifact_id,
        github_repository_id,github_run_id,run_attempt,source_sha,signer_sha,source_ref,
        workflow_path,manifest_sha256,bundle_sha256,subject_count)
     SELECT $1,$2,r.id,r.installation_id,$3,r.github_repo_id,$4,1,$5,$5,'refs/heads/main',
            '.github/workflows/release.yml',$6,$6,1
       FROM repositories r WHERE r.id=$7`,
    [ids.run, ids.attempt, ids.artifact, "123456789", sha, "c".repeat(64), ids.repository],
  );
  await db.query(
    `INSERT INTO signed_manufacturing_export_evidence
       (run_id,execution_attempt_id,repository_id,installation_id,artifact_id,
        github_repository_id,github_run_id,run_attempt,source_sha,signer_sha,source_ref,
        workflow_path,manifest_sha256,bundle_sha256,subject_count)
     SELECT $1,$2,r.id,r.installation_id,$3,r.github_repo_id,$4,1,$5,$5,'refs/heads/main',
            '.github/workflows/release.yml',$6,$6,1
       FROM repositories r WHERE r.id=$7`,
    [ids.foreignRun, ids.foreignAttempt, ids.foreignArtifact, "123456790", sha, "d".repeat(64), ids.foreignRepository],
  );
  await db.query("INSERT INTO workspaces(id,name,slug) VALUES($1,'Owned workspace',$2),($3,'Foreign workspace',$4)", [
    ids.workspace,
    `owned-${ids.workspace}`,
    ids.foreignWorkspace,
    `foreign-${ids.foreignWorkspace}`,
  ]);
  await db.query(
    `INSERT INTO projects(id,workspace_id,name,github_repo_full_name)
     VALUES($1,$2,'Owned project',$3),($4,$5,'Foreign project',$6)`,
    [ids.project, ids.workspace, `${owner}/pcb`, ids.foreignProject, ids.foreignWorkspace, `${foreignOwner}/foreign`],
  );
  await db.query(
    `INSERT INTO revisions
      (id,project_id,revision_label,source_kind,commit_sha,bundle_sha256,validation_run_id,validation_artifact_id)
     VALUES($1,$2,'main','github_commit',$3,$4,$5,$6),
           ($7,$8,'foreign','github_commit',$3,$9,$10,$11)`,
    [
      ids.revision,
      ids.project,
      sha,
      "a".repeat(64),
      ids.run,
      ids.artifact,
      ids.foreignRevision,
      ids.foreignProject,
      "b".repeat(64),
      ids.foreignRun,
      ids.foreignArtifact,
    ],
  );
  await db.query(
    `INSERT INTO manufacturing_share_authorizations
      (revision_id,workspace_id,run_id,artifact_id,commit_sha,archive_sha256,authorized_by_github_user_id,authorized_by_login)
     VALUES($1,$2,$3,$4,$5,$6,$7,'original-user'),($8,$9,$10,$11,$5,$12,$13,'foreign-user')`,
    [
      ids.revision,
      ids.workspace,
      ids.run,
      ids.artifact,
      sha,
      "a".repeat(64),
      originalUserId,
      ids.foreignRevision,
      ids.foreignWorkspace,
      ids.foreignRun,
      ids.foreignArtifact,
      "b".repeat(64),
      otherUserId,
    ],
  );
  await db.query(
    `INSERT INTO run_pcb_footprint_summaries(
       run_id,repository_id,base_commit_sha,head_commit_sha,summary_sha256,summary)
     VALUES($1,$2,$3,$3,$4,'{}'::jsonb)`,
    [ids.run, ids.repository, sha, "b".repeat(64)],
  );
});

afterAll(async () => {
  if (!db) return;
  try {
    await db.query("DELETE FROM legal_holds WHERE id=$1", [ids.hold]);
    await db.query("DELETE FROM erasure_requests WHERE id=$1", [ids.erasure]);
    await db.query("DELETE FROM data_exports WHERE id=$1", [ids.exportId]);
    await db.query("DELETE FROM workspaces WHERE id IN ($1,$2)", [ids.workspace, ids.foreignWorkspace]);
    await db.query("DELETE FROM installations WHERE id IN ($1,$2)", [ids.installation, ids.foreignInstallation]);
  } finally {
    await db.close();
  }
});

describeDb("disposable PostgreSQL: original USER hardware data owner-count scope", () => {
  it("inspects all 19 private source classes AND public schema under one read-only PG17 snapshot", async () => {
    const scope = await assessHistoricalUserSourceScope(database(), identity());
    expect(scope).toMatchObject({
      status: "known-relational-source-scope-unapproved",
      releaseDecision: "NO_GO",
      completeCustomerExport: false,
      customerDeliveryAllowed: false,
      sourceRightsVerified: false,
      thirdPartyDisclosureRightsVerified: false,
      tableCount: 92,
      sourceClassCount: 19,
      scopeFingerprintSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect((await assessHistoricalUserSourceScope(database(), identity()))?.scopeFingerprintSha256).toBe(
      scope?.scopeFingerprintSha256,
    );
    expect(
      await assessHistoricalUserSourceScope(database(), { ...identity(), verifiedGitHubUserId: otherUserId }),
    ).toBeNull();
  });

  it("changes the private source fingerprint when one retained hardware row changes", async () => {
    const id = randomUUID();
    const initial = await assessHistoricalUserSourceScope(database(), identity());
    expect(initial?.status).toBe("known-relational-source-scope-unapproved");
    try {
      await database().query(
        "INSERT INTO board_supply_findings(id,board_id,mpn,status,severity) VALUES($1,$2,'new-verified-part','nrnd','high')",
        [id, ids.board],
      );
      const changed = await assessHistoricalUserSourceScope(database(), identity());
      expect(changed?.scopeFingerprintSha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(changed?.scopeFingerprintSha256).not.toBe(initial?.scopeFingerprintSha256);
      expect(changed?.customerDeliveryAllowed).toBe(false);
    } finally {
      await database().query("DELETE FROM board_supply_findings WHERE id=$1", [id]);
    }
    expect((await assessHistoricalUserSourceScope(database(), identity()))?.scopeFingerprintSha256).toBe(
      initial?.scopeFingerprintSha256,
    );
  });

  it("detects edit-restore ABA on a historically epoch-tracked owned repository with unchanged counts", async () => {
    const before = await assessHistoricalUserSourceScope(database(), identity());
    expect(before?.status).toBe("known-relational-source-scope-unapproved");
    try {
      await database().query("UPDATE repositories SET default_branch='historical-aba-probe' WHERE id=$1", [
        ids.repository,
      ]);
    } finally {
      await database().query("UPDATE repositories SET default_branch='main' WHERE id=$1", [ids.repository]);
    }
    const restored = await assessHistoricalUserSourceScope(database(), identity());
    expect(restored?.scopeFingerprintSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(restored?.scopeFingerprintSha256).not.toBe(before?.scopeFingerprintSha256);
    expect(restored?.customerDeliveryAllowed).toBe(false);
    const row = await database().query("SELECT default_branch FROM repositories WHERE id=$1", [ids.repository]);
    expect((row as { rows: Array<{ default_branch: string }> }).rows[0]?.default_branch).toBe("main");
  });

  it("detects count-preserving BOM and board edits in SAME original USER snapshot without exposing raw IP", async () => {
    const before = await assessHistoricalUserSourceScope(database(), identity());
    const beforeCounts = await assessHistoricalUserHardwareOwnedRowCounts(database(), identity());
    expect(before?.status).toBe("known-relational-source-scope-unapproved");
    expect(beforeCounts?.rowCounts.boardBomComponents).toBe(1);
    try {
      await database().query("UPDATE board_bom_components SET value='20k' WHERE snapshot_id=$1 AND reference='R1'", [
        ids.boardSnapshot,
      ]);
      const after = await assessHistoricalUserSourceScope(database(), identity());
      const afterCounts = await assessHistoricalUserHardwareOwnedRowCounts(database(), identity());
      expect(after?.scopeFingerprintSha256).not.toBe(before?.scopeFingerprintSha256);
      expect(afterCounts?.rowCounts).toEqual(beforeCounts?.rowCounts);
      expect(afterCounts?.rowDigests.boardBomComponents).not.toBe(beforeCounts?.rowDigests.boardBomComponents);
      expect(afterCounts?.rowDigests.boards).toBe(beforeCounts?.rowDigests.boards);
      expect(afterCounts?.customerDeliveryAllowed).toBe(false);
    } finally {
      await database().query("UPDATE board_bom_components SET value='10k' WHERE snapshot_id=$1 AND reference='R1'", [
        ids.boardSnapshot,
      ]);
    }
    const restored = await assessHistoricalUserHardwareOwnedRowCounts(database(), identity());
    expect(restored?.rowDigests.boardBomComponents).toBe(beforeCounts?.rowDigests.boardBomComponents);
  });

  it("never incorporates a FOREIGN GitHub USER's modified hardware row into the original-owner digest", async () => {
    const before = await assessHistoricalUserHardwareOwnedRowCounts(database(), identity());
    const originalScope = await assessHistoricalUserSourceScope(database(), identity());
    expect(before?.rowDigests.boards).toMatch(/^[0-9a-f]{64}$/u);
    try {
      await database().query("UPDATE boards SET display_name='foreign-new-private-design' WHERE id=$1", [
        ids.foreignBoard,
      ]);
      const after = await assessHistoricalUserHardwareOwnedRowCounts(database(), identity());
      const afterScope = await assessHistoricalUserSourceScope(database(), identity());
      expect(after?.rowDigests).toEqual(before?.rowDigests);
      expect(afterScope?.scopeFingerprintSha256).toBe(originalScope?.scopeFingerprintSha256);
    } finally {
      await database().query("UPDATE boards SET display_name='private' WHERE id=$1", [ids.foreignBoard]);
    }
  });

  it("refuses internal source-only observation after a new unknown schema table appears", async () => {
    await database().query("CREATE TABLE public.boardreadyops_scope_drift_probe (id integer PRIMARY KEY)");
    try {
      expect(await assessHistoricalUserSourceScope(database(), identity())).toBeNull();
    } finally {
      await database().query("DROP TABLE public.boardreadyops_scope_drift_probe");
    }
    expect((await assessHistoricalUserSourceScope(database(), identity()))?.status).toBe(
      "known-relational-source-scope-unapproved",
    );
  });

  it("counts nineteen related private source classes only under original numeric USER / suspended installation", async () => {
    const ownerSnapshot = await assessHistoricalUserHardwareOwnedRowCounts(database(), identity());
    expect(ownerSnapshot?.rowDigests).toEqual(
      Object.fromEntries(
        Object.keys(ownerSnapshot?.rowCounts ?? {}).map((name) => [name, expect.stringMatching(/^[0-9a-f]{64}$/u)]),
      ),
    );
    expect(ownerSnapshot).toMatchObject({
      scope: "original-numeric-user-retained-suspended-installation-only",
      releaseDecision: "NO_GO",
      completeCustomerExport: false,
      customerDeliveryAllowed: false,
      sourceRightsVerified: false,
      thirdPartyDisclosureRightsVerified: false,
      rowCounts: {
        boards: 1,
        boardBomSnapshots: 1,
        boardBomComponents: 1,
        firmwareSnapshots: 1,
        firmwareDependencies: 1,
        firmwareAdvisoryWatch: 1,
        runPcbFootprintSummaries: 1,
        boardSupplyWatch: 1,
        boardSupplyFindings: 1,
        productionBatches: 1,
        productionBatchDefects: 1,
        releaseRunAttempts: 1,
        releaseRunResults: 1,
        releaseRunTransitionEvents: 1,
        supplyFindingSuppressions: 1,
        protectedReleaseIntentCandidates: 1,
        protectedReleaseExecutionSeals: 1,
        signedManufacturingExportEvidence: 1,
        manufacturingShareAuthorizations: 1,
      },
    });
    expect(
      await assessHistoricalUserHardwareOwnedRowCounts(database(), identity({ verifiedGitHubUserId: otherUserId })),
    ).toBeNull();
    expect(
      await assessHistoricalUserHardwareOwnedRowCounts(database(), identity({ exportId: randomUUID() })),
    ).toBeNull();
  });

  it("refuses original USER source counts when the GitHub installation is no longer suspended", async () => {
    try {
      await database().query("UPDATE installations SET suspended_at=NULL WHERE id=$1", [ids.installation]);
      expect(await assessHistoricalUserHardwareOwnedRowCounts(database(), identity())).toBeNull();
    } finally {
      await database().query("UPDATE installations SET suspended_at=clock_timestamp() WHERE id=$1", [ids.installation]);
    }
    expect((await assessHistoricalUserHardwareOwnedRowCounts(database(), identity()))?.rowCounts.boards).toBe(1);
  });

  it("rejects cross-tenant run linked to owned board, rather than laundering the other user's data", async () => {
    try {
      await db?.query("INSERT INTO board_bom_snapshots(id,board_id,run_id,commit_sha) VALUES($1,$2,$3,$4)", [
        ids.crossBom,
        ids.board,
        ids.foreignRun,
        sha,
      ]);
      expect(await assessHistoricalUserHardwareOwnedRowCounts(database(), identity())).toBeNull();
    } finally {
      await db?.query("DELETE FROM board_bom_snapshots WHERE id=$1", [ids.crossBom]);
    }
  });

  it("rejects a cross-tenant firmware run even when the repository row is owned", async () => {
    try {
      await db?.query(
        "INSERT INTO repository_firmware_snapshots(id,repository_id,run_id,commit_sha) VALUES($1,$2,$3,$4)",
        [ids.crossFirmware, ids.repository, ids.foreignRun, sha],
      );
      expect(await assessHistoricalUserHardwareOwnedRowCounts(database(), identity())).toBeNull();
    } finally {
      await db?.query("DELETE FROM repository_firmware_snapshots WHERE id=$1", [ids.crossFirmware]);
    }
  });

  it("rejects a cross-tenant PCB footprint run despite a forged owned repository ID", async () => {
    try {
      await db?.query(
        `INSERT INTO run_pcb_footprint_summaries(run_id,repository_id,base_commit_sha,head_commit_sha,summary_sha256,summary)
         VALUES($1,$2,$3,$3,$4,'{}'::jsonb)`,
        [ids.foreignRun, ids.repository, sha, "b".repeat(64)],
      );
      expect(await assessHistoricalUserHardwareOwnedRowCounts(database(), identity())).toBeNull();
    } finally {
      await db?.query("DELETE FROM run_pcb_footprint_summaries WHERE run_id=$1", [ids.foreignRun]);
    }
  });

  it("fails closed when the original-user run result points to a FOREIGN user's execution attempt", async () => {
    // Real PG uniqueness blocks one attempt referenced by two results.
    // Temporarily clear the foreign result pointer first; leave all
    // uniqueness constraints and the application-side fence intact.
    try {
      await database().query("UPDATE release_run_results SET execution_attempt_id=NULL WHERE run_id=$1", [
        ids.foreignRun,
      ]);
      await database().query("UPDATE release_run_results SET execution_attempt_id=$1 WHERE run_id=$2", [
        ids.foreignAttempt,
        ids.run,
      ]);
      expect(await assessHistoricalUserHardwareOwnedRowCounts(database(), identity())).toBeNull();
    } finally {
      await database().query("UPDATE release_run_results SET execution_attempt_id=$1 WHERE run_id=$2", [
        ids.attempt,
        ids.run,
      ]);
      await database().query("UPDATE release_run_results SET execution_attempt_id=$1 WHERE run_id=$2", [
        ids.foreignAttempt,
        ids.foreignRun,
      ]);
    }
    expect(
      (await assessHistoricalUserHardwareOwnedRowCounts(database(), identity()))?.rowCounts.releaseRunResults,
    ).toBe(1);
  });

  it("denies a protected intent with a FOREIGN installation on an original-user repository", async () => {
    const forgedId = randomUUID();
    try {
      await database().query(
        `INSERT INTO protected_release_intent_candidates
           (id,installation_id,repository_id,github_repository_id,actor_github_user_id,actor_login,
            ref,commit_sha,request_id,evidence_digest,observed_at)
         SELECT $1,$2,r.id,r.github_repo_id,$3,'owned-user','refs/heads/main',$4,$5,$6,now()
           FROM repositories r WHERE r.id=$7`,
        [
          forgedId,
          ids.foreignInstallation,
          originalUserId,
          sha,
          "forged-cross-installation",
          "e".repeat(64),
          ids.repository,
        ],
      );
      expect(await assessHistoricalUserHardwareOwnedRowCounts(database(), identity())).toBeNull();
    } finally {
      await database().query("DELETE FROM protected_release_intent_candidates WHERE id=$1", [forgedId]);
    }
    expect(
      (await assessHistoricalUserHardwareOwnedRowCounts(database(), identity()))?.rowCounts
        .protectedReleaseIntentCandidates,
    ).toBe(1);
  });

  it("denies a protected seal with a FOREIGN installation despite an owned candidate", async () => {
    const forgedId = randomUUID();
    try {
      await database().query("DELETE FROM protected_release_execution_seals WHERE id=$1", [ids.seal]);
      await database().query(
        `INSERT INTO protected_release_execution_seals
          (id,candidate_id,installation_id,repository_id,github_repository_id,actor_github_user_id,
           ref,commit_sha,evidence_digest,run_id,execution_attempt_id,snapshot_digest,sealed_at)
         SELECT $1,c.id,$2,c.repository_id,c.github_repository_id,c.actor_github_user_id,
           c.ref,c.commit_sha,c.evidence_digest,$3,$4,$5,now()
           FROM protected_release_intent_candidates c WHERE c.id=$6`,
        [forgedId, ids.foreignInstallation, ids.sealRun, ids.sealAttempt, "1".repeat(64), ids.intent],
      );
      expect(await assessHistoricalUserHardwareOwnedRowCounts(database(), identity())).toBeNull();
    } finally {
      await database().query("DELETE FROM protected_release_execution_seals WHERE id=$1", [forgedId]);
      await database().query(
        `INSERT INTO protected_release_execution_seals
          (id,candidate_id,installation_id,repository_id,github_repository_id,actor_github_user_id,
           ref,commit_sha,evidence_digest,run_id,execution_attempt_id,snapshot_digest,sealed_at)
         SELECT $1,c.id,c.installation_id,c.repository_id,c.github_repository_id,c.actor_github_user_id,
           c.ref,c.commit_sha,c.evidence_digest,$2,$3,$4,now()
           FROM protected_release_intent_candidates c WHERE c.id=$5`,
        [ids.seal, ids.sealRun, ids.sealAttempt, "1".repeat(64), ids.intent],
      );
    }
    expect(
      (await assessHistoricalUserHardwareOwnedRowCounts(database(), identity()))?.rowCounts
        .protectedReleaseExecutionSeals,
    ).toBe(1);
  });

  it.each([
    ["foreign workspace", "workspace_id", "foreignWorkspace"],
    ["foreign actor", "authorized_by_github_user_id", "otherUserId"],
    ["lost run link", "run_id", "null"],
    ["lost artifact link", "artifact_id", "null"],
    ["foreign artifact", "artifact_id", "foreignArtifact"],
  ] as const)("rejects original-user manufacturing share with %s", async (_name, field, kind) => {
    const originals = {
      workspace_id: ids.workspace,
      authorized_by_github_user_id: originalUserId,
      run_id: ids.run,
      artifact_id: ids.artifact,
    };
    const replacements = {
      foreignWorkspace: ids.foreignWorkspace,
      otherUserId,
      foreignArtifact: ids.foreignArtifact,
      null: null,
    };
    const wrongValue = replacements[kind];
    // Field names only come from the fixed test vector; values are parameters.
    try {
      await database().query(`UPDATE manufacturing_share_authorizations SET ${field}=$1 WHERE revision_id=$2`, [
        wrongValue,
        ids.revision,
      ]);
      expect(await assessHistoricalUserHardwareOwnedRowCounts(database(), identity())).toBeNull();
    } finally {
      await database().query(`UPDATE manufacturing_share_authorizations SET ${field}=$1 WHERE revision_id=$2`, [
        originals[field],
        ids.revision,
      ]);
    }
    expect(
      (await assessHistoricalUserHardwareOwnedRowCounts(database(), identity()))?.rowCounts
        .manufacturingShareAuthorizations,
    ).toBe(1);
  });

  it("rejects relabeled source repository when immutable run and share appear consistent", async () => {
    try {
      await database().query("UPDATE projects SET github_repo_full_name=$1 WHERE id=$2", [
        `${foreignOwner}/foreign`,
        ids.project,
      ]);
      expect(await assessHistoricalUserHardwareOwnedRowCounts(database(), identity())).toBeNull();
    } finally {
      await database().query("UPDATE projects SET github_repo_full_name=$1 WHERE id=$2", [`${owner}/pcb`, ids.project]);
    }
  });

  it("denies a former USER share after BOTH run and artifact references were lost", async () => {
    try {
      await database().query(
        "UPDATE manufacturing_share_authorizations SET run_id=NULL, artifact_id=NULL WHERE revision_id=$1",
        [ids.revision],
      );
      expect(await assessHistoricalUserHardwareOwnedRowCounts(database(), identity())).toBeNull();
    } finally {
      await database().query(
        "UPDATE manufacturing_share_authorizations SET run_id=$1, artifact_id=$2 WHERE revision_id=$3",
        [ids.run, ids.artifact, ids.revision],
      );
    }
    expect(
      (await assessHistoricalUserHardwareOwnedRowCounts(database(), identity()))?.rowCounts
        .manufacturingShareAuthorizations,
    ).toBe(1);
  });

  it("does not attribute a FOREIGN run share even when authorized by the original user", async () => {
    try {
      await database().query(
        "UPDATE manufacturing_share_authorizations SET authorized_by_github_user_id=$1 WHERE revision_id=$2",
        [originalUserId, ids.foreignRevision],
      );
      expect(
        (await assessHistoricalUserHardwareOwnedRowCounts(database(), identity()))?.rowCounts
          .manufacturingShareAuthorizations,
      ).toBe(1);
    } finally {
      await database().query(
        "UPDATE manufacturing_share_authorizations SET authorized_by_github_user_id=$1 WHERE revision_id=$2",
        [otherUserId, ids.foreignRevision],
      );
    }
  });

  it("blocks even count-only diagnostics under legal hold and real erasure, then recovers safely", async () => {
    try {
      await db?.query(
        "INSERT INTO legal_holds(id,tenant_id,created_by,reason,scope,scope_id) VALUES($1,$2,'test','Original USER source legal hold','user',$2)",
        [ids.hold, owner],
      );
      expect(await assessHistoricalUserHardwareOwnedRowCounts(database(), identity())).toBeNull();
      await db?.query("DELETE FROM legal_holds WHERE id=$1", [ids.hold]);
      await db?.query(
        "INSERT INTO erasure_requests(id,tenant_id,requested_by,scope,scope_id,status,dry_run) VALUES($1,$2,'test','user',$2,'running',FALSE)",
        [ids.erasure, owner],
      );
      expect(await assessHistoricalUserHardwareOwnedRowCounts(database(), identity())).toBeNull();
      await db?.query("DELETE FROM erasure_requests WHERE id=$1", [ids.erasure]);
      expect((await assessHistoricalUserHardwareOwnedRowCounts(database(), identity()))?.rowCounts.boards).toBe(1);
    } finally {
      await db?.query("DELETE FROM legal_holds WHERE id=$1", [ids.hold]);
      await db?.query("DELETE FROM erasure_requests WHERE id=$1", [ids.erasure]);
    }
  });

  it("denies an additional immutable signed evidence row with FOREIGN installation despite an owned run", async () => {
    const forgedAttempt = randomUUID();
    const forgedArtifact = randomUUID();
    await database().query(
      "INSERT INTO release_run_attempts(id,run_id,attempt_number,status) VALUES($1,$2,2,'queued')",
      [forgedAttempt, ids.run],
    );
    await database().query(
      `INSERT INTO artifacts(id,run_id,execution_attempt_id,kind,name,storage_path,sha256,bytes,role)
        VALUES($1,$2,$3,'archive','forged-manufacturing.tar.gz','private/forged.tar.gz',$4,22,'manufacturing')`,
      [forgedArtifact, ids.run, forgedAttempt, "e".repeat(64)],
    );
    await database().query(
      `INSERT INTO signed_manufacturing_export_evidence
        (run_id,execution_attempt_id,repository_id,installation_id,artifact_id,
         github_repository_id,github_run_id,run_attempt,source_sha,signer_sha,source_ref,
         workflow_path,manifest_sha256,bundle_sha256,subject_count)
       SELECT $1,$2,r.id,$3,$4,r.github_repo_id,'123456791',1,$5,$5,'refs/heads/main',
        '.github/workflows/release.yml',$6,$6,1 FROM repositories r WHERE r.id=$7`,
      [ids.run, forgedAttempt, ids.foreignInstallation, forgedArtifact, sha, "f".repeat(64), ids.repository],
    );
    expect(await assessHistoricalUserHardwareOwnedRowCounts(database(), identity())).toBeNull();
    // Immutable evidence is deliberately not mutated or erased by this test.
    // Disposable DB cleanup cascades the forged source record after the test.
  });
});
