import { randomUUID } from "node:crypto";
import type { RepositorySetupPresetId } from "@boardreadyops/cloud-core/repository-setup";
import type { SqlQueryExecutor, SqlQueryResult } from "./lifecycle-store.js";

export type RepositorySetupWorkflowStatus =
  | "actions_disabled"
  | "disabled"
  | "incompatible"
  | "missing"
  | "ready"
  | "unknown";
export type RepositorySetupConfigStatus = "invalid" | "missing" | "ready" | "unknown";

export type RepositorySetupRevision = {
  id: string;
  installationId: string;
  repositoryId: string;
  revision: number;
  preset: RepositorySetupPresetId;
  presetVersion: number;
  source: "operator" | "workflow_probe";
  actorId: string;
  requestId: string;
  workflowPath: "readiness-runner.yml";
  workflowContractVersion?: number;
  workflowStatus: RepositorySetupWorkflowStatus;
  configStatus: RepositorySetupConfigStatus;
  configVersion?: number;
  observedSha?: string;
  diagnostics: string[];
  createdAt: string;
};

export type RepositorySetupContext = {
  installationId: string;
  githubInstallationId: number;
  repositoryId: string;
  githubRepositoryId: number;
  owner: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  current?: RepositorySetupRevision;
};

export type RepositorySetupProbeContext = {
  probeId: string;
  installationId: string;
  githubInstallationId: number;
  repositoryId: string;
  githubRepositoryId: number;
  owner: string;
  name: string;
  defaultBranch: string;
  preset: RepositorySetupPresetId;
  presetVersion: number;
  status: "completed" | "dispatched" | "expired" | "failed" | "pending";
  expiresAt: string;
};

export type RepositorySetupStore = {
  getContext(input: { installationId: string; repositoryId: string }): Promise<RepositorySetupContext | undefined>;
  listRevisions(input: {
    installationId: string;
    repositoryId: string;
    limit?: number;
  }): Promise<RepositorySetupRevision[]>;
  applyRevision(input: {
    installationId: string;
    repositoryId: string;
    preset: RepositorySetupPresetId;
    presetVersion: number;
    source: "operator" | "workflow_probe";
    actorId: string;
    requestId: string;
    workflowStatus: RepositorySetupWorkflowStatus;
    workflowContractVersion?: number;
    configStatus: RepositorySetupConfigStatus;
    configVersion?: number;
    observedSha?: string;
    diagnostics?: readonly string[];
  }): Promise<{ outcome: "applied" | "conflict" | "not_found" | "replayed"; revisionId?: string; revision?: number }>;
  createProbe(input: {
    installationId: string;
    repositoryId: string;
    requestedBy: string;
    requestId: string;
    expiresAt: Date;
  }): Promise<{
    outcome: "conflict" | "created" | "not_configured" | "replayed";
    probeId?: string;
    setupRevisionId?: string;
  }>;
  getProbe(probeId: string): Promise<RepositorySetupProbeContext | undefined>;
  markProbeDispatched(input: { probeId: string; workflowRunId: string }): Promise<string>;
  failProbe(input: { probeId: string; failureCode: string }): Promise<string>;
  completeProbe(input: {
    probeId: string;
    workflowContractVersion: number;
    configStatus: "invalid" | "missing" | "ready";
    configVersion?: number;
    observedSha: string;
    diagnostics?: readonly string[];
  }): Promise<{ outcome: string; revisionId?: string; revision?: number }>;
};

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const shaPattern = /^[0-9a-f]{40}$/u;

function rows(result: unknown): readonly Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as SqlQueryResult).rows;
  return Array.isArray(value) ? value : [];
}

function text(row: Record<string, unknown>, name: string): string | undefined {
  const value = row[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function integer(row: Record<string, unknown>, name: string): number | undefined {
  const value = row[name];
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "bigint" && value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= 0n) return Number(value);
  if (typeof value === "string" && /^\d+$/u.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }
  return undefined;
}

function boolean(row: Record<string, unknown>, name: string): boolean {
  return row[name] === true;
}

function iso(row: Record<string, unknown>, name: string): string | undefined {
  const value = row[name];
  if (value instanceof Date && Number.isFinite(value.valueOf())) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.valueOf())) return parsed.toISOString();
  }
  return undefined;
}

