import { createHash } from "node:crypto";
import {
  isRepositorySetupPresetId,
  repositorySetupPresets,
  repositorySetupPresetVersion,
} from "@boardreadyops/cloud-core/repository-setup";
import type { SqlQueryExecutor } from "@boardreadyops/db/lifecycle-store";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import {
  createSqlRepositorySetupStore,
  type RepositorySetupContext,
  type RepositorySetupStore,
} from "@boardreadyops/db/repository-setup-store";
import { readBoundedRequestBody } from "./bounded-request-body.js";
import { authenticateControlPlaneOperator } from "./control-plane-operator-auth.js";
import { controlPlaneJsonError, controlPlaneJsonResponse } from "./control-plane-operator-response.js";
import { createRepositorySetupGitHubClient, type RepositorySetupGitHubClient } from "./repository-setup-github.js";

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const maximumBodyBytes = 32 * 1024;
const probeLifetimeMs = 15 * 60 * 1000;

export type RepositorySetupRouteDependencies = {
  environment: Readonly<Record<string, string | undefined>>;
  queryExecutor(): SqlQueryExecutor | undefined;
  createStore(executor: SqlQueryExecutor): RepositorySetupStore;
  githubClient(): RepositorySetupGitHubClient;
  now(): Date;
};

function createRepositorySetupRouteDependencies(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): RepositorySetupRouteDependencies {
  return {
    environment,
    queryExecutor() {
      const connectionString = environment.DATABASE_URL;
      if (!connectionString) return undefined;
      return createPgQueryExecutor({ connectionString, max: Number(environment.DATABASE_POOL_MAX ?? 5) });
    },
    createStore: createSqlRepositorySetupStore,
    githubClient: () => createRepositorySetupGitHubClient({ environment }),
    now: () => new Date(),
  };
}

function validIdentifier(value: string): boolean {
  return identifierPattern.test(value);
}

function readinessRequestId(requestId: string): string {
  return `readiness:${createHash("sha256").update(requestId).digest("hex")}`;
}

function workflowRemediation(
  status: Awaited<ReturnType<RepositorySetupGitHubClient["inspect"]>>["workflowStatus"],
): string {
  switch (status) {
    case "actions_disabled":
      return "enable GitHub Actions and confirm the App has Actions read/write permission, then retry the probe";
    case "disabled":
      return "enable .github/workflows/readiness-runner.yml on the default branch, then retry the probe";
    case "incompatible":
      return "replace .github/workflows/readiness-runner.yml with the reviewed canonical v1 workflow";
    case "missing":
      return "add .github/workflows/readiness-runner.yml to the default branch and confirm the App has Actions read/write permission";
    default:
      return "retry after GitHub workflow metadata becomes available";
  }
}

function authentication(
  request: Request,
  dependencies: RepositorySetupRouteDependencies,
): { actorId: string } | Response {
  const result = authenticateControlPlaneOperator(request, dependencies.environment);
  if (result.status === "disabled") return controlPlaneJsonError("operator API is not configured", 503);
  if (result.status === "rate_limited") {
    return controlPlaneJsonError(
      `Too many failed authentication attempts, retry after ${result.retryAfterSeconds}s`,
      429,
      { "retry-after": String(result.retryAfterSeconds) },
    );
  }
  if (result.status === "unauthorized") {
    return controlPlaneJsonError("operator authentication is required", 401, { "www-authenticate": "Bearer" });
  }
  return { actorId: result.actorId };
}

async function requestBody(request: Request): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed = JSON.parse((await readBoundedRequestBody(request, maximumBodyBytes)).toString("utf8")) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function setupResponseBase() {
  return {
    presets: repositorySetupPresets,
    workflow: {
      path: ".github/workflows/readiness-runner.yml",
      configurationPath: "boardreadyops.yml",
      installation: "Copy the reviewed workflow and selected boardreadyops.yml to the repository default branch.",
    },
    permissions: {
      repository: {
        metadata: "read",
        pullRequests: "read",
        checks: "write",
        actions: "write",
        contents: "none",
      },
      organization: "none",
      account: "none",
    },
    assistedInstallation: {
      available: false,
      explicitOptInRequired: true,
      requiredAdditionalPermission: "contents:write",
      reason: "The production App intentionally does not write repository contents or workflows.",
    },
  } as const;
}

