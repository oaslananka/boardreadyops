import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import {
  createSqlRunnerFleetHealthStore,
  type RunnerFleetHealthSnapshot,
} from "@boardreadyops/db/runner-fleet-health-store";
import { checkCloudReadiness } from "./cloud-readiness.js";
import { loadViewerRepositories } from "./repository-dashboard.js";
import type { UserSession } from "./user-session.js";
import { type ViewerInstallation, viewerInstallations } from "./viewer-installations.js";

type SetupSummary = { ready: number; attention: number; unconfigured: number };
type RepositoryGroups = readonly { accountLogin: string; repositories: readonly { id: string }[] }[];
type CloudSignal = { ok: boolean; reason?: string };

export type IntegrationHealthSnapshot = {
  deployment: { status: "healthy" | "degraded"; reason?: string };
  installations: Array<{
    id: string;
    accountLogin: string;
    planTier: string;
    githubApp: "connected";
    repositories: { total: number; ready: number; attention: number; unconfigured: number };
    componentIntelligence: "configured" | "not_configured" | "rejected";
    runner: { status: RunnerFleetHealthSnapshot["status"]; active: number; online: number; pendingJobs: number };
  }>;
};

export function summarizeIntegrationHealth(input: {
  cloud: CloudSignal;
  installations: readonly ViewerInstallation[];
  repositories: RepositoryGroups;
  setup: ReadonlyMap<string, SetupSummary>;
  runnerFleet: ReadonlyMap<string, RunnerFleetHealthSnapshot>;
}): IntegrationHealthSnapshot {
  return {
    deployment: input.cloud.ok
      ? { status: "healthy" }
      : { status: "degraded", ...(input.cloud.reason ? { reason: input.cloud.reason } : {}) },
    installations: input.installations.map((installation) => {
      const total =
        input.repositories.find((group) => group.accountLogin === installation.accountLogin)?.repositories.length ?? 0;
      const setup = input.setup.get(installation.id) ?? { ready: 0, attention: 0, unconfigured: total };
      const fleet = input.runnerFleet.get(installation.id);
      return {
        id: installation.id,
        accountLogin: installation.accountLogin,
        planTier: installation.planTier,
        githubApp: "connected" as const,
        repositories: { total, ...setup },
        componentIntelligence: installation.componentCredentialRejectedAt
          ? ("rejected" as const)
          : installation.hasComponentCredential
            ? ("configured" as const)
            : ("not_configured" as const),
        runner: fleet
          ? {
              status: fleet.status,
              active: fleet.registrations.active,
              online: fleet.registrations.online,
              pendingJobs: fleet.queue.pendingJobs,
            }
          : { status: "not_configured" as const, active: 0, online: 0, pendingJobs: 0 },
      };
    }),
  };
}

async function setupSummaries(
  executor: ReturnType<typeof createPgQueryExecutor>,
  installationIds: readonly string[],
): Promise<Map<string, SetupSummary>> {
  if (installationIds.length === 0) return new Map();
  const result = await executor.query(
    `select installations.id as installation_id,
            count(repositories.id) filter (
              where setup.workflow_status = 'ready' and setup.config_status = 'ready'
            )::int as ready,
            count(repositories.id) filter (
              where repositories.current_setup_revision_id is not null
                and not (setup.workflow_status = 'ready' and setup.config_status = 'ready')
            )::int as attention,
            count(repositories.id) filter (where repositories.current_setup_revision_id is null)::int as unconfigured
       from installations
       left join repositories on repositories.installation_id = installations.id and repositories.disabled_at is null
       left join repository_setup_revisions as setup on setup.id = repositories.current_setup_revision_id
      where installations.id = any($1::text[])
      group by installations.id`,
    [installationIds],
  );
  const rows = (result as { rows?: readonly Record<string, unknown>[] }).rows ?? [];
  return new Map(
    rows.flatMap((row): Array<[string, SetupSummary]> => {
      const id = typeof row.installation_id === "string" ? row.installation_id : undefined;
      if (!id) return [];
      const count = (name: string) => {
        const parsed = Number(row[name]);
        return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
      };
      return [[id, { ready: count("ready"), attention: count("attention"), unconfigured: count("unconfigured") }]];
    }),
  );
}

export type IntegrationHealthResult =
  | { state: "ok"; snapshot: IntegrationHealthSnapshot }
  | { state: "unavailable"; reason: string };

export async function loadIntegrationHealth(
  session: UserSession,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<IntegrationHealthResult> {
  const cloud = await checkCloudReadiness({ environment });
  if (!environment.DATABASE_URL?.trim()) {
    return {
      state: "ok",
      snapshot: summarizeIntegrationHealth({
        cloud,
        installations: [],
        repositories: [],
        setup: new Map(),
        runnerFleet: new Map(),
      }),
    };
  }

  try {
    const [installations, repositories] = await Promise.all([
      viewerInstallations(session, "nexar", environment),
      loadViewerRepositories(session, environment),
    ]);
    const executor = createPgQueryExecutor({ connectionString: environment.DATABASE_URL, max: 1 });
    try {
      const setup = await setupSummaries(
        executor,
        installations.map((installation) => installation.id),
      );
      const runnerStore = createSqlRunnerFleetHealthStore(executor);
      const observedAt = new Date();
      const runnerEntries = await Promise.all(
        installations.map(async (installation): Promise<[string, RunnerFleetHealthSnapshot] | undefined> => {
          const snapshot = await runnerStore.readFleetHealth({
            installationId: installation.id,
            observedAt,
            observationWindowSeconds: 300,
          });
          return snapshot ? [installation.id, snapshot] : undefined;
        }),
      );
      return {
        state: "ok",
        snapshot: summarizeIntegrationHealth({
          cloud,
          installations,
          repositories,
          setup,
          runnerFleet: new Map(
            runnerEntries.filter((entry): entry is [string, RunnerFleetHealthSnapshot] => entry !== undefined),
          ),
        }),
      };
    } finally {
      await executor.close();
    }
  } catch {
    return { state: "unavailable", reason: "Integration health could not be read from the control-plane database." };
  }
}