function diagnostics(row: Record<string, unknown>): string[] {
  const value = row.diagnostics;
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.length <= 512).slice(0, 32);
}

function requiredIdentifier(name: string, value: string): string {
  if (!identifierPattern.test(value)) throw new Error(`${name} is invalid`);
  return value;
}

function requiredUuid(name: string, value: string): string {
  if (!uuidPattern.test(value)) throw new Error(`${name} is invalid`);
  return value;
}

function setupRevision(row: Record<string, unknown>): RepositorySetupRevision | undefined {
  const id = text(row, "setup_id") ?? text(row, "id");
  const installationId = text(row, "installation_id");
  const repositoryId = text(row, "repository_id");
  const revision = integer(row, "revision");
  const preset = text(row, "preset") as RepositorySetupPresetId | undefined;
  const presetVersion = integer(row, "preset_version");
  const source = text(row, "source") as RepositorySetupRevision["source"] | undefined;
  const actorId = text(row, "actor_id");
  const requestId = text(row, "request_id");
  const workflowPath = text(row, "workflow_path");
  const workflowStatus = text(row, "workflow_status") as RepositorySetupWorkflowStatus | undefined;
  const configStatus = text(row, "config_status") as RepositorySetupConfigStatus | undefined;
  const createdAt = iso(row, "created_at");
  if (
    !id ||
    !installationId ||
    !repositoryId ||
    revision === undefined ||
    !preset ||
    presetVersion === undefined ||
    !source ||
    !actorId ||
    !requestId ||
    workflowPath !== "readiness-runner.yml" ||
    !workflowStatus ||
    !configStatus ||
    !createdAt
  ) {
    return undefined;
  }
  const workflowContractVersion = integer(row, "workflow_contract_version");
  const configVersion = integer(row, "config_version");
  const observedSha = text(row, "observed_sha");
  return {
    id,
    installationId,
    repositoryId,
    revision,
    preset,
    presetVersion,
    source,
    actorId,
    requestId,
    workflowPath,
    ...(workflowContractVersion === undefined ? {} : { workflowContractVersion }),
    workflowStatus,
    configStatus,
    ...(configVersion === undefined ? {} : { configVersion }),
    ...(observedSha ? { observedSha } : {}),
    diagnostics: diagnostics(row),
    createdAt,
  };
}