export async function handleRepositorySetupGet(
  request: Request,
  installationId: string,
  repositoryId: string,
  dependencies: RepositorySetupRouteDependencies = createRepositorySetupRouteDependencies(),
): Promise<Response> {
  const authenticated = authentication(request, dependencies);
  if (authenticated instanceof Response) return authenticated;
  if (!validIdentifier(installationId) || !validIdentifier(repositoryId)) {
    return controlPlaneJsonError("repository setup scope is invalid", 400);
  }
  const executor = dependencies.queryExecutor();
  if (!executor) return controlPlaneJsonError("database is not configured", 503);
  const store = dependencies.createStore(executor);
  let context: Awaited<ReturnType<typeof store.getContext>>;
  let history: Awaited<ReturnType<typeof store.listRevisions>>;
  try {
    [context, history] = await Promise.all([
      store.getContext({ installationId, repositoryId }),
      store.listRevisions({ installationId, repositoryId, limit: 50 }),
    ]);
  } catch {
    return controlPlaneJsonError("repository setup state is temporarily unavailable", 503);
  }
  if (!context) return controlPlaneJsonError("repository is unavailable", 404);

  let github:
    | Awaited<ReturnType<RepositorySetupGitHubClient["inspect"]>>
    | { actionsEnabled: false; workflowStatus: "unknown" };
  try {
    github = await dependencies.githubClient().inspect({
      githubInstallationId: context.githubInstallationId,
      owner: context.owner,
      name: context.name,
    });
  } catch {
    github = { actionsEnabled: false, workflowStatus: "unknown" as const };
  }
  return controlPlaneJsonResponse(
    {
      ok: true,
      ...setupResponseBase(),
      repository: {
        id: context.repositoryId,
        fullName: `${context.owner}/${context.name}`,
        private: context.private,
        defaultBranch: context.defaultBranch,
      },
      current: context.current,
      history,
      github,
      ready: context.current?.workflowStatus === "ready" && context.current.configStatus === "ready",
    },
    200,
  );
}

async function selectPreset(
  body: Record<string, unknown>,
  actorId: string,
  installationId: string,
  repositoryId: string,
  store: RepositorySetupStore,
): Promise<Response> {
  const preset = body.preset;
  const requestId = body.requestId;
  if (!isRepositorySetupPresetId(preset) || typeof requestId !== "string" || !validIdentifier(requestId)) {
    return controlPlaneJsonError("preset and requestId are required", 400);
  }
  const applied = await store.applyRevision({
    installationId,
    repositoryId,
    preset,
    presetVersion: repositorySetupPresetVersion,
    source: "operator",
    actorId,
    requestId,
    workflowStatus: "unknown",
    configStatus: "unknown",
  });
  if (applied.outcome === "not_found") return controlPlaneJsonError("repository is unavailable", 404);
  if (applied.outcome === "conflict")
    return controlPlaneJsonError("requestId conflicts with an existing setup change", 409);
  return controlPlaneJsonResponse({ ok: true, ...applied }, applied.outcome === "applied" ? 201 : 200);
}

type SelectedSetupRevision = NonNullable<RepositorySetupContext["current"]>;
type ProbeReadinessStatus = Exclude<
  Awaited<ReturnType<RepositorySetupGitHubClient["inspect"]>>["workflowStatus"],
  "probe_required"
>;
type ProbeDispatch = Awaited<ReturnType<RepositorySetupGitHubClient["dispatchProbe"]>>;

async function rejectUnavailableProbeReadiness(
  store: RepositorySetupStore,
  context: RepositorySetupContext,
  current: SelectedSetupRevision,
  actorId: string,
  requestId: string,
  workflowStatus: ProbeReadinessStatus,
): Promise<Response> {
  await store.applyRevision({
    installationId: context.installationId,
    repositoryId: context.repositoryId,
    preset: current.preset,
    presetVersion: current.presetVersion,
    source: "operator",
    actorId,
    requestId: readinessRequestId(requestId),
    workflowStatus,
    configStatus: "unknown",
    diagnostics: [`GitHub readiness: ${workflowStatus}`],
  });
  return controlPlaneJsonError(
    `repository workflow readiness is ${workflowStatus}; ${workflowRemediation(workflowStatus)}`,
    409,
  );
}

async function replayedProbeResponse(store: RepositorySetupStore, probeId: string): Promise<Response> {
  const replayed = await store.getProbe(probeId);
  if (!replayed) return controlPlaneJsonError("repository setup probe is unavailable", 404);
  if (replayed.status === "expired") return controlPlaneJsonError("repository setup probe expired", 410);
  if (replayed.status === "failed") {
    return controlPlaneJsonError("repository setup probe previously failed; use a new requestId", 409);
  }
  return controlPlaneJsonResponse({ ok: true, outcome: "replayed", probeId, status: replayed.status }, 200);
}

async function staleProbeDispatchResponse(
  store: RepositorySetupStore,
  probeId: string,
  dispatched: ProbeDispatch,
): Promise<Response> {
  const terminal = await store.getProbe(probeId);
  if (terminal?.status === "completed") {
    return controlPlaneJsonResponse(
      {
        ok: true,
        outcome: "completed",
        probeId,
        workflowRunId: dispatched.workflowRunId,
        ...(dispatched.workflowRunUrl ? { workflowRunUrl: dispatched.workflowRunUrl } : {}),
      },
      200,
    );
  }
  if (terminal?.status === "expired") return controlPlaneJsonError("repository setup probe expired", 410);
  if (terminal?.status === "failed") return controlPlaneJsonError("repository setup probe failed", 409);
  return controlPlaneJsonError("repository setup probe state changed before dispatch completed", 409);
}

