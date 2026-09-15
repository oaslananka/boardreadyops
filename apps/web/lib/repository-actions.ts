import { createHash, randomUUID } from "node:crypto";
import {
  checkCapabilityRequirement,
  evaluateAppCapabilities,
  type GitHubAppActionId,
  githubAppActions,
} from "@boardreadyops/cloud-core/github-capabilities";
import type { GitHubAppLifecycleAction } from "@boardreadyops/cloud-core/lifecycle";
import { createSqlControlPlaneJobStore } from "@boardreadyops/db/control-plane-job-store";
import type { SqlQueryExecutor } from "@boardreadyops/db/lifecycle-store";
import { createSqlRepositorySetupStore, type RepositorySetupContext } from "@boardreadyops/db/repository-setup-store";
import { authenticateApiRequest, resolveRepositoryApiContext } from "./api-auth.js";
import { readBoundedRequestBody } from "./bounded-request-body.js";
import { createInstallationCapabilitiesDependencies } from "./installation-capabilities.js";
import { databaseErrorCode, emitRepositoryActionTelemetry, errorClassOf } from "./repository-action-telemetry.js";
import { handleRepositorySetupCreatePrForActor } from "./repository-setup-routes.js";

/**
 * The dashboard's action surface, and the reason it exists.
 *
 * `rerun`, `waive`, `release-preview`, and `setup` were reachable only as `/boardreadyops` slash
 * commands on a pull request. Everything behind them — the capability checks, the durable
 * lifecycle queue, the mutation service's branch and path allowlist, the audit rows — was
 * already written and tested; only the entry point was missing, so a signed-in maintainer had to
 * leave the product and type a command into GitHub to do the thing the product is for.
 *
 * This module adds that entry point without a second implementation of any of it:
 *
 * - `setup` reuses the synchronous `createSetupPr` path the operator API already calls.
 * - `rerun`, `release-preview`, and `waive` enqueue the exact lifecycle actions
 *   `executeParsedCommand` builds, through the same `acceptGitHubWebhook` intake the webhook
 *   uses. They therefore inherit its idempotency, retry, dead-lettering, and audit trail, and
 *   the capability refusal a restricted installation gets is the identical one.
 *
 * Authorization is `authenticateApiRequest` + `resolveRepositoryApiContext`: a session may act
 * only on repositories belonging to an installation its cookie recorded.
 */

const maximumBodyBytes = 16 * 1024;
const ruleIdPattern = /^[a-zA-Z0-9_.-]{1,100}$/u;
/** Mirrors the reason floor the review decision API enforces, so a waiver reads the same either way. */
const minimumWaiverReasonLength = 20;
const maximumWaiverReasonLength = 500;

export type RepositoryActionRequest = {
  action: GitHubAppActionId;
  /** The run whose head commit the action applies to. Required by rerun and release-preview. */
  runId?: string;
  ruleId?: string;
  reason?: string;
  preset?: string;
  /** Caller-supplied idempotency key. One is generated when absent. */
  requestId?: string;
};

export type RepositoryActionDependencies = {
  environment: Readonly<Record<string, string | undefined>>;
  readPermissions(githubInstallationId: number): Promise<Readonly<Record<string, string>> | undefined>;
  now(): Date;
  newId(): string;
};

function createRepositoryActionDependencies(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): RepositoryActionDependencies {
  const capabilities = createInstallationCapabilitiesDependencies(environment);
  return {
    environment,
    readPermissions: (githubInstallationId) => capabilities.readPermissions(githubInstallationId),
    now: () => new Date(),
    newId: () => randomUUID(),
  };
}