export function createSqlRepositorySetupStore(
  executor: SqlQueryExecutor,
  options: { id?: () => string; now?: () => Date } = {},
): RepositorySetupStore {
  const id = options.id ?? randomUUID;
  const now = options.now ?? (() => new Date());

  return {
    async getContext(input) {
      const installationId = requiredIdentifier("installationId", input.installationId);
      const repositoryId = requiredIdentifier("repositoryId", input.repositoryId);
      const result = await executor.query(
        `select installations.id as installation_id,
                installations.github_installation_id,
                repositories.id as repository_id,
                repositories.github_repo_id,
                repositories.owner,
                repositories.name,
                repositories.private,
                repositories.default_branch,
                setup.id as setup_id,
                setup.revision,
                setup.preset,
                setup.preset_version,
                setup.source,
                setup.actor_id,
                setup.request_id,
                setup.workflow_path,
                setup.workflow_contract_version,
                setup.workflow_status,
                setup.config_status,
                setup.config_version,
                setup.observed_sha,
                setup.diagnostics,
                setup.created_at
           from repositories
           join installations on installations.id = repositories.installation_id
           left join repository_setup_revisions as setup
             on setup.id = repositories.current_setup_revision_id
          where installations.id = $1
            and repositories.id = $2
            and repositories.disabled_at is null`,
        [installationId, repositoryId],
      );
      const row = rows(result)[0];
      if (!row) return undefined;
      const githubInstallationId = integer(row, "github_installation_id");
      const githubRepositoryId = integer(row, "github_repo_id");
      const owner = text(row, "owner");
      const name = text(row, "name");
      const defaultBranch = text(row, "default_branch");
      if (githubInstallationId === undefined || githubRepositoryId === undefined || !owner || !name || !defaultBranch) {
        throw new Error("repository setup context is invalid");
      }
      const current = text(row, "setup_id") ? setupRevision(row) : undefined;
      return {
        installationId,
        githubInstallationId,
        repositoryId,
        githubRepositoryId,
        owner,
        name,
        private: boolean(row, "private"),
        defaultBranch,
        ...(current ? { current } : {}),
      };
    },

    async listRevisions(input) {
      const installationId = requiredIdentifier("installationId", input.installationId);
      const repositoryId = requiredIdentifier("repositoryId", input.repositoryId);
      const limit = input.limit ?? 20;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("limit is invalid");
      const result = await executor.query(
        `select * from repository_setup_revisions
          where installation_id = $1 and repository_id = $2
          order by revision desc
          limit $3`,
        [installationId, repositoryId, limit],
      );
      return rows(result)
        .map(setupRevision)
        .filter((value): value is RepositorySetupRevision => value !== undefined);
    },

    async applyRevision(input) {
      requiredIdentifier("installationId", input.installationId);
      requiredIdentifier("repositoryId", input.repositoryId);
      requiredIdentifier("actorId", input.actorId);
      requiredIdentifier("requestId", input.requestId);
      if (input.observedSha !== undefined && !shaPattern.test(input.observedSha))
        throw new Error("observedSha is invalid");
      const result = await executor.query(
        `select * from boardreadyops_apply_repository_setup_revision(
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15::timestamptz
         )`,
        [
          id(),
          input.installationId,
          input.repositoryId,
          input.preset,
          input.presetVersion,
          input.source,
          input.actorId,
          input.requestId,
          input.workflowStatus,
          input.workflowContractVersion ?? null,
          input.configStatus,
          input.configVersion ?? null,
          input.observedSha ?? null,
          JSON.stringify((input.diagnostics ?? []).slice(0, 32)),
          now().toISOString(),
        ],
      );
      const row = rows(result)[0] ?? {};
      const outcome = text(row, "outcome") as "applied" | "conflict" | "not_found" | "replayed" | undefined;
      if (!outcome) throw new Error("repository setup revision result is invalid");
      const revisionId = text(row, "revision_id");
      const revision = integer(row, "revision");
      return { outcome, ...(revisionId ? { revisionId } : {}), ...(revision === undefined ? {} : { revision }) };
    },

    async createProbe(input) {
      requiredIdentifier("installationId", input.installationId);
      requiredIdentifier("repositoryId", input.repositoryId);
      requiredIdentifier("requestedBy", input.requestedBy);
      requiredIdentifier("requestId", input.requestId);
      if (!Number.isFinite(input.expiresAt.valueOf()) || input.expiresAt <= now())
        throw new Error("expiresAt is invalid");
      const probeId = id();
      const result = await executor.query(
        `select * from boardreadyops_create_repository_setup_probe($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz)`,
        [
          probeId,
          input.installationId,
          input.repositoryId,
          input.requestedBy,
          input.requestId,
          input.expiresAt.toISOString(),
          now().toISOString(),
        ],
      );
      const row = rows(result)[0] ?? {};
      const outcome = text(row, "outcome") as "conflict" | "created" | "not_configured" | "replayed" | undefined;
      if (!outcome) throw new Error("repository setup probe result is invalid");
      const persistedProbeId = text(row, "probe_id");
      const setupRevisionId = text(row, "setup_revision_id");
      return {
        outcome,
        ...(persistedProbeId ? { probeId: persistedProbeId } : {}),
        ...(setupRevisionId ? { setupRevisionId } : {}),
      };
    },

    async getProbe(probeId) {
      requiredUuid("probeId", probeId);
      const result = await executor.query(
        `select probe.id as probe_id,
                probe.installation_id,
                installations.github_installation_id,
                probe.repository_id,
                repositories.github_repo_id,
                repositories.owner,
                repositories.name,
                repositories.default_branch,
                setup.preset,
                setup.preset_version,
                probe.status,
                probe.expires_at
           from repository_setup_probes as probe
           join installations on installations.id = probe.installation_id
           join repositories on repositories.id = probe.repository_id
           join repository_setup_revisions as setup on setup.id = probe.setup_revision_id
          where probe.id = $1`,
        [probeId],
      );
      const row = rows(result)[0];
      if (!row) return undefined;
      const githubInstallationId = integer(row, "github_installation_id");
      const githubRepositoryId = integer(row, "github_repo_id");
      const installationId = text(row, "installation_id");
      const repositoryId = text(row, "repository_id");
      const owner = text(row, "owner");
      const name = text(row, "name");
      const defaultBranch = text(row, "default_branch");
      const preset = text(row, "preset") as RepositorySetupPresetId | undefined;
      const presetVersion = integer(row, "preset_version");
      const status = text(row, "status") as "completed" | "dispatched" | "expired" | "failed" | "pending" | undefined;
      const expiresAt = iso(row, "expires_at");
      if (
        githubInstallationId === undefined ||
        githubRepositoryId === undefined ||
        !installationId ||
        !repositoryId ||
        !owner ||
        !name ||
        !defaultBranch ||
        !preset ||
        presetVersion === undefined ||
        !status ||
        !expiresAt
      ) {
        throw new Error("repository setup probe context is invalid");
      }
      return {
        probeId,
        installationId,
        githubInstallationId,
        repositoryId,
        githubRepositoryId,
        owner,
        name,
        defaultBranch,
        preset,
        presetVersion,
        status,
        expiresAt,
      };
    },

    async markProbeDispatched(input) {
      requiredUuid("probeId", input.probeId);
      if (!/^[1-9]\d{0,19}$/u.test(input.workflowRunId)) throw new Error("workflowRunId is invalid");
      const result = await executor.query(
        `select boardreadyops_mark_repository_setup_probe_dispatched($1, $2, $3::timestamptz) as outcome`,
        [input.probeId, input.workflowRunId, now().toISOString()],
      );
      return text(rows(result)[0] ?? {}, "outcome") ?? "invalid";
    },

    async failProbe(input) {
      requiredUuid("probeId", input.probeId);
      if (!/^[a-z][a-z0-9_]{0,63}$/u.test(input.failureCode)) throw new Error("failureCode is invalid");
      const result = await executor.query(
        `select boardreadyops_fail_repository_setup_probe($1, $2, $3::timestamptz) as outcome`,
        [input.probeId, input.failureCode, now().toISOString()],
      );
      return text(rows(result)[0] ?? {}, "outcome") ?? "invalid";
    },

    async completeProbe(input) {
      requiredUuid("probeId", input.probeId);
      if (!Number.isInteger(input.workflowContractVersion) || input.workflowContractVersion < 1) {
        throw new Error("workflowContractVersion is invalid");
      }
      if (!shaPattern.test(input.observedSha)) throw new Error("observedSha is invalid");
      const result = await executor.query(
        `select * from boardreadyops_complete_repository_setup_probe(
           $1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz
         )`,
        [
          input.probeId,
          id(),
          input.workflowContractVersion,
          input.configStatus,
          input.configVersion ?? null,
          input.observedSha,
          JSON.stringify((input.diagnostics ?? []).slice(0, 32)),
          now().toISOString(),
        ],
      );
      const row = rows(result)[0] ?? {};
      const outcome = text(row, "outcome");
      if (!outcome) throw new Error("repository setup completion result is invalid");
      const revisionId = text(row, "revision_id");
      const revision = integer(row, "revision");
      return { outcome, ...(revisionId ? { revisionId } : {}), ...(revision === undefined ? {} : { revision }) };
    },
  };
}
