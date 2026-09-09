import { createHash } from "node:crypto";
import { checkCapabilityRequirement, evaluateAppCapabilities } from "@boardreadyops/cloud-core/github-capabilities";
import {
  createGitHubMutationService,
  type GitHubMutationApiClient,
  type GitHubMutationService,
} from "@boardreadyops/cloud-core/github-mutation-service";
import type { GitHubAppLifecycleAction, GitHubAppLifecycleContext } from "@boardreadyops/cloud-core/lifecycle";
import {
  generateSetupPrPlan,
  generateWaiverPrPlan,
  repositorySetupPresetVersion,
} from "@boardreadyops/cloud-core/repository-setup";
import type { SqlQueryExecutor } from "@boardreadyops/db/lifecycle-store";
import { createSqlRepositorySetupStore, type RepositorySetupStore } from "@boardreadyops/db/repository-setup-store";
import { createAppAuth } from "@octokit/auth-app";
import { createRepositorySetupGitHubClient, type RepositorySetupGitHubClient } from "./repository-setup-github.js";

type SetupAction = Extract<GitHubAppLifecycleAction, { type: "setup_pr.create" }>;
type SetupProbeAction = Extract<GitHubAppLifecycleAction, { type: "setup_probe.dispatch" }>;
type WaiverAction = Extract<GitHubAppLifecycleAction, { type: "waiver_pr.request" }>;
type ReleasePrepareAction = Extract<GitHubAppLifecycleAction, { type: "release.prepare" }>;

type InstallationAuthentication = {
  token: string;
  permissions: Record<string, string | undefined>;
};

export type RepositorySetupLifecycleExecutor = {
  createSetupPr(action: SetupAction, context: GitHubAppLifecycleContext): Promise<void>;
  probeSetup(action: SetupProbeAction, context: GitHubAppLifecycleContext): Promise<void>;
  createWaiverPr(action: WaiverAction, context: GitHubAppLifecycleContext): Promise<void>;
  prepareRelease(
    action: ReleasePrepareAction,
    context: GitHubAppLifecycleContext,
  ): Promise<readonly GitHubAppLifecycleAction[]>;
};

export type RepositorySetupLifecycleExecutorDependencies = {
  store: RepositorySetupStore;
  authenticateInstallation(installationId: number): Promise<InstallationAuthentication>;
  mutationService(token: string): GitHubMutationService;
  githubClient?: RepositorySetupGitHubClient;
  now?: () => Date;
  cloudOrigin?: string;
};

function requestId(deliveryId: string): string {
  return `github:${deliveryId}`;
}

function revisionRequestId(value: string): string {
  return `setup-pr:${createHash("sha256").update(value).digest("hex")}`;
}

function probeReadinessRequestId(value: string): string {
  return `setup-readiness:${createHash("sha256").update(value).digest("hex")}`;
}

const setupProbeLifetimeMs = 15 * 60 * 1000;

