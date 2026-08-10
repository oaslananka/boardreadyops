import type { SqlQueryExecutor } from "@boardreadyops/db/lifecycle-store";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { createSqlRepositorySetupStore, type RepositorySetupStore } from "@boardreadyops/db/repository-setup-store";
import { readBoundedRequestBody } from "./bounded-request-body.js";
import { controlPlaneJsonError, controlPlaneJsonResponse } from "./control-plane-operator-response.js";
import { verifyGitHubActionsOidcToken } from "./github-actions-oidc.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const shaPattern = /^[0-9a-f]{40}$/u;
const bearerPattern = /^Bearer ([A-Za-z0-9._~-]{100,20000})$/u;
const maximumBodyBytes = 16 * 1024;

export type RepositorySetupProbeRouteDependencies = {
  queryExecutor(): SqlQueryExecutor | undefined;
  createStore(executor: SqlQueryExecutor): Pick<RepositorySetupStore, "completeProbe" | "getProbe">;
  verifyOidc: typeof verifyGitHubActionsOidcToken;
};

function createRepositorySetupProbeRouteDependencies(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): RepositorySetupProbeRouteDependencies {
  return {
    queryExecutor() {
      const connectionString = environment.DATABASE_URL;
      if (!connectionString) return undefined;
      return createPgQueryExecutor({ connectionString, max: Number(environment.DATABASE_POOL_MAX ?? 5) });
    },
    createStore: createSqlRepositorySetupStore,
    verifyOidc: verifyGitHubActionsOidcToken,
  };
}

type SetupProbeResult = {
  contractVersion: number;
  configStatus: "invalid" | "missing" | "ready";
  configVersion?: number;
  observedSha: string;
  diagnostics: string[];
};

function bearerToken(request: Request): string | undefined {
  const authorization = request.headers.get("authorization") ?? "";
  return bearerPattern.exec(authorization)?.[1];
}

function parsedResult(value: unknown): SetupProbeResult | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const body = value as Record<string, unknown>;
  const contractVersion = body.contractVersion;
  const configStatus = body.configStatus;
  const configVersion = body.configVersion;
  const observedSha = body.observedSha;
  const diagnosticsValue = body.diagnostics ?? [];
  if (!Number.isInteger(contractVersion) || Number(contractVersion) < 1 || Number(contractVersion) > 16)
    return undefined;
  if (configStatus !== "invalid" && configStatus !== "missing" && configStatus !== "ready") return undefined;
  if (configStatus === "ready" && configVersion !== 1) return undefined;
  if (configStatus !== "ready" && configVersion !== undefined) return undefined;
  if (typeof observedSha !== "string" || !shaPattern.test(observedSha)) return undefined;
  if (
    !Array.isArray(diagnosticsValue) ||
    diagnosticsValue.length > 32 ||
    diagnosticsValue.some((entry) => typeof entry !== "string" || entry.length < 1 || entry.length > 512)
  ) {
    return undefined;
  }
  return {
    contractVersion: Number(contractVersion),
    configStatus,
    ...(configVersion === 1 ? { configVersion: 1 } : {}),
    observedSha,
    diagnostics: diagnosticsValue as string[],
  };
}

async function requestBody(request: Request): Promise<unknown | undefined> {
  try {
    return JSON.parse((await readBoundedRequestBody(request, maximumBodyBytes)).toString("utf8")) as unknown;
  } catch {
    return undefined;
  }
}

type ProbeCompletion = Awaited<ReturnType<RepositorySetupStore["completeProbe"]>>;

function probeCompletionResponse(completed: ProbeCompletion): Response {
  if (completed.outcome === "expired") return controlPlaneJsonError("repository setup probe expired", 410);
  if (completed.outcome === "stale") return controlPlaneJsonError("repository setup probe is stale", 409);
  if (completed.outcome === "not_found") return controlPlaneJsonError("repository setup probe is unavailable", 404);
  if (completed.outcome !== "completed" && completed.outcome !== "replayed") {
    return controlPlaneJsonError("repository setup probe conflicted", 409);
  }
  return controlPlaneJsonResponse(
    {
      ok: true,
      outcome: completed.outcome,
      ...(completed.revisionId ? { revisionId: completed.revisionId } : {}),
      ...(completed.revision === undefined ? {} : { revision: completed.revision }),
    },
    200,
  );
}

export async function handleRepositorySetupProbeResult(
  request: Request,
  dependencies: RepositorySetupProbeRouteDependencies = createRepositorySetupProbeRouteDependencies(),
): Promise<Response> {
  const probeId = new URL(request.url).searchParams.get("probe_id") ?? "";
  if (!uuidPattern.test(probeId)) return controlPlaneJsonError("valid probe_id is required", 400);
  const token = bearerToken(request);
  if (!token) {
    return controlPlaneJsonError("GitHub Actions OIDC authentication is required", 401, {
      "www-authenticate": "Bearer",
    });
  }
  const body = parsedResult(await requestBody(request));
  if (!body) return controlPlaneJsonError("repository setup probe result is invalid", 400);

  const executor = dependencies.queryExecutor();
  if (!executor) return controlPlaneJsonError("database is not configured", 503);
  const store = dependencies.createStore(executor);
  let probe: Awaited<ReturnType<typeof store.getProbe>>;
  try {
    probe = await store.getProbe(probeId);
  } catch {
    return controlPlaneJsonError("repository setup authentication lookup failed", 503);
  }
  if (!probe) return controlPlaneJsonError("repository setup probe is unavailable", 404);

  const repository = `${probe.owner}/${probe.name}`;
  const ref = `refs/heads/${probe.defaultBranch}`;
  const workflowRef = `${repository}/.github/workflows/readiness-runner.yml@${ref}`;
  const verified = await dependencies.verifyOidc(token, {
    runId: probeId,
    audience: `boardreadyops-setup:${probeId}`,
    repository,
    repositoryId: String(probe.githubRepositoryId),
    workflowRef,
    ref,
    sha: body.observedSha,
  });
  if (!verified) return controlPlaneJsonError("invalid GitHub Actions OIDC authentication", 401);

  let completed: Awaited<ReturnType<typeof store.completeProbe>>;
  try {
    completed = await store.completeProbe({
      probeId,
      workflowContractVersion: body.contractVersion,
      configStatus: body.configStatus,
      ...(body.configVersion === undefined ? {} : { configVersion: body.configVersion }),
      observedSha: body.observedSha,
      diagnostics: body.diagnostics,
    });
  } catch {
    return controlPlaneJsonError("repository setup probe could not be persisted", 503);
  }
  return probeCompletionResponse(completed);
}