function json(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function isActionId(value: unknown): value is GitHubAppActionId {
  return typeof value === "string" && githubAppActions.some((action) => action.id === value);
}

async function parseBody(request: Request): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed = JSON.parse((await readBoundedRequestBody(request, maximumBodyBytes)).toString("utf8")) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function readString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Validates the action payload before anything is authorized or enqueued.
 *
 * A waiver without a reason is rejected here rather than at the mutation service, so the viewer
 * is told what is missing instead of watching a queued job fail somewhere they cannot see.
 */
export function parseRepositoryActionRequest(
  body: Record<string, unknown>,
): RepositoryActionRequest | { error: string } {
  const action = body.action;
  if (!isActionId(action))
    return { error: `action must be one of: ${githubAppActions.map((entry) => entry.id).join(", ")}` };

  const request: RepositoryActionRequest = { action };
  const runId = readString(body, "runId");
  const ruleId = readString(body, "ruleId");
  const reason = readString(body, "reason");
  const preset = readString(body, "preset");
  const requestId = readString(body, "requestId");
  if (runId) request.runId = runId;
  if (ruleId) request.ruleId = ruleId;
  if (reason) request.reason = reason;
  if (preset) request.preset = preset;
  if (requestId) request.requestId = requestId;

  if (action === "rerun" || action === "release-preview") {
    if (!request.runId) return { error: "runId is required to re-run or preview a release" };
  }

  if (action === "waive") {
    if (!request.ruleId || !ruleIdPattern.test(request.ruleId)) {
      return { error: "ruleId is required and must match [a-zA-Z0-9_.-]{1,100}" };
    }
    if (!request.reason || request.reason.length < minimumWaiverReasonLength) {
      return { error: `reason is required and must be at least ${minimumWaiverReasonLength} characters` };
    }
    if (request.reason.length > maximumWaiverReasonLength) {
      return { error: `reason must be at most ${maximumWaiverReasonLength} characters` };
    }
  }

  if (action === "fix") {
    return { error: "Remediation pull requests are not available yet. Use the setup action or apply the fix locally." };
  }

  return request;
}

type RunTarget = {
  runId: string;
  ref: string;
  commitSha: string;
  pullRequestNumber: number | undefined;
  baseCommitSha: string | undefined;
};

async function loadRunTarget(
  executor: SqlQueryExecutor,
  repositoryId: string,
  runId: string,
): Promise<RunTarget | undefined> {
  const result = await executor.query(
    `select id, ref, commit_sha, base_commit_sha, pull_request_number
       from release_runs
      where id = $1 and repository_id = $2
      limit 1`,
    [runId, repositoryId],
  );
  const row = ((result as { rows?: readonly Record<string, unknown>[] }).rows ?? [])[0];
  if (!row) return undefined;
  const ref = typeof row.ref === "string" ? row.ref : undefined;
  const commitSha = typeof row.commit_sha === "string" ? row.commit_sha : undefined;
  if (!ref || !commitSha) return undefined;
  const pullRequestNumber = typeof row.pull_request_number === "number" ? row.pull_request_number : undefined;
  const baseCommitSha = typeof row.base_commit_sha === "string" ? row.base_commit_sha : undefined;
  return { runId, ref, commitSha, pullRequestNumber, baseCommitSha };
}

async function loadSetupContext(
  executor: SqlQueryExecutor,
  repositoryId: string,
): Promise<RepositorySetupContext | undefined> {
  const result = await executor.query(
    `select repositories.installation_id
       from repositories
      where repositories.id = $1
      limit 1`,
    [repositoryId],
  );
  const row = ((result as { rows?: readonly Record<string, unknown>[] }).rows ?? [])[0];
  const installationId = typeof row?.installation_id === "string" ? row.installation_id : undefined;
  if (!installationId) return undefined;
  return (await createSqlRepositorySetupStore(executor).getContext({ installationId, repositoryId })) ?? undefined;
}

/**
 * Builds the lifecycle actions an intent maps to.
 *
 * Deliberately the same shapes `executeParsedCommand` emits for the equivalent slash command.
 * A UI re-run and a `/boardreadyops rerun` therefore produce byte-identical queue entries.
 */
type EnqueueAction = Extract<GitHubAppLifecycleAction, { type: "release_run.enqueue" }>;
type PrepareAction = Extract<GitHubAppLifecycleAction, { type: "release.prepare" }>;
type WaiverAction = Extract<GitHubAppLifecycleAction, { type: "waiver_pr.request" }>;

export function lifecycleActionsFor(
  request: RepositoryActionRequest,
  context: RepositorySetupContext,
  target: RunTarget | undefined,
): readonly GitHubAppLifecycleAction[] {
  const installation = { id: context.githubInstallationId };
  const repository = {
    id: context.githubRepositoryId,
    owner: context.owner,
    name: context.name,
    fullName: `${context.owner}/${context.name}`,
    private: context.private,
    defaultBranch: context.defaultBranch,
  };

  // Both lifecycle actions are pull-request shaped: the readiness runner reports onto a PR, and
  // a release preview builds the checklist for one. A run from a branch push has nothing to
  // report back onto, so the caller is told that rather than having an action silently dropped.
  if (request.action === "rerun" && target?.pullRequestNumber !== undefined) {
    const action: EnqueueAction = {
      type: "release_run.enqueue",
      installation,
      repository,
      pullRequestNumber: target.pullRequestNumber,
      ref: target.ref,
      commitSha: target.commitSha,
      triggerKind: "pr",
    };
    if (target.baseCommitSha) action.baseCommitSha = target.baseCommitSha;
    return [action];
  }

  if (request.action === "release-preview" && target?.pullRequestNumber !== undefined) {
    const action: PrepareAction = {
      type: "release.prepare",
      installation,
      repository,
      pullRequestNumber: target.pullRequestNumber,
      ref: target.ref,
      commitSha: target.commitSha,
    };
    if (target.baseCommitSha) action.baseCommitSha = target.baseCommitSha;
    return [action];
  }

  if (request.action === "waive" && request.ruleId && request.reason) {
    const action: WaiverAction = {
      type: "waiver_pr.request",
      installation,
      repository,
      ruleId: request.ruleId,
      reason: request.reason,
    };
    return [action];
  }

  return [];
}

/**
 * A deterministic delivery id for the durable intake.
 *
 * Derived from the repository, the intent and the caller's requestId so a double-clicked button
 * folds into one queued job instead of two runs, and so a retry from the client is a no-op.
 */
export function actionDeliveryId(repositoryId: string, request: RepositoryActionRequest, requestId: string): string {
  const material = [repositoryId, request.action, request.runId ?? "", request.ruleId ?? "", requestId].join("|");
  return `ui:${createHash("sha256").update(material).digest("hex").slice(0, 40)}`;
}

export async function handleRepositoryAction(
  request: Request,
  repositoryId: string,
  dependencies: RepositoryActionDependencies = createRepositoryActionDependencies(),
): Promise<Response> {
  const auth = await authenticateApiRequest(request, "runs:write");
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const body = await parseBody(request);
  if (!body) return json({ ok: false, error: "A JSON object body is required" }, 400);
  const parsed = parseRepositoryActionRequest(body);
  if ("error" in parsed) return json({ ok: false, error: parsed.error }, 400);

  const scope = await resolveRepositoryApiContext(auth, request, repositoryId);
  if (scope instanceof Response) return scope;

  try {
    const context = await loadSetupContext(scope.executor, scope.repositoryId);
    if (!context) return json({ ok: false, error: "Repository is unavailable" }, 404);

    // Read the live grants once and refuse here with the same explanation the executor would
    // produce, so the viewer is told what to grant instead of watching a job dead-letter.
    const permissions = await dependencies.readPermissions(context.githubInstallationId);
    if (permissions) {
      const declared = githubAppActions.find((entry) => entry.id === parsed.action);
      if (declared) {
        const capability = checkCapabilityRequirement(evaluateAppCapabilities(permissions), declared.requirement);
        if (!capability.satisfied) {
          return json(
            {
              ok: false,
              error: capability.userExplanation ?? "This action requires additional GitHub App permissions.",
              missingPermissions: capability.missingPermissions,
              manageUrl: `https://github.com/settings/installations/${context.githubInstallationId}`,
            },
            403,
          );
        }
      }
    }

    const requestId = parsed.requestId ?? dependencies.newId();

    if (parsed.action === "setup") {
      return await handleRepositorySetupCreatePrForActor({
        actorId: auth.actorId,
        installationId: context.installationId,
        repositoryId: scope.repositoryId,
        ...(parsed.preset ? { preset: parsed.preset } : {}),
        requestId,
      });
    }

    const target = parsed.runId ? await loadRunTarget(scope.executor, scope.repositoryId, parsed.runId) : undefined;
    if (parsed.runId && !target) return json({ ok: false, error: "That run is no longer available." }, 404);
    if (target && target.pullRequestNumber === undefined) {
      return json(
        {
          ok: false,
          error:
            "This run came from a branch push rather than a pull request, so there is nowhere to report a re-run. Open a pull request for the branch and try again.",
        },
        409,
      );
    }

    const actions = lifecycleActionsFor(parsed, context, target);
    if (actions.length === 0) return json({ ok: false, error: "That action could not be prepared." }, 400);

    const deliveryId = actionDeliveryId(scope.repositoryId, parsed, requestId);
    const accepted = await createSqlControlPlaneJobStore(scope.executor).acceptGitHubWebhook({
      deliveryId,
      eventType: "dashboard_action",
      eventAction: parsed.action,
      installationExternalId: context.githubInstallationId,
      repositoryFullName: `${context.owner}/${context.name}`,
      // No webhook body exists for a dashboard action; the digest covers what was requested,
      // which is what the inbox uses it for.
      payloadSha256: createHash("sha256")
        .update(JSON.stringify({ ...parsed, requestId }))
        .digest("hex"),
      actions,
      receivedAt: dependencies.now(),
    });

    emitRepositoryActionTelemetry({
      action: parsed.action,
      outcome: accepted.outcome === "accepted" ? "accepted" : "duplicate",
    });

    return json(
      {
        ok: true,
        outcome: accepted.outcome,
        queued: accepted.queued,
        action: parsed.action,
        requestId,
      },
      accepted.outcome === "accepted" ? 202 : 200,
    );
  } catch (error) {
    // The caller still gets a generic message: an internal error must not reach a browser. But
    // the cause is recorded, which it was not before -- this block used to be a bare `catch {}`,
    // so a failing dashboard button was undiagnosable from the deployment. The database's own
    // error code is the field worth having: 42883 undefined function, 42P01 undefined table,
    // 23505 unique violation, 28000 failed authorisation.
    emitRepositoryActionTelemetry({
      action: parsed.action,
      outcome: "failed",
      errorClass: errorClassOf(error),
      errorCode: databaseErrorCode(error),
    });
    return json({ ok: false, error: "The action could not be queued. Please try again." }, 503);
  } finally {
    await scope.executor.close();
  }
}
