import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { SqlQueryExecutor, SqlQueryResult } from "./lifecycle-store.js";
import type { RunnerLeaseMutationContext, RunnerWorkerIdentity } from "./runner-lease-store.js";

export type RunnerArtifactDeclaration = {
  kind: string;
  name: string;
  role: string;
  bytes: number;
  sha256?: string;
};

export type IssueRunnerArtifactCapabilitiesInput = RunnerLeaseMutationContext & {
  artifacts: readonly RunnerArtifactDeclaration[];
};

export type IssuedRunnerArtifactCapability = {
  artifactId: string;
  storagePath: string;
  uploadToken: string;
  expiresAt: string;
  maximumBytes: number;
};

export type IssueRunnerArtifactCapabilitiesResult =
  | { status: "accepted"; uploads: readonly IssuedRunnerArtifactCapability[] }
  | { status: "replayed" | "stale" };

export type BeginRunnerArtifactUploadInput = {
  artifactId: string;
  uploadToken: string;
};

export type BegunRunnerArtifactUpload = {
  status: "accepted";
  artifactId: string;
  runId: string;
  executionAttemptId: string;
  leaseId: string;
  storagePath: string;
  declaredBytes: number;
  expectedSha256?: string;
};

export type BeginRunnerArtifactUploadResult = BegunRunnerArtifactUpload | { status: "expired" | "replayed" | "stale" };

export type CompleteRunnerArtifactUploadInput = BeginRunnerArtifactUploadInput & {
  sha256: string;
  bytes: number;
};

export type CompleteRunnerArtifactUploadResult = {
  status: "accepted" | "expired" | "rejected" | "replayed" | "stale";
};

export type FailRunnerArtifactUploadInput = BeginRunnerArtifactUploadInput & {
  reason: string;
};

export type FailRunnerArtifactUploadResult = { status: "accepted" | "replayed" | "stale" };

export type RunnerArtifactStore = {
  issueCapabilities(input: IssueRunnerArtifactCapabilitiesInput): Promise<IssueRunnerArtifactCapabilitiesResult>;
  beginUpload(input: BeginRunnerArtifactUploadInput): Promise<BeginRunnerArtifactUploadResult>;
  completeUpload(input: CompleteRunnerArtifactUploadInput): Promise<CompleteRunnerArtifactUploadResult>;
  failUpload(input: FailRunnerArtifactUploadInput): Promise<FailRunnerArtifactUploadResult>;
};

export type RunnerArtifactStoreOptions = {
  now?: () => Date;
  id?: () => string;
  uploadToken?: () => string;
  capabilityTtlSeconds?: number;
  requestToleranceSeconds?: number;
  requestNonceTtlSeconds?: number;
  storagePath?: (input: { runId: string; executionAttemptId: string; artifactId: string }) => string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;

function rows(result: unknown): readonly Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as SqlQueryResult).rows;
  return Array.isArray(value) ? value : [];
}

function stringColumn(row: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = row?.[key];
  return typeof value === "string" ? value : undefined;
}

function numberColumn(row: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = row?.[key];
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/u.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }
  return undefined;
}

function isoColumn(row: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = row?.[key];
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString();
  if (typeof value !== "string") return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString();
}

function positiveInteger(value: number | undefined, fallback: number, name: string, maximum?: number): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected <= 0 || (maximum !== undefined && selected > maximum)) {
    throw new Error(`${name} must be a positive integer${maximum === undefined ? "" : ` no greater than ${maximum}`}`);
  }
  return selected;
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function identityParameters(identity: RunnerWorkerIdentity): [string, string | null, string | null] {
  return identity.workerClass === "managed"
    ? ["managed", null, identity.managedRunnerIdentityId]
    : ["self_hosted", identity.runnerRegistrationId, null];
}

function validIdentity(identity: RunnerWorkerIdentity): boolean {
  return identity.workerClass === "managed"
    ? uuidPattern.test(identity.managedRunnerIdentityId)
    : uuidPattern.test(identity.runnerRegistrationId);
}

function validSecret(value: string): boolean {
  return value.length >= 43 && value.length <= 256 && base64UrlPattern.test(value);
}

function validLeaseContext(input: RunnerLeaseMutationContext): boolean {
  return (
    validIdentity(input) &&
    uuidPattern.test(input.runId) &&
    uuidPattern.test(input.executionAttemptId) &&
    uuidPattern.test(input.leaseId) &&
    validSecret(input.leaseToken)
  );
}