async function persistedProbeDispatchResponse(
  store: RepositorySetupStore,
  probeId: string,
  dispatched: ProbeDispatch,
  marked: string,
): Promise<Response> {
  if (marked === "expired") return controlPlaneJsonError("repository setup probe expired", 410);
  if (marked === "not_found") return controlPlaneJsonError("repository setup probe is unavailable", 404);
  if (marked === "stale") return staleProbeDispatchResponse(store, probeId, dispatched);
  if (marked !== "applied" && marked !== "replayed") {
    return controlPlaneJsonError("repository setup probe state could not be persisted", 503);
  }
  return controlPlaneJsonResponse(
    {
      ok: true,
      outcome: "dispatched",
      probeId,
      workflowRunId: dispatched.workflowRunId,
      ...(dispatched.workflowRunUrl ? { workflowRunUrl: dispatched.workflowRunUrl } : {}),
    },
    202,
  );
}

async function dispatchSetupProbe(
  store: RepositorySetupStore,
  githubClient: RepositorySetupGitHubClient,
  context: RepositorySetupContext,
  probeId: string,
): Promise<Response> {
  try {
    const dispatched = await githubClient.dispatchProbe({
      githubInstallationId: context.githubInstallationId,
      owner: context.owner,
      name: context.name,
      defaultBranch: context.defaultBranch,
      probeId,
    });
    const marked = await store.markProbeDispatched({ probeId, workflowRunId: dispatched.workflowRunId });
    return persistedProbeDispatchResponse(store, probeId, dispatched, marked);
  } catch {
    await store.failProbe({ probeId, failureCode: "dispatch_failed" });
    return controlPlaneJsonError("repository setup probe dispatch failed", 502);
  }
}

async function createProbe(
  body: Record<string, unknown>,
  actorId: string,
  installationId: string,
  repositoryId: string,
  store: RepositorySetupStore,
  dependencies: RepositorySetupRouteDependencies,
): Promise<Response> {
  const requestId = body.requestId;
  if (typeof requestId !== "string" || !validIdentifier(requestId)) {
    return controlPlaneJsonError("requestId is required", 400);
  }
  const context = await store.getContext({ installationId, repositoryId });
  if (!context) return controlPlaneJsonError("repository is unavailable", 404);
  const current = context.current;
  if (!current) return controlPlaneJsonError("select a policy preset before validating repository readiness", 409);

  const githubClient = dependencies.githubClient();
  let readiness: Awaited<ReturnType<typeof githubClient.inspect>>;
  try {
    readiness = await githubClient.inspect({
      githubInstallationId: context.githubInstallationId,
      owner: context.owner,
      name: context.name,
    });
  } catch {
    return controlPlaneJsonError("GitHub repository readiness is temporarily unavailable", 503);
  }
  if (readiness.workflowStatus !== "probe_required") {
    return rejectUnavailableProbeReadiness(store, context, current, actorId, requestId, readiness.workflowStatus);
  }

  const created = await store.createProbe({
    installationId,
    repositoryId,
    requestedBy: actorId,
    requestId,
    expiresAt: new Date(dependencies.now().valueOf() + probeLifetimeMs),
  });
  if (created.outcome === "not_configured") {
    return controlPlaneJsonError("select a policy preset before validating repository readiness", 409);
  }
  if (created.outcome === "conflict") {
    return controlPlaneJsonError("requestId conflicts with an existing setup probe", 409);
  }
  if (!created.probeId) return controlPlaneJsonError("repository setup probe could not be created", 503);
  if (created.outcome === "replayed") return replayedProbeResponse(store, created.probeId);
  return dispatchSetupProbe(store, githubClient, context, created.probeId);
}

export async function handleRepositorySetupPost(
  request: Request,
  installationId: string,
  repositoryId: string,
  dependencies: RepositorySetupRouteDependencies = createRepositorySetupRouteDependencies(),
): Promise<Response> {
  const authenticated = authentication(request, dependencies);
  if (authenticated instanceof Response) return authenticated;
  if (!validIdentifier(installationId) || !validIdentifier(repositoryId)) {
    return controlPlaneJsonError("repository setup scope is invalid", 400);
  }
  const body = await requestBody(request);
  if (!body) return controlPlaneJsonError("repository setup request is invalid", 400);
  const executor = dependencies.queryExecutor();
  if (!executor) return controlPlaneJsonError("database is not configured", 503);
  const store = dependencies.createStore(executor);
  try {
    if (body.action === "select_preset") {
      return await selectPreset(body, authenticated.actorId, installationId, repositoryId, store);
    }
    if (body.action === "probe") {
      return await createProbe(body, authenticated.actorId, installationId, repositoryId, store, dependencies);
    }
    return controlPlaneJsonError("repository setup action is unsupported", 400);
  } catch {
    return controlPlaneJsonError("repository setup operation failed", 503);
  }
}
