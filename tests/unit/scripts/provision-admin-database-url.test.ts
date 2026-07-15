import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildAdminDatabaseUrl,
  parseRuntimeEnvironment,
  provisionAdminDatabaseUrl,
  readAdminDatabaseUrlOptions,
} from "../../../scripts/provision-admin-database-url.mjs";

describe("provision-admin-database-url", () => {
  it("reads deployment overrides without exposing credentials", () => {
    expect(
      readAdminDatabaseUrlOptions({
        BOARDREADYOPS_CLOUD_RUNTIME_ENV_FILE: "/run/secrets/cloud.env",
        BOARDREADYOPS_ADMIN_DATABASE_URL_FILE: "/run/admin/database-url",
        BOARDREADYOPS_ADMIN_DATABASE_HOST: "postgres.internal",
        BOARDREADYOPS_ADMIN_DATABASE_PORT: "6432",
        BOARDREADYOPS_ADMIN_DATABASE_DRY_RUN: "true",
      }),
    ).toEqual({
      runtimeEnvFile: "/run/secrets/cloud.env",
      outputFile: "/run/admin/database-url",
      host: "postgres.internal",
      port: 6432,
      dryRun: true,
    });
  });

  it("parses only the required PostgreSQL settings", () => {
    expect(
      parseRuntimeEnvironment(
        [
          "POSTGRES_USER=boardreadyops",
          "POSTGRES_PASSWORD='secret value'",
          'POSTGRES_DB="boardreadyops"',
          "GITHUB_CLIENT_SECRET=ignored",
        ].join("\n"),
      ),
    ).toEqual({
      POSTGRES_USER: "boardreadyops",
      POSTGRES_PASSWORD: "secret value",
      POSTGRES_DB: "boardreadyops",
    });
  });

  it("percent-encodes user information and database names", () => {
    expect(
      buildAdminDatabaseUrl({
        username: "board@ready",
        password: "p@ss:/?#[]",
        database: "board ready",
        host: "bro-postgres",
        port: 5432,
      }),
    ).toBe("postgresql://board%40ready:p%40ss%3A%2F%3F%23%5B%5D@bro-postgres:5432/board%20ready");
  });

  it.skipIf(process.platform === "win32")("writes an atomic root-only administrative URL file", () => {
    const root = mkdtempSync(join(tmpdir(), "boardreadyops-admin-url-"));
    const runtimeEnvFile = join(root, "runtime-env");
    const outputFile = join(root, "admin", "database-url");
    writeFileSync(
      runtimeEnvFile,
      ["POSTGRES_USER=boardreadyops", "POSTGRES_PASSWORD=p@ssword", "POSTGRES_DB=boardreadyops"].join("\n"),
      { mode: 0o600 },
    );

    expect(
      provisionAdminDatabaseUrl({
        runtimeEnvFile,
        outputFile,
        host: "bro-postgres",
        port: 5432,
        dryRun: false,
      }),
    ).toEqual({ outputFile, dryRun: false });

    expect(readFileSync(outputFile, "utf8")).toBe(
      "postgresql://boardreadyops:p%40ssword@bro-postgres:5432/boardreadyops\n",
    );
    expect(statSync(outputFile).mode & 0o777).toBe(0o600);
    expect(statSync(join(root, "admin")).mode & 0o777).toBe(0o700);
  });

  it.skipIf(process.platform === "win32")("rejects a runtime environment file with broad permissions", () => {
    const root = mkdtempSync(join(tmpdir(), "boardreadyops-admin-url-public-"));
    const runtimeEnvFile = join(root, "runtime-env");
    const outputFile = join(root, "admin", "database-url");
    mkdirSync(join(root, "admin"), { mode: 0o700 });
    writeFileSync(
      runtimeEnvFile,
      ["POSTGRES_USER=boardreadyops", "POSTGRES_PASSWORD=secret", "POSTGRES_DB=boardreadyops"].join("\n"),
      { mode: 0o600 },
    );
    chmodSync(runtimeEnvFile, 0o640);

    expect(() =>
      provisionAdminDatabaseUrl({
        runtimeEnvFile,
        outputFile,
        host: "bro-postgres",
        port: 5432,
        dryRun: false,
      }),
    ).toThrow("must not be readable or writable by group or others");
  });
});