function validSignedMutation(input: RunnerLeaseMutationContext, now: Date, toleranceSeconds: number): boolean {
  if (!Number.isSafeInteger(input.requestTimestamp) || input.requestTimestamp < 0) return false;
  if (input.requestNonce.length < 22 || input.requestNonce.length > 128 || !base64UrlPattern.test(input.requestNonce)) {
    return false;
  }
  return Math.abs(Math.floor(now.valueOf() / 1000) - input.requestTimestamp) <= toleranceSeconds;
}

function normalizeDeclaration(input: RunnerArtifactDeclaration): RunnerArtifactDeclaration | undefined {
  const kind = input.kind.trim();
  const name = input.name.trim();
  const role = input.role.trim();
  if (kind.length < 1 || kind.length > 128) return undefined;
  if (name.length < 1 || name.length > 256) return undefined;
  if (role.length < 1 || role.length > 128) return undefined;
  if (!Number.isSafeInteger(input.bytes) || input.bytes < 0 || input.bytes > 2_147_483_647) return undefined;
  if (input.sha256 !== undefined && !sha256Pattern.test(input.sha256)) return undefined;
  return {
    kind,
    name,
    role,
    bytes: input.bytes,
    ...(input.sha256 === undefined ? {} : { sha256: input.sha256 }),
  };
}

function validStoragePath(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= 1024 &&
    value.trim() === value &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.split("/").includes("..")
  );
}

