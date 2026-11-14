import { describe, expect, it, vi } from "vitest";
import {
  createProductionNeonSqlMaintenanceOperation,
  runNeonSqlMaintenancePass,
} from "../../../apps/web/lib/neon-production-sql-maintenance.js";

function cleanup() {
  const operations = {
    purgeWebhookInbox: vi.fn(async () => 1),
    purgeRunnerRequestNonces: vi.fn(async () => 2),
    purgeRemoteMcpOAuth: vi.fn(async () => ({
      rateLimitBucketsPurged: 0,
      securityEventsPurged: 0,
      loginResumptionsPurged: 0,
      expiredGrantsPurged: 0,
      expiredAuthorizationsPurged: 0,
    })),
    expireArtifactUploadCapabilities: vi.fn(async () => 0),
    revokeExpiredRunnerRegistrationEnrollments: vi.fn(async () => 0),
    expireRepositorySetupProbes: vi.fn(async () => 0),
    purgeTerminalArtifactUploadCapabilities: vi.fn(async () => 0),
    purgeTerminalRunnerRegistrationEnrollments: vi.fn(async () => 0),
    purgeTerminalRepositorySetupProbes: vi.fn(async () => 0),
    purgeCompletedControlPlaneOutbox: vi.fn(async () => 0),
    purgeCompletedControlPlaneReconciliationItems: vi.fn(async () => 0),
  };
  return operations;
}

describe("Neon SQL-only retention cleanup", () => {
  it("executes existing bounded metadata and security cleanup without touching artifact bytes", async () => {
    const operations = cleanup();
    await runNeonSqlMaintenancePass({ operations, signal: new AbortController().signal });
    for (const operation of Object.values(operations)) expect(operation).toHaveBeenCalledOnce();
    expect("expireArtifactRetention" in operations).toBe(false);
  });

  it("refuses all database operations after losing exclusive worker ownership", async () => {
    const operations = cleanup();
    const abort = new AbortController();
    abort.abort();
    await expect(runNeonSqlMaintenancePass({ operations, signal: abort.signal })).rejects.toThrow(
      "worker_ownership_lost",
    );
    for (const operation of Object.values(operations)) expect(operation).not.toHaveBeenCalled();
  });

  it("does not silently claim success after an individual SQL operation fails", async () => {
    const operations = cleanup();
    operations.purgeWebhookInbox.mockRejectedValue(new Error("sql_failed"));
    await expect(runNeonSqlMaintenancePass({ operations, signal: new AbortController().signal })).rejects.toThrow(
      "neon_sql_maintenance_incomplete",
    );
  });

  it("fails closed when the advisory owner is lost during cleanup", async () => {
    const operations = cleanup();
    const abort = new AbortController();
    operations.purgeWebhookInbox.mockImplementation(async () => {
      abort.abort();
      return 1;
    });
    await expect(runNeonSqlMaintenancePass({ operations, signal: abort.signal })).rejects.toThrow(
      "worker_ownership_lost",
    );
  });

  it("rejects unbounded or missing configuration before creating a SQL pool", () => {
    const input = { connectionString: "postgresql://test@localhost/db" };
    expect(() => createProductionNeonSqlMaintenanceOperation({ ...input, batchLimit: 0 })).toThrow();
    expect(() => createProductionNeonSqlMaintenanceOperation({ ...input, batchLimit: 101 })).toThrow();
    expect(() => createProductionNeonSqlMaintenanceOperation({ ...input, connectionString: "" })).toThrow();
    expect(() =>
      createProductionNeonSqlMaintenanceOperation({
        ...input,
        environment: { BOARDREADYOPS_EPHEMERAL_RECORD_RETENTION_DAYS: "0" },
      }),
    ).toThrow();
  });
});
