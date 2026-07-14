import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SqlQueryExecutor, SqlQueryResult } from "./lifecycle-store.js";
import {
  createSqlRunnerRegistrationEnrollmentStore,
  type RunnerRegistrationScope,
} from "./runner-registration-enrollment-store.js";

export type IssueRunnerEnrollmentOptions = {
  databaseUrlFile: string;
  installationId: string;
  name: string;
  scope: RunnerRegistrationScope;
  allowedRepositories: readonly string[];
  tokenOutputFile: string;
  ttlSeconds?: number;
};

export type IssuedRunnerEnrollment = {
  registrationId: string;
  expiresAt: string;
  tokenOutputFile: string;
};

export type IssueRunnerEnrollmentDependencies = {
  query(databaseUrl: string, sql: string, params: readonly unknown[]): Promise<SqlQueryResult>;
  token(): string;
};

const maximumPsqlOutputBytes = 1024 * 1024;

const defaultDependencies: IssueRunnerEnrollmentDependencies = {
  query: executePsqlQuery,
  token: () => randomBytes(32).toString("base64url"),
};

export async function issueRunnerEnrollment(
  options: IssueRunnerEnrollmentOptions,
  overrides: Partial<IssueRunnerEnrollmentDependencies> = {},
): Promise<IssuedRunnerEnrollment> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const databaseUrlFile = path.resolve(options.databaseUrlFile);
  const tokenOutputFile = path.resolve(options.tokenOutputFile);
  await assertPrivateFile(databaseUrlFile, "database URL file");
  await prepareTokenOutput(tokenOutputFile);
  const databaseUrl = (await readFile(databaseUrlFile, "utf8")).trim();
  validateDatabaseUrl(databaseUrl);
  const enrollmentToken = dependencies.token();
  validateEnrollmentToken(enrollmentToken);
  await writeSecretFile(tokenOutputFile, enrollmentToken);

  let accepted = false;
  try {
    const executor: SqlQueryExecutor = {
      query: async (sql, params = []) => await dependencies.query(databaseUrl, sql, params),
    };
    const result = await createSqlRunnerRegistrationEnrollmentStore(executor, {
      ...(options.ttlSeconds === undefined ? {} : { enrollmentTtlSeconds: options.ttlSeconds }),
      enrollmentToken: () => enrollmentToken,
    }).issueEnrollment({
      installationId: options.installationId,
      name: options.name,
      scope: options.scope,
      allowedRepositories: options.allowedRepositories,
    });
    if (result.status !== "accepted") {
      let message = "runner enrollment request was rejected as invalid or stale";
      if (result.status === "conflict") {
        const registrationSuffix = result.registrationId ? ` (${result.registrationId})` : "";
        message = `an active runner registration already uses this name or scope${registrationSuffix}`;
      }
      throw new Error(message);
    }
    if (result.enrollmentToken !== enrollmentToken) {
      throw new Error("runner enrollment store returned unexpected token material");
    }
    accepted = true;
    return {
      registrationId: result.registrationId,
      expiresAt: result.expiresAt,
      tokenOutputFile,
    };
  } finally {
    if (!accepted) await unlink(tokenOutputFile).catch(() => undefined);
  }
}

async function executePsqlQuery(databaseUrl: string, sql: string, params: readonly unknown[]): Promise<SqlQueryResult> {
  if (!sql.includes("boardreadyops_issue_runner_registration_enrollment") || params.length !== 9) {
    throw new Error("runner enrollment administration received an unsupported database query");
  }
  const connection = parseDatabaseConnection(databaseUrl);
  const secretDirectory = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-psql-"));
  const passwordFile = path.join(secretDirectory, "pgpass");
  try {
    if (process.platform !== "win32") await chmod(secretDirectory, 0o700);
    await writeFile(
      passwordFile,
      `${pgpassField(connection.host)}:${pgpassField(connection.port)}:${pgpassField(connection.database)}:${pgpassField(connection.user)}:${pgpassField(connection.password)}\n`,
      {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      },
    );
    if (process.platform !== "win32") await chmod(passwordFile, 0o600);
    const variables = psqlVariables(params);
    const result = await runPsql({
      environment: {
        ...process.env,
        PGHOST: connection.host,
        PGPORT: connection.port,
        PGUSER: connection.user,
        PGDATABASE: connection.database,
        PGPASSFILE: passwordFile,
        ...connection.environment,
      },
      variables,
    });
    let row: unknown;
    try {
      row = JSON.parse(result.stdout.trim()) as unknown;
    } catch {
      throw new Error("psql returned invalid runner enrollment metadata");
    }
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      throw new Error("psql returned incomplete runner enrollment metadata");
    }
    return { rows: [row as Record<string, unknown>] };
  } finally {
    await rm(secretDirectory, { recursive: true, force: true });
  }
}

