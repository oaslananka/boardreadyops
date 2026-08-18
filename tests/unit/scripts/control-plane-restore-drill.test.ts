import { describe, expect, it } from "vitest";
import {
  buildPostgresRestoreDrillPlan,
  RESTORE_DRILL_CONFIRMATION,
  summarizePostgresRestoreDrill,
} from "../../../scripts/control-plane-restore-drill.mjs";

describe("control-plane restore drill", () => {
  it("requires a disposable source and an isolated empty restore database", () => {
    expect(() =>
      buildPostgresRestoreDrillPlan({
        sourceUrl: "postgresql://boardreadyops@127.0.0.1:5432/source",
        restoreUrl: "postgresql://boardreadyops@127.0.0.1:5432/restore",
        backupPath: "/tmp/restore-drill.dump",
        confirmation: "wrong",
      }),
    ).toThrow("isolated disposable restore drill confirmation is required");

    expect(
      buildPostgresRestoreDrillPlan({
        sourceUrl: "postgresql://boardreadyops@127.0.0.1:5432/source",
        restoreUrl: "postgresql://boardreadyops@127.0.0.1:5432/restore",
        backupPath: "/tmp/restore-drill.dump",
        confirmation: RESTORE_DRILL_CONFIRMATION,
      }),
    ).toMatchObject({
      sourceIdentity: "127.0.0.1:5432/source",
      restoreIdentity: "127.0.0.1:5432/restore",
      backupPath: "/tmp/restore-drill.dump",
    });
  });

  it("emits aggregate-only restore evidence", () => {
    const evidence = summarizePostgresRestoreDrill({
      backup: {
        event: "postgres_backup_restore_verified",
        backupBytes: 8192,
        migrationCount: 39,
        publicTableCount: 42,
        representativeRows: 4,
      },
      restoredRunStateVerified: true,
    });

    expect(evidence).toEqual({
      event: "postgres_restore_readiness_verified",
      backupBytes: 8192,
      migrationCount: 39,
      publicTableCount: 42,
      representativeRows: 4,
      restoredRunStateVerified: true,
    });
    expect(JSON.stringify(evidence)).not.toMatch(/database|repository|installation|commit|token|secret|payload/iu);
  });
});