export function createSqlRunnerArtifactStore(
  executor: SqlQueryExecutor,
  options: RunnerArtifactStoreOptions = {},
): RunnerArtifactStore {
  const now = options.now ?? (() => new Date());
  const id = options.id ?? randomUUID;
  const uploadToken = options.uploadToken ?? (() => randomBytes(32).toString("base64url"));
  const capabilityTtlSeconds = positiveInteger(options.capabilityTtlSeconds, 15 * 60, "capabilityTtlSeconds", 15 * 60);
  const requestToleranceSeconds = positiveInteger(options.requestToleranceSeconds, 5 * 60, "requestToleranceSeconds");
  const requestNonceTtlSeconds = positiveInteger(options.requestNonceTtlSeconds, 10 * 60, "requestNonceTtlSeconds");
  const storagePath =
    options.storagePath ??
    ((input: { runId: string; executionAttemptId: string; artifactId: string }) =>
      `${input.runId}/${input.executionAttemptId}/${input.artifactId}.bin`);

  return {
    async issueCapabilities(input) {
      const at = now();
      if (!validLeaseContext(input) || !validSignedMutation(input, at, requestToleranceSeconds)) {
        return { status: "stale" };
      }
      if (input.artifacts.length < 1 || input.artifacts.length > 100) return { status: "stale" };

      const declarations = input.artifacts.map(normalizeDeclaration);
      if (declarations.some((declaration) => declaration === undefined)) return { status: "stale" };

      const expiresAt = new Date(at.valueOf() + capabilityTtlSeconds * 1000);
      const nonceExpiresAt = new Date(at.valueOf() + requestNonceTtlSeconds * 1000);
      const requestTimestamp = new Date(input.requestTimestamp * 1000);
      const generated = declarations.map((declaration) => {
        if (!declaration) throw new Error("artifact declaration normalization failed");
        const artifactId = id();
        const token = uploadToken();
        const generatedStoragePath = storagePath({
          runId: input.runId,
          executionAttemptId: input.executionAttemptId,
          artifactId,
        });
        if (!uuidPattern.test(artifactId) || !validSecret(token) || !validStoragePath(generatedStoragePath)) {
          throw new Error("runner artifact capability generator returned an invalid value");
        }
        return { artifactId, token, storagePath: generatedStoragePath, declaration };
      });
      const [workerClass, runnerRegistrationId, managedRunnerIdentityId] = identityParameters(input);

      await executor.query("delete from runner_request_nonces where expires_at <= $1::timestamptz", [at.toISOString()]);
      const result = await executor.query(
        `select boardreadyops_issue_artifact_upload_capabilities(
           $1::timestamptz, $2, $3, $4, $5, $6, $7, $8, $9,
           $10::timestamptz, $11::timestamptz, $12::jsonb
         ) as outcome`,
        [
          at.toISOString(),
          workerClass,
          input.runId,
          input.executionAttemptId,
          input.leaseId,
          runnerRegistrationId,
          managedRunnerIdentityId,
          digest(input.leaseToken),
          digest(input.requestNonce),
          requestTimestamp.toISOString(),
          nonceExpiresAt.toISOString(),
          JSON.stringify(
            generated.map((entry) => ({
              artifact_id: entry.artifactId,
              kind: entry.declaration.kind,
              name: entry.declaration.name,
              role: entry.declaration.role,
              declared_bytes: entry.declaration.bytes,
              expected_sha256: entry.declaration.sha256 ?? null,
              storage_path: entry.storagePath,
              upload_token_digest: digest(entry.token),
              expires_at: expiresAt.toISOString(),
            })),
          ),
        ],
      );
      const outcome = stringColumn(rows(result)[0], "outcome");
      if (outcome === "replayed") return { status: "replayed" };
      if (outcome !== "accepted") return { status: "stale" };

      const expiryResult = await executor.query(
        `select artifact_id, expires_at
         from runner_artifact_upload_capabilities
         where artifact_id = any($1::text[])`,
        [generated.map((entry) => entry.artifactId)],
      );
      const expiryByArtifactId = new Map(
        rows(expiryResult).flatMap((row) => {
          const artifactId = stringColumn(row, "artifact_id");
          const effectiveExpiresAt = isoColumn(row, "expires_at");
          return artifactId && effectiveExpiresAt ? [[artifactId, effectiveExpiresAt] as const] : [];
        }),
      );
      if (expiryByArtifactId.size !== generated.length) {
        throw new Error("artifact capability issuance did not return every effective expiry");
      }

      return {
        status: "accepted",
        uploads: generated.map((entry) => ({
          artifactId: entry.artifactId,
          storagePath: entry.storagePath,
          uploadToken: entry.token,
          expiresAt: expiryByArtifactId.get(entry.artifactId) ?? expiresAt.toISOString(),
          maximumBytes: entry.declaration.bytes,
        })),
      };
    },

    async beginUpload(input) {
      const at = now();
      if (!uuidPattern.test(input.artifactId) || !validSecret(input.uploadToken)) return { status: "stale" };
      const result = await executor.query(
        `select * from boardreadyops_begin_artifact_upload($1::timestamptz, $2, $3)`,
        [at.toISOString(), input.artifactId, digest(input.uploadToken)],
      );
      const row = rows(result)[0];
      const outcome = stringColumn(row, "outcome");
      if (outcome !== "accepted") {
        return outcome === "expired" || outcome === "replayed" ? { status: outcome } : { status: "stale" };
      }
      const runId = stringColumn(row, "run_id");
      const executionAttemptId = stringColumn(row, "execution_attempt_id");
      const leaseId = stringColumn(row, "lease_id");
      const returnedStoragePath = stringColumn(row, "storage_path");
      const declaredBytes = numberColumn(row, "declared_bytes");
      const expectedSha256 = stringColumn(row, "expected_sha256");
      if (!runId || !executionAttemptId || !leaseId || !returnedStoragePath || declaredBytes === undefined) {
        throw new Error("artifact upload begin returned incomplete capability metadata");
      }
      return {
        status: "accepted",
        artifactId: input.artifactId,
        runId,
        executionAttemptId,
        leaseId,
        storagePath: returnedStoragePath,
        declaredBytes,
        ...(expectedSha256 === undefined ? {} : { expectedSha256 }),
      };
    },

    async completeUpload(input) {
      const at = now();
      if (
        !uuidPattern.test(input.artifactId) ||
        !validSecret(input.uploadToken) ||
        !sha256Pattern.test(input.sha256) ||
        !Number.isSafeInteger(input.bytes) ||
        input.bytes < 0 ||
        input.bytes > 2_147_483_647
      ) {
        return { status: "stale" };
      }
      const result = await executor.query(
        `select boardreadyops_complete_artifact_upload(
           $1::timestamptz, $2, $3, $4, $5::integer
         ) as outcome`,
        [at.toISOString(), input.artifactId, digest(input.uploadToken), input.sha256, input.bytes],
      );
      const outcome = stringColumn(rows(result)[0], "outcome");
      if (outcome === "accepted" || outcome === "expired" || outcome === "rejected" || outcome === "replayed") {
        return { status: outcome };
      }
      return { status: "stale" };
    },

    async failUpload(input) {
      const at = now();
      const reason = input.reason.trim();
      if (
        !uuidPattern.test(input.artifactId) ||
        !validSecret(input.uploadToken) ||
        reason.length < 1 ||
        reason.length > 1000
      ) {
        return { status: "stale" };
      }
      const result = await executor.query(
        `select boardreadyops_fail_artifact_upload($1::timestamptz, $2, $3, $4) as outcome`,
        [at.toISOString(), input.artifactId, digest(input.uploadToken), reason],
      );
      const outcome = stringColumn(rows(result)[0], "outcome");
      return outcome === "accepted" || outcome === "replayed" ? { status: outcome } : { status: "stale" };
    },
  };
}
