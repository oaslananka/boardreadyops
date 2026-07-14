import { generateKeyPairSync } from "node:crypto";
import { chmod, lstat, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runnerCapabilitySchema, runnerIdentifierSchema } from "../../packages/contracts/src/index.js";
import { activateRunner, loadRunnerPrivateKey, normalizeControlPlaneUrl, type RunnerFetch } from "./client.js";

type RunnerIdentityFile = {
  version: 1;
  controlPlaneUrl: string;
  runnerId: string;
  workerClass: "self_hosted";
  privateKeyFile: string;
  publicKeyFile: string;
  capabilities: string[];
  labels: string[];
  activatedAt: string;
};

export type LoadedRunnerIdentity = RunnerIdentityFile & {
  identityFile: string;
  privateKeyPath: string;
  publicKeyPath: string;
};

export type ActivateRunnerIdentityOptions = {
  controlPlaneUrl: string;
  enrollmentTokenFile: string;
  identityDirectory?: string;
  capabilities?: readonly string[];
  labels?: readonly string[];
  fetch?: RunnerFetch;
  now?: () => Date;
};

export type ActivatedRunnerIdentity = {
  identityFile: string;
  privateKeyFile: string;
  publicKeyFile: string;
  runnerId: string;
  status: "activated" | "replayed";
};

const privateKeyName = "runner-private-key.pem";
const publicKeyName = "runner-public-key.pem";
const identityFileName = "runner.json";

export function defaultRunnerIdentityDirectory(): string {
  return path.join(os.homedir(), ".config", "boardreadyops", "runner");
}

export async function activateRunnerIdentity(options: ActivateRunnerIdentityOptions): Promise<ActivatedRunnerIdentity> {
  const controlPlaneUrl = normalizeControlPlaneUrl(options.controlPlaneUrl).origin;
  const enrollmentTokenFile = path.resolve(options.enrollmentTokenFile);
  await assertPrivateFile(enrollmentTokenFile, "runner enrollment token file");
  const enrollmentToken = (await readFile(enrollmentTokenFile, "utf8")).trim();
  if (enrollmentToken.length < 43 || enrollmentToken.length > 256 || !/^[A-Za-z0-9_-]+$/u.test(enrollmentToken)) {
    throw new Error("runner enrollment token file does not contain a valid enrollment token");
  }

  const capabilities = normalizeCapabilities(options.capabilities ?? []);
  const labels = normalizeCapabilities(options.labels ?? []);
  const identityDirectory = path.resolve(options.identityDirectory ?? defaultRunnerIdentityDirectory());
  await prepareIdentityDirectory(identityDirectory);
  const identityFile = path.join(identityDirectory, identityFileName);
  const privateKeyFile = path.join(identityDirectory, privateKeyName);
  const publicKeyFile = path.join(identityDirectory, publicKeyName);
  await assertTargetsDoNotExist([identityFile, privateKeyFile, publicKeyFile]);

  const generated = generateKeyPairSync("ed25519");
  const privateKey = generated.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicKey = generated.publicKey.export({ type: "spki", format: "pem" }).toString();
  const activated = await activateRunner({
    baseUrl: controlPlaneUrl,
    enrollmentToken,
    publicKey,
    capabilities,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });

  const activatedAt = (options.now ?? (() => new Date()))().toISOString();
  const identity: RunnerIdentityFile = {
    version: 1,
    controlPlaneUrl,
    runnerId: activated.registrationId,
    workerClass: "self_hosted",
    privateKeyFile: privateKeyName,
    publicKeyFile: publicKeyName,
    capabilities,
    labels,
    activatedAt,
  };

  const written: string[] = [];
  try {
    await writeExclusive(privateKeyFile, privateKey, 0o600);
    written.push(privateKeyFile);
    await writeExclusive(publicKeyFile, publicKey, 0o600);
    written.push(publicKeyFile);
    await writeExclusive(identityFile, `${JSON.stringify(identity, null, 2)}\n`, 0o600);
    written.push(identityFile);
  } catch (error) {
    await Promise.all(written.map((file) => unlink(file).catch(() => undefined)));
    throw error;
  }

  return {
    identityFile,
    privateKeyFile,
    publicKeyFile,
    runnerId: activated.registrationId,
    status: activated.status,
  };
}

