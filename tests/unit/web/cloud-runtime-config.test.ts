import { describe, expect, it } from "vitest";
import {
  CloudRuntimeConfigurationError,
  compareStrictVersions,
  resolveArtifactCapabilityConfiguration,
  resolveCloudPersistenceConfiguration,
  resolveControlPlaneRetentionConfiguration,
  resolveSelfHostedRunnerVersionConfiguration,
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
  it("defaults terminal webhook inbox and ephemeral record retention to 30 days", () => {
    expect(resolveControlPlaneRetentionConfiguration({})).toEqual({
      webhookInboxDays: 30,
      ephemeralRecordsDays: 30,
      controlPlaneHistoryDays: 90,
    });
  });

  it("accepts an explicit bounded webhook inbox retention period", () => {
    expect(resolveControlPlaneRetentionConfiguration({ BOARDREADYOPS_WEBHOOK_RETENTION_DAYS: " 90 " })).toEqual({
      webhookInboxDays: 90,
      ephemeralRecordsDays: 30,
      controlPlaneHistoryDays: 90,
    });
    expect(resolveControlPlaneRetentionConfiguration({ BOARDREADYOPS_WEBHOOK_RETENTION_DAYS: "1" })).toEqual({
      webhookInboxDays: 1,
      ephemeralRecordsDays: 30,
      controlPlaneHistoryDays: 90,
    });
    expect(resolveControlPlaneRetentionConfiguration({ BOARDREADYOPS_WEBHOOK_RETENTION_DAYS: "3650" })).toEqual({
      webhookInboxDays: 3650,
      ephemeralRecordsDays: 30,
      controlPlaneHistoryDays: 90,
    });
  });

  it.each(["0", "3651", "1.5", "thirty", ""])("rejects invalid webhook inbox retention value %s", (value) => {
    expect(() =>
      resolveControlPlaneRetentionConfiguration({ BOARDREADYOPS_WEBHOOK_RETENTION_DAYS: value }),
    ).toThrowError(expect.objectContaining({ code: "invalid-webhook-retention-days" }));
  });

  it("accepts an explicit bounded terminal ephemeral record retention period", () => {
    expect(
      resolveControlPlaneRetentionConfiguration({ BOARDREADYOPS_EPHEMERAL_RECORD_RETENTION_DAYS: " 45 " }),
    ).toEqual({ webhookInboxDays: 30, ephemeralRecordsDays: 45, controlPlaneHistoryDays: 90 });
    expect(resolveControlPlaneRetentionConfiguration({ BOARDREADYOPS_EPHEMERAL_RECORD_RETENTION_DAYS: "1" })).toEqual({
      webhookInboxDays: 30,
      ephemeralRecordsDays: 1,
      controlPlaneHistoryDays: 90,
    });
    expect(
      resolveControlPlaneRetentionConfiguration({ BOARDREADYOPS_EPHEMERAL_RECORD_RETENTION_DAYS: "3650" }),
    ).toEqual({ webhookInboxDays: 30, ephemeralRecordsDays: 3650, controlPlaneHistoryDays: 90 });
  });

  it.each(["0", "3651", "1.5", "thirty", ""])(
    "rejects invalid terminal ephemeral record retention value %s",
    (value) => {
      expect(() =>
        resolveControlPlaneRetentionConfiguration({ BOARDREADYOPS_EPHEMERAL_RECORD_RETENTION_DAYS: value }),
      ).toThrowError(expect.objectContaining({ code: "invalid-ephemeral-record-retention-days" }));
    },
  );

  it("accepts an explicit bounded completed control-plane history retention period", () => {
    expect(
      resolveControlPlaneRetentionConfiguration({ BOARDREADYOPS_CONTROL_PLANE_HISTORY_RETENTION_DAYS: " 180 " }),
    ).toEqual({ webhookInboxDays: 30, ephemeralRecordsDays: 30, controlPlaneHistoryDays: 180 });
    expect(
      resolveControlPlaneRetentionConfiguration({ BOARDREADYOPS_CONTROL_PLANE_HISTORY_RETENTION_DAYS: "1" }),
    ).toEqual({ webhookInboxDays: 30, ephemeralRecordsDays: 30, controlPlaneHistoryDays: 1 });
    expect(
      resolveControlPlaneRetentionConfiguration({ BOARDREADYOPS_CONTROL_PLANE_HISTORY_RETENTION_DAYS: "3650" }),
    ).toEqual({ webhookInboxDays: 30, ephemeralRecordsDays: 30, controlPlaneHistoryDays: 3650 });
  });

  it.each(["0", "3651", "1.5", "ninety", ""])(
    "rejects invalid completed control-plane history retention value %s",
    (value) => {
      expect(() =>
        resolveControlPlaneRetentionConfiguration({ BOARDREADYOPS_CONTROL_PLANE_HISTORY_RETENTION_DAYS: value }),
      ).toThrowError(expect.objectContaining({ code: "invalid-control-plane-history-retention-days" }));
    },
  );
});

