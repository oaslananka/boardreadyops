import { describe, expect, it } from "vitest";
import {
  CloudRuntimeConfigurationError,
  resolveCloudPersistenceConfiguration,
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
