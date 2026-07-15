import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute } from "node:path";

export const defaultAdminDatabaseUrlOptions = {
  runtimeEnvFile: "/opt/boardreadyops-cloud/runtime-env",
  outputFile: "/var/lib/boardreadyops-admin/database-url",
  host: "bro-postgres",
  port: 5432,
  dryRun: false,
};

const requiredKeys = ["POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB"];

function envFlag(env, name) {
  return ["1", "true", "yes"].includes(String(env[name] ?? "").toLowerCase());
}

function envValue(env, name, fallback) {
  return env[name] ?? fallback;
}

function envPort(env, name, fallback) {
  const value = Number.parseInt(String(env[name] ?? ""), 10);
  return Number.isSafeInteger(value) && value > 0 && value <= 65_535 ? value : fallback;
}

export function readAdminDatabaseUrlOptions(env = process.env) {
  return {
    runtimeEnvFile: envValue(
      env,
      "BOARDREADYOPS_CLOUD_RUNTIME_ENV_FILE",
      defaultAdminDatabaseUrlOptions.runtimeEnvFile,
    ),
    outputFile: envValue(env, "BOARDREADYOPS_ADMIN_DATABASE_URL_FILE", defaultAdminDatabaseUrlOptions.outputFile),
    host: envValue(env, "BOARDREADYOPS_ADMIN_DATABASE_HOST", defaultAdminDatabaseUrlOptions.host),
    port: envPort(env, "BOARDREADYOPS_ADMIN_DATABASE_PORT", defaultAdminDatabaseUrlOptions.port),
    dryRun: envFlag(env, "BOARDREADYOPS_ADMIN_DATABASE_DRY_RUN"),
  };
}

function parseQuotedValue(value, quote, lineNumber) {
  if (!value.endsWith(quote) || value.length < 2) {
    throw new Error(`runtime environment line ${lineNumber} has an unterminated quoted value`);
  }

  if (quote === '"') {
    try {
      return JSON.parse(value);
    } catch {
      throw new Error(`runtime environment line ${lineNumber} has an invalid double-quoted value`);
    }
  }

  return value.slice(1, -1);
}

function parseValue(rawValue, lineNumber) {
  const value = rawValue.endsWith("\r") ? rawValue.slice(0, -1) : rawValue;
  const trimmed = value.trim();
  let parsed = value;
  if (trimmed.startsWith('"')) {
    parsed = parseQuotedValue(trimmed, '"', lineNumber);
  } else if (trimmed.startsWith("'")) {
    parsed = parseQuotedValue(trimmed, "'", lineNumber);
  }

  if (parsed.includes("\0") || parsed.includes("\n") || parsed.includes("\r")) {
    throw new Error(`runtime environment line ${lineNumber} contains a control character`);
  }

  return parsed;
}

export function parseRuntimeEnvironment(text) {
  const selected = {};
  const lines = text.split("\n");

  for (const [index, line] of lines.entries()) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(line);
    if (!match) continue;
    const [, name, rawValue] = match;
    if (!requiredKeys.includes(name)) continue;
    selected[name] = parseValue(rawValue, index + 1);
  }

  for (const name of requiredKeys) {
    if (typeof selected[name] !== "string" || selected[name].length === 0) {
      throw new Error(`${name} is required in the runtime environment file`);
    }
  }

  return selected;
}

function validHost(host) {
  return /^[A-Za-z0-9.-]+$/u.test(host) && !host.startsWith(".") && !host.endsWith(".");
}

export function buildAdminDatabaseUrl({ username, password, database, host, port }) {
  if (!username || !password || !database) {
    throw new Error("PostgreSQL username, password, and database must be non-empty");
  }
  if (!validHost(host)) {
    throw new Error("BOARDREADYOPS_ADMIN_DATABASE_HOST must be a DNS name or IPv4 address");
  }
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("BOARDREADYOPS_ADMIN_DATABASE_PORT must be between 1 and 65535");
  }

  return `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}`;
}

function assertPrivateRegularFile(path) {
  const metadata = statSync(path);
  if (!metadata.isFile()) {
    throw new Error("runtime environment path must resolve to a regular file");
  }
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error("runtime environment file must not be readable or writable by group or others");
  }
}

function writePrivateFile(path, value) {
  const parent = dirname(path);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  chmodSync(parent, 0o700);

  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = openSync(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    writeFileSync(descriptor, `${value}\n`, { encoding: "utf8" });
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, path);
    chmodSync(path, 0o600);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporaryPath, { force: true });
  }

  const outputMetadata = lstatSync(path);
  if (!outputMetadata.isFile() || outputMetadata.isSymbolicLink() || (outputMetadata.mode & 0o077) !== 0) {
    throw new Error("administrative database URL file failed its post-write permission check");
  }
}

export function provisionAdminDatabaseUrl(options = readAdminDatabaseUrlOptions()) {
  if (!isAbsolute(options.runtimeEnvFile) || !isAbsolute(options.outputFile)) {
    throw new Error("runtime environment and administrative URL paths must be absolute");
  }

  assertPrivateRegularFile(options.runtimeEnvFile);
  const runtimeEnvironment = parseRuntimeEnvironment(readFileSync(options.runtimeEnvFile, "utf8"));
  const url = buildAdminDatabaseUrl({
    username: runtimeEnvironment.POSTGRES_USER,
    password: runtimeEnvironment.POSTGRES_PASSWORD,
    database: runtimeEnvironment.POSTGRES_DB,
    host: options.host,
    port: options.port,
  });

  if (!options.dryRun) {
    writePrivateFile(options.outputFile, url);
  }

  return {
    outputFile: options.outputFile,
    dryRun: options.dryRun,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = provisionAdminDatabaseUrl();
    process.stdout.write(
      result.dryRun
        ? `Administrative database URL provisioning validated for ${result.outputFile}.\n`
        : `Administrative database URL provisioned at ${result.outputFile}.\n`,
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
