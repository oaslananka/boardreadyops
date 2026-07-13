import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { SqlQueryExecutor, SqlQueryResult } from "./lifecycle-store.js";

export type RunnerRegistrationScope = "installation" | "organization" | "repository";

export type IssueRunnerRegistrationEnrollmentInput = {
  installationId: string;
  name: string;
  scope: RunnerRegistrationScope;
  allowedRepositories: readonly string[];
};

export type IssuedRunnerRegistrationEnrollment = {
  status: "accepted";
  registrationId: string;
  enrollmentToken: string;
  expiresAt: string;
};

export type IssueRunnerRegistrationEnrollmentResult =
  | IssuedRunnerRegistrationEnrollment
  | { status: "conflict" | "stale"; registrationId?: string };

export type ActivateRunnerRegistrationInput = {
  enrollmentToken: string;
  publicKey: string;
  capabilities: readonly string[];
};

export type ActivateRunnerRegistrationResult =
  | { status: "accepted" | "replayed"; registrationId: string; installationId: string }
  | { status: "conflict" | "stale"; registrationId?: string; installationId?: string };

export type RunnerRegistrationEnrollmentStore = {
  issueEnrollment(input: IssueRunnerRegistrationEnrollmentInput): Promise<IssueRunnerRegistrationEnrollmentResult>;
  activateRegistration(input: ActivateRunnerRegistrationInput): Promise<ActivateRunnerRegistrationResult>;
};

export type RunnerRegistrationEnrollmentStoreOptions = {
  now?: () => Date;
  id?: () => string;
  enrollmentToken?: () => string;
  enrollmentTtlSeconds?: number;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/u;
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;

function rows(result: unknown): readonly Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as SqlQueryResult).rows;
  return Array.isArray(value) ? value : [];
}

function stringColumn(row: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = row?.[key];
  return typeof value === "string" ? value : undefined;
}

function isoColumn(row: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = row?.[key];
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString();
  if (typeof value !== "string") return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString();
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function positiveInteger(value: number | undefined, fallback: number, name: string, maximum: number): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected <= 0 || selected > maximum) {
    throw new Error(`${name} must be a positive integer no greater than ${maximum}`);
  }
  return selected;
}

function normalizeUniqueStrings(
  values: readonly string[],
  options: { maximumCount: number; maximumLength: number; pattern?: RegExp },
): string[] | undefined {
  if (values.length > options.maximumCount) return undefined;
  const normalized = values.map((value) => value.trim());
  if (
    normalized.some(
      (value) =>
        value.length < 1 ||
        value.length > options.maximumLength ||
        (options.pattern !== undefined && !options.pattern.test(value)),
    )
  ) {
    return undefined;
  }
  return [...new Set(normalized)].sort((left, right) => left.localeCompare(right));
}

function validSecret(value: string): boolean {
  return value.length >= 43 && value.length <= 256 && base64UrlPattern.test(value);
}

export function createSqlRunnerRegistrationEnrollmentStore(
  executor: SqlQueryExecutor,
  options: RunnerRegistrationEnrollmentStoreOptions = {},
): RunnerRegistrationEnrollmentStore {
  const now = options.now ?? (() => new Date());
  const id = options.id ?? randomUUID;
  const enrollmentToken = options.enrollmentToken ?? (() => randomBytes(32).toString("base64url"));
  const enrollmentTtlSeconds = positiveInteger(options.enrollmentTtlSeconds, 15 * 60, "enrollmentTtlSeconds", 60 * 60);

  return {
    async issueEnrollment(input) {
      const at = now();
      const name = input.name.trim();
      const allowedRepositories = normalizeUniqueStrings(input.allowedRepositories, {
        maximumCount: 256,
        maximumLength: 256,
        pattern: repositoryPattern,
      });
      if (
        !uuidPattern.test(input.installationId) ||
        name.length < 1 ||
        name.length > 120 ||
        !["installation", "organization", "repository"].includes(input.scope) ||
        allowedRepositories === undefined ||
        (input.scope === "repository" && allowedRepositories.length < 1)
      ) {
        return { status: "stale" };
      }

      const registrationId = id();
      const enrollmentId = id();
      const token = enrollmentToken();
      if (!uuidPattern.test(registrationId) || !uuidPattern.test(enrollmentId) || !validSecret(token)) {
        throw new Error("runner registration enrollment generator returned an invalid value");
      }
      const expiresAt = new Date(at.valueOf() + enrollmentTtlSeconds * 1000);
      const result = await executor.query(
        `select * from boardreadyops_issue_runner_registration_enrollment(
           $1::timestamptz,
           $2,
           $3,
           $4,
           $5,
           $6,
           $7::text[],
           $8,
           $9::timestamptz
         )`,
        [
          at.toISOString(),
          input.installationId,
          registrationId,
          enrollmentId,
          name,
          input.scope,
          allowedRepositories,
          digest(token),
          expiresAt.toISOString(),
        ],
      );
      const row = rows(result)[0];
      const outcome = stringColumn(row, "outcome");
      const returnedRegistrationId = stringColumn(row, "registration_id");
      if (outcome !== "accepted") {
        return {
          status: outcome === "conflict" ? "conflict" : "stale",
          ...(returnedRegistrationId === undefined ? {} : { registrationId: returnedRegistrationId }),
        };
      }
      const effectiveExpiresAt = isoColumn(row, "effective_expires_at");
      if (!returnedRegistrationId || !effectiveExpiresAt) {
        throw new Error("runner registration enrollment issuance returned incomplete metadata");
      }
      return {
        status: "accepted",
        registrationId: returnedRegistrationId,
        enrollmentToken: token,
        expiresAt: effectiveExpiresAt,
      };
    },

    async activateRegistration(input) {
      const at = now();
      const publicKey = input.publicKey.trim();
      const capabilities = normalizeUniqueStrings(input.capabilities, {
        maximumCount: 64,
        maximumLength: 128,
      });
      if (!validSecret(input.enrollmentToken) || publicKey.length < 32 || publicKey.length > 16_384 || !capabilities) {
        return { status: "stale" };
      }
      const result = await executor.query(
        `select * from boardreadyops_activate_runner_registration(
           $1::timestamptz,
           $2,
           $3,
           $4,
           $5::jsonb
         )`,
        [at.toISOString(), digest(input.enrollmentToken), publicKey, digest(publicKey), JSON.stringify(capabilities)],
      );
      const row = rows(result)[0];
      const outcome = stringColumn(row, "outcome");
      const registrationId = stringColumn(row, "registration_id");
      const installationId = stringColumn(row, "installation_id");
      if ((outcome === "accepted" || outcome === "replayed") && registrationId && installationId) {
        return { status: outcome, registrationId, installationId };
      }
      return {
        status: outcome === "conflict" ? "conflict" : "stale",
        ...(registrationId === undefined ? {} : { registrationId }),
        ...(installationId === undefined ? {} : { installationId }),
      };
    },
  };
}
