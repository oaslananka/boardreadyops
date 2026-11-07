import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assessHistoricalUserHardwareOwnedRowCounts } from "../../packages/db/src/data-export-historical-hardware-owner-counts.js";
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
    `INSERT INTO board_supply_findings(board_id,mpn,status,severity)
     VALUES($1,'own-part','nrnd','high'),($2,'foreign-part','eol','critical')`,
    [ids.board, ids.foreignBoard],
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
    await db.query("DELETE FROM installations WHERE id IN ($1,$2)", [ids.installation, ids.foreignInstallation]);
  } finally {
    await db.close();
  }
});

describeDb("disposable PostgreSQL: original USER hardware data owner-count scope", () => {
  it("counts fourteen related private source classes only under original numeric USER / suspended installation", async () => {
    expect(await assessHistoricalUserHardwareOwnedRowCounts(database(), identity())).toEqual({
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
});
