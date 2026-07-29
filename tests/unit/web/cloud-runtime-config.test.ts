import { describe, expect, it } from "vitest";
import {
  CloudRuntimeConfigurationError,
  resolveCloudPersistenceConfiguration,
  resolveControlPlaneRetentionConfiguration,
} from "../../../apps/web/lib/cloud-runtime-config.js";

describe("cloud runtime persistence configuration", () => {
  it("defaults to postgres and requires DATABASE_URL", () => {
    expect(() => resolveCloudPersistenceConfiguration({ NODE_ENV: "production" })).toThrowError(
      expect.objectContaining({ code: "missing-database-url" }),
    );
  });

  it("returns postgres configuration when DATABASE_URL exists", () => {
    expect(
      resolveCloudPersistenceConfiguration({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://example.invalid/boardreadyops",
      }),
    ).toEqual({
      mode: "postgres",
      databaseUrl: "postgresql://example.invalid/boardreadyops",
    });
  });

  it("allows explicit memory persistence only in tests", () => {
    expect(
      resolveCloudPersistenceConfiguration({
        NODE_ENV: "test",
        BOARDREADYOPS_PERSISTENCE_MODE: "memory",
      }),
    ).toEqual({ mode: "memory" });
  });

  it("allows explicitly selected memory persistence in local development", () => {
    expect(
      resolveCloudPersistenceConfiguration({
        NODE_ENV: "development",
        BOARDREADYOPS_PERSISTENCE_MODE: "memory",
      }),
    ).toEqual({ mode: "memory" });
  });

  it("rejects memory persistence in production", () => {
    expect(() =>
      resolveCloudPersistenceConfiguration({
        NODE_ENV: "production",
        BOARDREADYOPS_PERSISTENCE_MODE: "memory",
      }),
    ).toThrowError(expect.objectContaining({ code: "memory-persistence-not-allowed" }));
  });

  it("rejects unknown persistence modes", () => {
    expect(() =>
      resolveCloudPersistenceConfiguration({
        NODE_ENV: "test",
        BOARDREADYOPS_PERSISTENCE_MODE: "redis",
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid-persistence-mode" }));
  });

  it("uses a typed configuration error", () => {
    try {
      resolveCloudPersistenceConfiguration({ NODE_ENV: "production" });
      throw new Error("expected configuration resolution to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(CloudRuntimeConfigurationError);
    }
  });
});

describe("control-plane webhook retention configuration", () => {
  it("defaults terminal webhook inbox retention to 30 days", () => {
    expect(resolveControlPlaneRetentionConfiguration({})).toEqual({ webhookInboxDays: 30 });
  });

  it("accepts an explicit bounded webhook inbox retention period", () => {
    expect(resolveControlPlaneRetentionConfiguration({ BOARDREADYOPS_WEBHOOK_RETENTION_DAYS: " 90 " })).toEqual({
      webhookInboxDays: 90,
    });
    expect(resolveControlPlaneRetentionConfiguration({ BOARDREADYOPS_WEBHOOK_RETENTION_DAYS: "1" })).toEqual({
      webhookInboxDays: 1,
    });
    expect(resolveControlPlaneRetentionConfiguration({ BOARDREADYOPS_WEBHOOK_RETENTION_DAYS: "3650" })).toEqual({
      webhookInboxDays: 3650,
    });
  });

  it.each(["0", "3651", "1.5", "thirty", ""])("rejects invalid webhook inbox retention value %s", (value) => {
    expect(() =>
      resolveControlPlaneRetentionConfiguration({ BOARDREADYOPS_WEBHOOK_RETENTION_DAYS: value }),
    ).toThrowError(expect.objectContaining({ code: "invalid-webhook-retention-days" }));
  });
});
