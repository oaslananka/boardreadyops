import { spawnSync } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { issueRunnerEnrollment } from "../../packages/db/src/runner-enrollment-admin.js";

const databaseUrl = "postgresql://postgres@127.0.0.1:55432/boardreadyops";
const enabled = process.env.BOARDREADYOPS_PSQL_TEST === "1";
const suite = enabled ? describe : describe.skip;

suite("runner enrollment admin psql integration", () => {
  const roots: string[] = [];
  const installationId = randomUUID();
  const originalPath = process.env.PATH;

  beforeAll(async () => {
    const shimRoot = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-psql-shim-"));
    roots.push(shimRoot);
    const shim = path.join(shimRoot, process.platform === "win32" ? "psql.cmd" : "psql");
    const shimContent =
      process.platform === "win32"
        ? "@docker exec -i boardreadyops-enrollment-psql-test psql -U postgres -d boardreadyops %*\r\n"
        : '#!/bin/sh\nexec docker exec -i boardreadyops-enrollment-psql-test psql -U postgres -d boardreadyops "$@"\n';
    await writeFile(shim, shimContent, { mode: 0o755 });
    if (process.platform !== "win32") await chmod(shim, 0o755);
    process.env.PATH = `${shimRoot}${path.delimiter}${originalPath ?? ""}`;
    psql(
      `insert into installations (
         id,
         github_installation_id,
         account_login,
         account_type,
         plan_tier,
         created_at
       ) values (
         '${installationId}',
         ${randomInt(100_000_000, 999_999_999)},
         'psql-admin-${Date.now()}',
         'Organization',
         'team',
         now()
       );`,
    );
  });

  afterAll(async () => {
    psql(`delete from installations where id = '${installationId}';`, true);
    process.env.PATH = originalPath;
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  });

  it("issues enrollment metadata through the system psql client without bundling pg", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-runner-admin-psql-"));
    roots.push(root);
    const databaseUrlFile = path.join(root, "database-url");
    const tokenOutputFile = path.join(root, "runner.token");
    await writeFile(databaseUrlFile, `${databaseUrl}\n`, { mode: 0o600 });
    if (process.platform !== "win32") await chmod(databaseUrlFile, 0o600);

    const result = await issueRunnerEnrollment(
      {
        databaseUrlFile,
        installationId,
        name: "psql-integration-runner",
        scope: "repository",
        allowedRepositories: ["octo-org/private-board"],
        tokenOutputFile,
        ttlSeconds: 900,
      },
      { token: () => "e".repeat(43) },
    );

    expect(result.registrationId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(result.tokenOutputFile).toBe(tokenOutputFile);
    await expect(readFile(tokenOutputFile, "utf8")).resolves.toBe(`${"e".repeat(43)}\n`);
    if (process.platform !== "win32") expect((await stat(tokenOutputFile)).mode & 0o077).toBe(0);
    const stored = JSON.parse(
      psql(
        `select json_build_object(
           'status', registration.status,
           'scope', registration.scope,
           'allowed_repositories', registration.allowed_repositories,
           'token_digest', enrollment.token_digest,
           'event_type', audit.event_type
         )::text
         from runner_registrations as registration
         join runner_registration_enrollments as enrollment
           on enrollment.runner_registration_id = registration.id
         join audit_events as audit
           on audit.runner_registration_id = registration.id
          and audit.event_type = 'runner.registration.enrollment_issued'
         where registration.id = '${result.registrationId}';`,
      ),
    ) as Record<string, unknown>;
    expect(stored).toMatchObject({
      status: "pending",
      scope: "repository",
      allowed_repositories: ["octo-org/private-board"],
      token_digest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      event_type: "runner.registration.enrollment_issued",
    });
  });
});

function psql(statement: string, allowFailure = false): string {
  const result = spawnSync("psql", ["--no-psqlrc", "--quiet", "--tuples-only", "--no-align"], {
    env: {
      ...process.env,
      PGHOST: "127.0.0.1",
      PGPORT: "55432",
      PGUSER: "postgres",
      PGDATABASE: "boardreadyops",
    },
    encoding: "utf8",
    input: statement,
    windowsHide: true,
  });
  if (result.error && !allowFailure) throw result.error;
  const stderr = result.stderr ?? "";
  const stdout = result.stdout ?? "";
  if (result.status !== 0 && !allowFailure) {
    throw new Error(stderr.trim() || `psql exited with ${result.status ?? "unknown"}`);
  }
  return stdout.trim();
}
