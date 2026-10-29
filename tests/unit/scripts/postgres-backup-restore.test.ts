import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  BACKUP_RESTORE_CONFIRMATION,
  buildPostgresBackupRestorePlan,
  buildPostgresCommandEnvironment,
  databaseIdentity,
  verifyPostgresBackupRestore,
} from "../../../scripts/postgres-backup-restore.mjs";

const sourceUrl = "postgresql://backup_user:source-secret@db.internal:5432/boardreadyops";
const restoreUrl = "postgresql://restore_user:restore-secret@db.internal:5432/boardreadyops_restore";
const backupPath = "/tmp/boardreadyops-backup.dump";

describe("PostgreSQL backup and restore verification plan", () => {
  it("keeps database passwords out of command arguments", () => {
    const plan = buildPostgresBackupRestorePlan({
      sourceUrl,
      restoreUrl,
      backupPath,
      confirmation: BACKUP_RESTORE_CONFIRMATION,
    });

    expect(plan.source.identity).toBe("db.internal:5432/boardreadyops");
    expect(plan.restore.identity).toBe("db.internal:5432/boardreadyops_restore");
    expect(plan.dump.args).toEqual(["--format=custom", "--no-owner", "--no-privileges", "--dbname", "boardreadyops"]);
    expect(plan.dump.outputPath).toBe(backupPath);
    expect(plan.restoreCommand.args).toEqual([
      "--exit-on-error",
      "--no-owner",
      "--no-privileges",
      "--dbname",
      "boardreadyops_restore",
      backupPath,
    ]);
    expect(plan.dump.environment.PGPASSWORD).toBe("source-secret");
    expect(plan.restoreCommand.environment.PGPASSWORD).toBe("restore-secret");
    expect(JSON.stringify(plan.dump.args)).not.toContain("source-secret");
    expect(JSON.stringify(plan.restoreCommand.args)).not.toContain("restore-secret");
  });

  it("passes only a minimal inherited environment to PostgreSQL clients", () => {
    expect(
      buildPostgresCommandEnvironment(
        {
          PATH: "/usr/bin",
          HOME: "/home/operator",
          LANG: "C.UTF-8",
          DOPPLER_TOKEN: "unrelated-secret",
          BOARDREADYOPS_BACKUP_SOURCE_DATABASE_URL: sourceUrl,
        },
        { PGHOST: "db.internal", PGPASSWORD: "database-secret" },
      ),
    ).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/operator",
      LANG: "C.UTF-8",
      PGHOST: "db.internal",
      PGPASSWORD: "database-secret",
    });
  });

  it("treats credentials and query parameters as outside database identity", () => {
    expect(databaseIdentity("postgres://one:first@db.internal/boardreadyops?sslmode=require")).toBe(
      "db.internal:5432/boardreadyops",
    );
    expect(databaseIdentity("postgresql://two:second@db.internal:5432/boardreadyops")).toBe(
      "db.internal:5432/boardreadyops",
    );
  });

  it("rejects the source database as a restore target", () => {
    expect(() =>
      buildPostgresBackupRestorePlan({
        sourceUrl,
        restoreUrl: "postgresql://other:secret@db.internal:5432/boardreadyops?sslmode=require",
        backupPath,
        confirmation: BACKUP_RESTORE_CONFIRMATION,
      }),
    ).toThrow("restore database must differ from the source database");
  });

  it("requires an absolute backup path and an explicit isolated-target confirmation", () => {
    expect(() =>
      buildPostgresBackupRestorePlan({
        sourceUrl,
        restoreUrl,
        backupPath: "relative.dump",
        confirmation: BACKUP_RESTORE_CONFIRMATION,
      }),
    ).toThrow("backup path must be absolute");

    expect(() =>
      buildPostgresBackupRestorePlan({
        sourceUrl,
        restoreUrl,
        backupPath,
        confirmation: "yes",
      }),
    ).toThrow("isolated restore confirmation is required");
  });

  it("rejects malformed or unsupported database URLs", () => {
    expect(() => databaseIdentity("mysql://db.internal/boardreadyops")).toThrow(
      "database URL must use postgresql:// or postgres://",
    );
    expect(() => databaseIdentity("postgresql://db.internal/")).toThrow("database URL must include a database name");
  });
});

type FakeExecutor = {
  query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
  close(): Promise<void>;
};

function databaseExecutor(input: {
  tables: string[];
  migrations?: string[];
  counts?: Record<string, number>;
}): FakeExecutor {
  return {
    async query(sql) {
      if (sql.includes("information_schema.tables")) {
        return { rows: input.tables.map((table_name) => ({ table_name })) };
      }
      if (sql.includes("from cloud_schema_migrations")) {
        return { rows: (input.migrations ?? []).map((version) => ({ version })) };
      }
      const table = /from "([a-z_]+)"/u.exec(sql)?.[1];
      if (!table) throw new Error(`unexpected query: ${sql}`);
      return { rows: [{ count: String(input.counts?.[table] ?? 0) }] };
    },
    async close() {},
  };
}