describe("artifact upload capability configuration", () => {
  it("defaults upload capabilities to 15 minutes", () => {
    expect(resolveArtifactCapabilityConfiguration({})).toEqual({ uploadCapabilityTtlSeconds: 900 });
  });

  it("accepts an explicit bounded upload capability lifetime", () => {
    expect(resolveArtifactCapabilityConfiguration({ BOARDREADYOPS_ARTIFACT_CAPABILITY_TTL_SECONDS: " 120 " })).toEqual({
      uploadCapabilityTtlSeconds: 120,
    });
    expect(resolveArtifactCapabilityConfiguration({ BOARDREADYOPS_ARTIFACT_CAPABILITY_TTL_SECONDS: "60" })).toEqual({
      uploadCapabilityTtlSeconds: 60,
    });
    expect(resolveArtifactCapabilityConfiguration({ BOARDREADYOPS_ARTIFACT_CAPABILITY_TTL_SECONDS: "3600" })).toEqual({
      uploadCapabilityTtlSeconds: 3600,
    });
  });

  it.each(["0", "59", "3601", "1.5", "fifteen", ""])("rejects invalid artifact capability lifetime %s", (value) => {
    expect(() =>
      resolveArtifactCapabilityConfiguration({ BOARDREADYOPS_ARTIFACT_CAPABILITY_TTL_SECONDS: value }),
    ).toThrowError(expect.objectContaining({ code: "invalid-artifact-capability-ttl-seconds" }));
  });
});

describe("self-hosted runner minimum-version configuration", () => {
  it("keeps minimum-version enforcement disabled unless explicitly configured", () => {
    expect(resolveSelfHostedRunnerVersionConfiguration({})).toEqual({ minimumVersion: undefined });
  });

  it("accepts strict stable semantic versions and compares numeric components", () => {
    expect(
      resolveSelfHostedRunnerVersionConfiguration({ BOARDREADYOPS_SELF_HOSTED_RUNNER_MIN_VERSION: " 1.26.1 " }),
    ).toEqual({ minimumVersion: "1.26.1" });
    expect(compareStrictVersions("1.26.1", "1.26.1")).toBe(0);
    expect(compareStrictVersions("1.27.0", "1.26.9")).toBeGreaterThan(0);
    expect(compareStrictVersions("2.0.0", "10.0.0")).toBeLessThan(0);
  });

  it.each(["", "1.26", "v1.26.1", "01.26.1", "1.26.1-beta.1", "1.26.1+build"])(
    "rejects invalid minimum runner version %s",
    (value) => {
      expect(() =>
        resolveSelfHostedRunnerVersionConfiguration({ BOARDREADYOPS_SELF_HOSTED_RUNNER_MIN_VERSION: value }),
      ).toThrowError(expect.objectContaining({ code: "invalid-self-hosted-runner-minimum-version" }));
    },
  );
});
