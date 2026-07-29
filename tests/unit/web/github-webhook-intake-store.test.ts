import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getControlPlaneJobStore,
  resetControlPlaneJobStoreForTests,
} from "../../../apps/web/app/api/github/webhook/intake-store.js";

const trackedEnvironmentNames = [
  "DATABASE_URL",
  "DATABASE_POOL_MAX",
  "BOARDREADYOPS_PERSISTENCE_MODE",
  "BOARDREADYOPS_WEBHOOK_RETENTION_DAYS",
] as const;
const originalEnvironment = new Map(trackedEnvironmentNames.map((name) => [name, process.env[name]]));

function intakeStoreSource(): string {
  return fs.readFileSync("apps/web/app/api/github/webhook/intake-store.js", "utf8");
}

beforeEach(() => {
  process.env.DATABASE_URL = "postgresql://example.invalid/boardreadyops";
  delete process.env.DATABASE_POOL_MAX;
  delete process.env.BOARDREADYOPS_PERSISTENCE_MODE;
  delete process.env.BOARDREADYOPS_WEBHOOK_RETENTION_DAYS;
  resetControlPlaneJobStoreForTests();
});

afterEach(() => {
  resetControlPlaneJobStoreForTests();
  for (const name of trackedEnvironmentNames) {
    const value = originalEnvironment.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("GitHub webhook intake store retention", () => {
  it("wires configured retention into the SQL store that accepts new webhook rows", () => {
    const source = intakeStoreSource();

    expect(source).toContain("resolveControlPlaneRetentionConfiguration");
    expect(source).toContain("const retention = resolveControlPlaneRetentionConfiguration()");
    expect(source).toContain("{ retentionDays: retention.webhookInboxDays }");
  });

  it("fails closed before creating a SQL store when retention is invalid", () => {
    process.env.BOARDREADYOPS_WEBHOOK_RETENTION_DAYS = "0";

    expect(() => getControlPlaneJobStore()).toThrowError(
      expect.objectContaining({ code: "invalid-webhook-retention-days" }),
    );
  });
});