function deterministicAuditEventId(parts: readonly string[]): string {
  const digest = createHash("sha256").update(parts.join("\u0000"), "utf8").digest().subarray(0, 16);
  digest[6] = ((digest[6] ?? 0) & 0x0f) | 0x80;
  digest[8] = ((digest[8] ?? 0) & 0x3f) | 0x80;
  const hex = digest.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function repositoryContextForAction(
  store: RepositorySetupStore,
  action: SetupAction | SetupProbeAction | WaiverAction | ReleasePrepareAction,
) {
  const repository = await store.getContextByGitHub({
    githubInstallationId: action.installation.id,
    githubRepositoryId: action.repository.id,
  });
  if (!repository || repository.owner !== action.repository.owner || repository.name !== action.repository.name) {
    throw new Error("repository setup context is unavailable or does not match the GitHub action scope");
  }
  return repository;
}

export function createRepositorySetupLifecycleExecutor(
  dependencies: RepositorySetupLifecycleExecutorDependencies,
): RepositorySetupLifecycleExecutor {
  return {
    async createSetupPr(action, context) {
      const repository = await repositoryContextForAction(dependencies.store, action);

      const authentication = await dependencies.authenticateInstallation(action.installation.id);
      const capability = checkCapabilityRequirement(evaluateAppCapabilities(authentication.permissions), "setup_pr");
      if (!capability.satisfied) {
        throw new Error(`setup PR capability is unavailable: ${capability.missingPermissions.join(", ")}`);
      }

      const plan = generateSetupPrPlan({
        presetId: repository.current?.preset ?? "open-source",
        ...(dependencies.cloudOrigin ? { cloudOrigin: dependencies.cloudOrigin } : {}),
      });
      const durableRequestId = requestId(context.deliveryId);
      const actorId = action.requestedBy ?? "github-app";
      const result = await dependencies.mutationService(authentication.token).execute({
        installationId: repository.githubInstallationId,
        owner: repository.owner,
        repo: repository.name,
        defaultBranch: repository.defaultBranch,
        intent: "setup",
        branchName: plan.branchName,
        commitMessage: plan.commitMessage,
        prTitle: plan.prTitle,
        prBody: plan.prBody,
        files: plan.files,
        actorId,
        requestId: durableRequestId,
      });

      await dependencies.store.applyRevision({
        installationId: repository.installationId,
        repositoryId: repository.repositoryId,
        preset: plan.preset.id,
        presetVersion: repositorySetupPresetVersion,
        source: "operator",
        actorId,
        requestId: revisionRequestId(durableRequestId),
        workflowStatus: "unknown",
        configStatus: "unknown",
        diagnostics: [`Setup PR #${result.pullRequestNumber} (${result.outcome}): ${result.pullRequestUrl}`],
      });
    },

    async probeSetup(action, context) {
      const repository = await repositoryContextForAction(dependencies.store, action);
      const current = repository.current;
      if (!current) throw new Error("repository setup revision is unavailable after setup merge");
      const githubClient = dependencies.githubClient;
      if (!githubClient) throw new Error("repository setup GitHub client is not configured");

      const readiness = await githubClient.inspect({
        githubInstallationId: repository.githubInstallationId,
        owner: repository.owner,
        name: repository.name,
      });
      if (readiness.workflowStatus === "missing") {
        throw new Error("repository setup workflow is not visible on the default branch after setup merge");
      }
      if (readiness.workflowStatus !== "probe_required") {
        await dependencies.store.applyRevision({
          installationId: repository.installationId,
          repositoryId: repository.repositoryId,
          preset: current.preset,
          presetVersion: current.presetVersion,
          source: "operator",
          actorId: action.requestedBy ?? "github-app",
          requestId: probeReadinessRequestId(requestId(context.deliveryId)),
          workflowStatus: readiness.workflowStatus,
          configStatus: "unknown",
          diagnostics: [`GitHub readiness after setup PR #${action.pullRequestNumber}: ${readiness.workflowStatus}`],
        });
        return;
      }

      const created = await dependencies.store.createProbe({
        installationId: repository.installationId,
        repositoryId: repository.repositoryId,
        requestedBy: action.requestedBy ?? "github-app",
        requestId: requestId(context.deliveryId),
        expiresAt: new Date((dependencies.now?.() ?? new Date()).valueOf() + setupProbeLifetimeMs),
      });
      if (created.outcome === "not_configured") {
        throw new Error("repository setup probe requires an existing setup revision");
      }
      if (created.outcome === "conflict") throw new Error("repository setup probe request conflicted");
      if (!created.probeId) throw new Error("repository setup probe did not return a probe id");
      const probeId = created.probeId;

      if (created.outcome === "replayed") {
        const replayed = await dependencies.store.getProbe(probeId);
        if (!replayed) throw new Error("replayed repository setup probe is unavailable");
        if (replayed.status === "completed" || replayed.status === "dispatched") return;
        if (replayed.status !== "pending") {
          throw new Error(`replayed repository setup probe is ${replayed.status}`);
        }
      }

      const dispatched = await githubClient.dispatchProbe({
        githubInstallationId: repository.githubInstallationId,
        owner: repository.owner,
        name: repository.name,
        defaultBranch: repository.defaultBranch,
        probeId,
      });
      const marked = await dependencies.store.markProbeDispatched({
        probeId,
        workflowRunId: dispatched.workflowRunId,
      });
      if (marked === "applied" || marked === "replayed") return;
      if (marked === "stale") {
        const terminal = await dependencies.store.getProbe(probeId);
        if (terminal?.status === "completed" || terminal?.status === "dispatched") return;
      }
      throw new Error(`repository setup probe dispatch could not be persisted: ${marked}`);
    },

    async prepareRelease(action, context) {
      const repository = await repositoryContextForAction(dependencies.store, action);
      const releaseRunAction: GitHubAppLifecycleAction = {
        type: "release_run.enqueue",
        installation: action.installation,
        repository: action.repository,
        pullRequestNumber: action.pullRequestNumber,
        ref: action.ref,
        commitSha: action.commitSha,
        triggerKind: "pr",
        deliveryId: context.deliveryId,
        idempotencyScope: `release-prepare:${context.deliveryId}`,
      };
      if (action.baseCommitSha) releaseRunAction.baseCommitSha = action.baseCommitSha;
      if (action.pullRequestDraft !== undefined) releaseRunAction.pullRequestDraft = action.pullRequestDraft;
      if (action.pullRequestFromFork !== undefined) releaseRunAction.pullRequestFromFork = action.pullRequestFromFork;
      if (action.safeMode) releaseRunAction.safeMode = action.safeMode;

      if (repository.current?.workflowStatus !== "ready" || repository.current.configStatus !== "ready") {
        releaseRunAction.setupIncomplete = true;
        return [releaseRunAction];
      }

      const authentication = await dependencies.authenticateInstallation(action.installation.id);
      const capability = checkCapabilityRequirement(
        evaluateAppCapabilities(authentication.permissions),
        "dispatch_analysis",
      );
      if (!capability.satisfied) return [];

      return [releaseRunAction];
    },

    async createWaiverPr(action, context) {
      const ruleId = action.ruleId?.trim();
      const reason = action.reason?.trim();
      if (!ruleId || !reason) throw new Error("waiver rule and reason are required before repository mutation");

      const repository = await repositoryContextForAction(dependencies.store, action);
      const authentication = await dependencies.authenticateInstallation(action.installation.id);
      const capability = checkCapabilityRequirement(evaluateAppCapabilities(authentication.permissions), "waiver_pr");
      if (!capability.satisfied) {
        throw new Error(`waiver PR capability is unavailable: ${capability.missingPermissions.join(", ")}`);
      }

      const mutationService = dependencies.mutationService(authentication.token);
      const actorId = action.requestedBy ?? "github-app";
      const durableRequestId = requestId(context.deliveryId);
      await dependencies.store.recordWaiverPrRequestAudit({
        eventId: deterministicAuditEventId(["waiver-pr-request", repository.repositoryId, durableRequestId]),
        installationId: repository.installationId,
        repositoryId: repository.repositoryId,
        actorId,
        requestId: durableRequestId,
      });

      const snapshot = await mutationService.readFileSnapshot({
        owner: repository.owner,
        repo: repository.name,
        defaultBranch: repository.defaultBranch,
        path: "boardreadyops.yml",
      });
      const plan = generateWaiverPrPlan({
        ruleId,
        reason,
        owner: actorId,
        currentConfigContent: snapshot.content,
      });
      if (!plan.hasChanges) {
        await dependencies.store.recordWaiverPrResultAudit({
          eventId: deterministicAuditEventId(["waiver-pr-result", repository.repositoryId, durableRequestId]),
          installationId: repository.installationId,
          repositoryId: repository.repositoryId,
          actorId,
          requestId: durableRequestId,
          outcome: "already_present",
        });
        return;
      }

      const result = await mutationService.execute({
        installationId: repository.githubInstallationId,
        owner: repository.owner,
        repo: repository.name,
        defaultBranch: repository.defaultBranch,
        intent: "waiver",
        branchName: plan.branchName,
        commitMessage: plan.commitMessage,
        prTitle: plan.prTitle,
        prBody: plan.prBody,
        files: plan.files,
        actorId,
        requestId: durableRequestId,
        expectedBaseCommitSha: snapshot.baseCommitSha,
      });
      await dependencies.store.recordWaiverPrResultAudit({
        eventId: deterministicAuditEventId(["waiver-pr-result", repository.repositoryId, durableRequestId]),
        installationId: repository.installationId,
        repositoryId: repository.repositoryId,
        actorId,
        requestId: durableRequestId,
        outcome: result.outcome,
        pullRequestNumber: result.pullRequestNumber,
      });
    },
  };
}

export function createProductionRepositorySetupLifecycleExecutor(
  executor: SqlQueryExecutor,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): RepositorySetupLifecycleExecutor | undefined {
  const appId = environment.GITHUB_APP_ID?.trim();
  const privateKey = environment.GITHUB_APP_PRIVATE_KEY?.replaceAll(String.raw`\n`, "\n").trim();
  if (!appId || !privateKey) return undefined;
  const apiBaseUrl = (environment.GITHUB_API_BASE_URL?.trim() || "https://api.github.com").replace(/\/$/u, "");

  return createRepositorySetupLifecycleExecutor({
    store: createSqlRepositorySetupStore(executor),
    githubClient: createRepositorySetupGitHubClient({ environment }),
    now: () => new Date(),
    cloudOrigin: environment.BOARDREADYOPS_PUBLIC_URL?.trim() || environment.NEXT_PUBLIC_APP_URL?.trim() || undefined,
    async authenticateInstallation(installationId) {
      const authenticate = createAppAuth({ appId, privateKey, installationId });
      const authentication = await authenticate({ type: "installation" });
      return { token: authentication.token, permissions: authentication.permissions };
    },
    mutationService(token) {
      const client: GitHubMutationApiClient = {
        async request<T>(path: string, init?: RequestInit) {
          const response = await fetch(`${apiBaseUrl}${path}`, {
            ...init,
            headers: {
              accept: "application/vnd.github+json",
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
              "x-github-api-version": "2022-11-28",
              ...init?.headers,
            },
          });
          const text = await response.text();
          let data = {} as T;
          if (text) {
            try {
              data = JSON.parse(text) as T;
            } catch {
              // GitHub error status remains authoritative when an endpoint returns a non-JSON body.
            }
          }
          return { status: response.status, ok: response.ok, data };
        },
      };
      return createGitHubMutationService({ client });
    },
  });
}