async function runPsql(input: {
  environment: NodeJS.ProcessEnv;
  variables: Readonly<Record<string, string>>;
}): Promise<{ stdout: string; stderr: string }> {
  const args = ["--no-psqlrc", "--quiet", "--tuples-only", "--no-align", "--set=ON_ERROR_STOP=1"];
  for (const [name, value] of Object.entries(input.variables)) args.push(`--set=${name}=${value}`);
  const statement = `
with issued as (
  select * from boardreadyops_issue_runner_registration_enrollment(
    :'issued_at'::timestamptz,
    :'installation_id',
    :'registration_id',
    :'enrollment_id',
    :'registration_name',
    :'registration_scope',
    array(select jsonb_array_elements_text(:'allowed_repositories'::jsonb)),
    :'token_digest',
    :'expires_at'::timestamptz
  )
)
select json_build_object(
  'outcome', outcome,
  'registration_id', registration_id,
  'effective_expires_at', effective_expires_at
)::text
from issued;
`;
  return await new Promise((resolve, reject) => {
    const environment = fixedPsqlEnvironment(input.environment);
    const child = spawnPsql(args, environment);
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    let exceeded = false;
    const collect = (current: string, chunk: string): string => {
      bytes += Buffer.byteLength(chunk, "utf8");
      if (bytes > maximumPsqlOutputBytes) {
        exceeded = true;
        child.kill("SIGKILL");
        return current;
      }
      return `${current}${chunk}`;
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = collect(stdout, chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = collect(stderr, chunk);
    });
    child.once("error", (error) => reject(new Error(`failed to start psql: ${error.message}`)));
    child.once("close", (code, signal) => {
      if (exceeded) {
        reject(new Error(`psql output exceeded ${maximumPsqlOutputBytes} bytes`));
        return;
      }
      if (code !== 0) {
        const detail = sanitizedPsqlError(stderr || stdout);
        const termination = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
        const detailSuffix = detail ? `: ${detail}` : "";
        reject(new Error(`psql runner enrollment query failed with ${termination}${detailSuffix}`));
        return;
      }
      resolve({ stdout, stderr });
    });
    child.stdin.end(statement);
  });
}

function fixedPsqlEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...environment,
    PATH: "/usr/bin:/bin",
  };
}

function spawnPsql(args: readonly string[], environment: NodeJS.ProcessEnv): ChildProcessWithoutNullStreams {
  if (process.platform !== "linux") {
    throw new Error("runner enrollment administration is supported only on Linux control-plane hosts");
  }
  return spawn("/usr/bin/psql", args, {
    env: environment,
    stdio: "pipe",
    windowsHide: true,
  });
}

function psqlVariables(params: readonly unknown[]): Record<string, string> {
  const [issuedAt, installationId, registrationId, enrollmentId, name, scope, repositories, digest, expiresAt] = params;
  if (
    typeof issuedAt !== "string" ||
    typeof installationId !== "string" ||
    typeof registrationId !== "string" ||
    typeof enrollmentId !== "string" ||
    typeof name !== "string" ||
    typeof scope !== "string" ||
    !Array.isArray(repositories) ||
    repositories.some((repository) => typeof repository !== "string") ||
    typeof digest !== "string" ||
    typeof expiresAt !== "string"
  ) {
    throw new Error("runner enrollment database parameters were invalid");
  }
  return {
    issued_at: issuedAt,
    installation_id: installationId,
    registration_id: registrationId,
    enrollment_id: enrollmentId,
    registration_name: name,
    registration_scope: scope,
    allowed_repositories: JSON.stringify(repositories),
    token_digest: digest,
    expires_at: expiresAt,
  };
}

function parseDatabaseConnection(value: string): {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
  environment: NodeJS.ProcessEnv;
} {
  const url = validateDatabaseUrl(value);
  const environment: NodeJS.ProcessEnv = {};
  const supportedParameters: Readonly<Record<string, string>> = {
    sslmode: "PGSSLMODE",
    sslrootcert: "PGSSLROOTCERT",
    sslcert: "PGSSLCERT",
    sslkey: "PGSSLKEY",
    connect_timeout: "PGCONNECT_TIMEOUT",
    application_name: "PGAPPNAME",
  };
  for (const [name, parameter] of url.searchParams) {
    const environmentName = supportedParameters[name];
    if (!environmentName) throw new Error(`database URL uses unsupported query parameter: ${name}`);
    environment[environmentName] = parameter;
  }
  return {
    host: url.hostname,
    port: url.port || "5432",
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    environment,
  };
}

function validateDatabaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("database URL file does not contain a valid URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("database URL must use postgres or postgresql scheme");
  }
  if (!url.hostname || !url.username || !url.pathname || url.pathname === "/") {
    throw new Error("database URL must identify a database host, user, and name");
  }
  if (url.hash) throw new Error("database URL cannot include a fragment");
  return url;
}

function pgpassField(value: string): string {
  const backslash = String.fromCharCode(92);
  return value.replaceAll(backslash, backslash.repeat(2)).replaceAll(":", `${backslash}:`);
}

function sanitizedPsqlError(value: string): string {
  return Array.from(value.trim(), (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127 ? " " : character;
  })
    .join("")
    .slice(0, 1000);
}

function validateEnrollmentToken(value: string): void {
  if (value.length < 43 || value.length > 256 || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error("runner enrollment token generator returned an invalid token");
  }
}

async function prepareTokenOutput(filePath: string): Promise<void> {
  if (await stat(filePath).catch(() => undefined)) {
    throw new Error(`refusing to overwrite an existing enrollment token file: ${filePath}`);
  }
  const directory = path.dirname(filePath);
  const existing = await stat(directory).catch(() => undefined);
  if (existing && !existing.isDirectory()) {
    throw new Error(`enrollment token output parent is not a directory: ${directory}`);
  }
  if (!existing) await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await chmod(directory, 0o700);
}

async function writeSecretFile(filePath: string, enrollmentToken: string): Promise<void> {
  await writeFile(filePath, `${enrollmentToken}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  if (process.platform !== "win32") await chmod(filePath, 0o600);
}

async function assertPrivateFile(filePath: string, label: string): Promise<void> {
  const info = await stat(filePath).catch(() => undefined);
  if (!info?.isFile()) throw new Error(`${label} does not exist or is not a regular file`);
  if (process.platform !== "win32" && (info.mode & 0o077) !== 0) {
    throw new Error(`${label} must not be readable or writable by group or other users`);
  }
}