export async function loadRunnerIdentity(identityFileInput: string): Promise<LoadedRunnerIdentity> {
  const identityFile = path.resolve(identityFileInput);
  await assertPrivateDirectory(path.dirname(identityFile), "runner identity directory");
  await assertPrivateFile(identityFile, "runner identity file");
  let value: unknown;
  try {
    value = JSON.parse(await readFile(identityFile, "utf8")) as unknown;
  } catch {
    throw new Error("runner identity file is not valid JSON");
  }
  const identity = parseIdentity(value);
  const directory = path.dirname(identityFile);
  const privateKeyPath = resolveIdentityChild(directory, identity.privateKeyFile, "privateKeyFile");
  const publicKeyPath = resolveIdentityChild(directory, identity.publicKeyFile, "publicKeyFile");
  await assertPrivateFile(privateKeyPath, "runner private key file");
  await assertPrivateFile(publicKeyPath, "runner public key file");
  await loadRunnerPrivateKey(privateKeyPath);
  return {
    ...identity,
    identityFile,
    privateKeyPath,
    publicKeyPath,
  };
}

function parseIdentity(value: unknown): RunnerIdentityFile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("runner identity file must contain an object");
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || record.workerClass !== "self_hosted") {
    throw new Error("runner identity file has an unsupported version or worker class");
  }
  const runnerId = runnerIdentifierSchema.safeParse(record.runnerId);
  if (!runnerId.success) throw new Error("runner identity file contains an invalid runner id");
  const controlPlaneUrl =
    typeof record.controlPlaneUrl === "string" ? normalizeControlPlaneUrl(record.controlPlaneUrl).origin : undefined;
  if (!controlPlaneUrl) throw new Error("runner identity file contains an invalid control-plane URL");
  const privateKeyFile = relativeFile(record.privateKeyFile, "privateKeyFile");
  const publicKeyFile = relativeFile(record.publicKeyFile, "publicKeyFile");
  const capabilities = normalizeCapabilities(arrayOfStrings(record.capabilities, "capabilities"));
  const labels = normalizeCapabilities(arrayOfStrings(record.labels, "labels"));
  if (typeof record.activatedAt !== "string" || Number.isNaN(Date.parse(record.activatedAt))) {
    throw new TypeError("runner identity file contains an invalid activation timestamp");
  }
  return {
    version: 1,
    controlPlaneUrl,
    runnerId: runnerId.data,
    workerClass: "self_hosted",
    privateKeyFile,
    publicKeyFile,
    capabilities,
    labels,
    activatedAt: new Date(record.activatedAt).toISOString(),
  };
}

function arrayOfStrings(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`runner identity ${name} must be an array of strings`);
  }
  return value as string[];
}

function normalizeCapabilities(values: readonly string[]): string[] {
  const normalized = Array.from(new Set(values.map((value) => runnerCapabilitySchema.parse(value)))).sort(
    (left, right) => left.localeCompare(right),
  );
  if (normalized.length > 64) throw new Error("runner identity may declare at most 64 capabilities or labels");
  return normalized;
}

function relativeFile(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length < 1 || path.isAbsolute(value) || value.split(/[\\/]/u).includes("..")) {
    throw new Error(`runner identity ${name} must be a relative file within the identity directory`);
  }
  return value;
}

function resolveIdentityChild(directory: string, relative: string, name: string): string {
  const resolved = path.resolve(directory, relative);
  if (resolved !== directory && !resolved.startsWith(`${directory}${path.sep}`)) {
    throw new Error(`runner identity ${name} escapes the identity directory`);
  }
  return resolved;
}

async function prepareIdentityDirectory(directory: string): Promise<void> {
  const existing = await lstat(directory).catch(() => undefined);
  if (existing && (existing.isSymbolicLink() || !existing.isDirectory())) {
    throw new Error(`runner identity directory is not a directory: ${directory}`);
  }
  if (!existing) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
  }
  if (process.platform !== "win32") await chmod(directory, 0o700);
}

async function assertPrivateDirectory(directory: string, label: string): Promise<void> {
  const info = await lstat(directory).catch(() => undefined);
  if (!info?.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`${label} does not exist or is not a regular directory`);
  }
  if (process.platform !== "win32" && (info.mode & 0o077) !== 0) {
    throw new Error(`${label} must not be accessible by group or other users`);
  }
}

async function assertPrivateFile(filePath: string, label: string): Promise<void> {
  const info = await lstat(filePath).catch(() => undefined);
  if (!info?.isFile() || info.isSymbolicLink()) throw new Error(`${label} does not exist or is not a regular file`);
  if (process.platform !== "win32" && (info.mode & 0o077) !== 0) {
    throw new Error(`${label} must not be readable or writable by group or other users`);
  }
}

async function assertTargetsDoNotExist(files: readonly string[]): Promise<void> {
  for (const file of files) {
    if (await lstat(file).catch(() => undefined)) {
      throw new Error(`refusing to overwrite existing runner identity material: ${file}`);
    }
  }
}

async function writeExclusive(filePath: string, content: string, mode: number): Promise<void> {
  await writeFile(filePath, content, { encoding: "utf8", flag: "wx", mode });
  if (process.platform !== "win32") await chmod(filePath, mode);
}