describe("PostgreSQL backup output ownership", () => {
  const emptyExecutor = () => databaseExecutor({ tables: [] });
  const backupInput = (outputPath: string) => ({
    sourceUrl,
    restoreUrl,
    backupPath: outputPath,
    confirmation: BACKUP_RESTORE_CONFIRMATION,
  });
  const fakeDependencies = {
    createExecutor: emptyExecutor,
    readMigrationFiles: async () => [],
    // Model a second process creating the file after the initial existence check.
    backupPathExists: async () => false,
  };

  it("does not delete a pre-existing backup when exclusive creation loses a race", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "boardreadyops-backup-race-"));
    const output = path.join(dir, "existing.dump");
    try {
      await writeFile(output, "preserve-existing-operator-backup");
      await expect(verifyPostgresBackupRestore(backupInput(output), fakeDependencies)).rejects.toThrow(
        "backup path already exists",
      );
      expect(await readFile(output, "utf8")).toBe("preserve-existing-operator-backup");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "preserves a different file placed at the dump path before cleanup",
    async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "boardreadyops-backup-replaced-"));
      const output = path.join(dir, "swapped.dump");
      const dumpCommand = path.join(dir, "pg_dump");
      try {
        // A second actor replaces the inode during a failed dump: only the
        // original inode was created by this run, not the replacement.
        await writeFile(
          dumpCommand,
          `#!/bin/sh\n/bin/mv "${output}" "${output}.original"\nprintf 'preserve-replacement' > "${output}"\nexit 9\n`,
          { mode: 0o700 },
        );
        vi.stubEnv("PATH", dir);
        await expect(verifyPostgresBackupRestore(backupInput(output), fakeDependencies)).rejects.toThrow(
          "pg_dump failed with exit code 9",
        );
        expect(await readFile(output, "utf8")).toBe("preserve-replacement");
        await expect(access(`${output}.original`)).resolves.toBeUndefined();
      } finally {
        vi.unstubAllEnvs();
        await rm(dir, { recursive: true, force: true });
      }
    },
  );

  it("removes only the backup it created when the dump executable fails", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "boardreadyops-backup-failure-"));
    const output = path.join(dir, "failed.dump");
    try {
      vi.stubEnv("PATH", dir);
      await expect(verifyPostgresBackupRestore(backupInput(output), fakeDependencies)).rejects.toThrow(
        "pg_dump could not be started",
      );
      await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      vi.unstubAllEnvs();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("PostgreSQL backup restore verification", () => {
  it("runs a custom-format dump, restores it, and compares schema plus representative state", async () => {
    let restored = false;
    const source = databaseExecutor({
      tables: ["cloud_schema_migrations", "installations", "release_runs", "repositories"],
      migrations: ["0001_cloud_schema"],
      counts: { installations: 2, repositories: 3, release_runs: 5 },
    });
    const emptyTarget = databaseExecutor({ tables: [] });
    const restoredTarget = databaseExecutor({
      tables: ["cloud_schema_migrations", "installations", "release_runs", "repositories"],
      migrations: ["0001_cloud_schema"],
      counts: { installations: 2, repositories: 3, release_runs: 5 },
    });
    const commands: string[] = [];

    const result = await verifyPostgresBackupRestore(
      {
        sourceUrl,
        restoreUrl,
        backupPath,
        confirmation: BACKUP_RESTORE_CONFIRMATION,
      },
      {
        createExecutor: (url) => (url === sourceUrl ? source : restored ? restoredTarget : emptyTarget),
        readMigrationFiles: async () => ["0001_cloud_schema.sql"],
        runCommand: async ({ command }) => {
          commands.push(command);
          if (command === "pg_restore") restored = true;
        },
        fileSize: async () => 4096,
        backupPathExists: async () => false,
      },
    );

    expect(commands).toEqual(["pg_dump", "pg_restore"]);
    expect(result).toEqual({
      event: "postgres_backup_restore_verified",
      backupBytes: 4096,
      migrationCount: 1,
      publicTableCount: 4,
      representativeRows: 10,
    });
  });

  it("rejects a non-empty restore database before running backup commands", async () => {
    const commands: string[] = [];
    const target = databaseExecutor({ tables: ["unexpected_table"] });

    await expect(
      verifyPostgresBackupRestore(
        {
          sourceUrl,
          restoreUrl,
          backupPath,
          confirmation: BACKUP_RESTORE_CONFIRMATION,
        },
        {
          createExecutor: () => target,
          readMigrationFiles: async () => ["0001_cloud_schema.sql"],
          runCommand: async ({ command }) => {
            commands.push(command);
          },
          fileSize: async () => 1,
          backupPathExists: async () => false,
        },
      ),
    ).rejects.toThrow("restore database must be empty");
    expect(commands).toEqual([]);
  });

  it("fails when restored representative state differs from the source", async () => {
    let restored = false;
    const source = databaseExecutor({
      tables: ["cloud_schema_migrations", "installations"],
      migrations: ["0001_cloud_schema"],
      counts: { installations: 2 },
    });
    const emptyTarget = databaseExecutor({ tables: [] });
    const restoredTarget = databaseExecutor({
      tables: ["cloud_schema_migrations", "installations"],
      migrations: ["0001_cloud_schema"],
      counts: { installations: 1 },
    });

    await expect(
      verifyPostgresBackupRestore(
        {
          sourceUrl,
          restoreUrl,
          backupPath,
          confirmation: BACKUP_RESTORE_CONFIRMATION,
        },
        {
          createExecutor: (url) => (url === sourceUrl ? source : restored ? restoredTarget : emptyTarget),
          readMigrationFiles: async () => ["0001_cloud_schema.sql"],
          runCommand: async ({ command }) => {
            if (command === "pg_restore") restored = true;
          },
          fileSize: async () => 1024,
          backupPathExists: async () => false,
        },
      ),
    ).rejects.toThrow("restored representative row counts do not match the source");
  });
});
