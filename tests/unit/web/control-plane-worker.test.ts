import { describe, expect, it, vi } from "vitest";
import { processControlPlaneJob } from "../../../apps/web/lib/control-plane-worker.js";
import type { GitHubAppDurableLifecycleStore } from "../../../packages/cloud-core/src/durable-lifecycle-planner.js";
import type { ClaimedControlPlaneJob, ControlPlaneJobStore } from "../../../packages/db/src/control-plane-job-store.js";

function lifecycleStore(): GitHubAppDurableLifecycleStore {
  return {
    upsertInstallation: vi.fn(async () => undefined),
    deleteInstallation: vi.fn(async () => undefined),
    suspendInstallation: vi.fn(async () => undefined),
    unsuspendInstallation: vi.fn(async () => undefined),
    upsertRepository: vi.fn(async () => undefined),
    removeRepository: vi.fn(async () => undefined),
    enqueueReleaseRunWithOutbox: vi.fn(async () => ({
      idempotencyKey: "key",
      runId: "run-1",
      outboxId: "outbox-1",
    })),
  };
}

function jobStore(overrides: Partial<ControlPlaneJobStore> = {}): ControlPlaneJobStore {
  return {
    acceptGitHubWebhook: vi.fn(),
    claimJobs: vi.fn(async () => []),
    completeJob: vi.fn(async () => "completed" as const),
    failJob: vi.fn(async () => "retry" as const),
    purgeExpired: vi.fn(async () => 0),
    collectMetrics: vi.fn(async () => ({
      availableJobs: 0,
      leasedJobs: 0,
      deadLetterJobs: 0,
      duplicateDeliveries: 0,
      oldestUnprocessedAgeSeconds: 0,
    })),
    ...overrides,
  };
}

const job: ClaimedControlPlaneJob = {
  jobId: "job-1",
  inboxId: "inbox-1",
  jobType: "github_webhook.lifecycle",
  payloadVersion: 1,
  attemptCount: 1,
  eventType: "installation",
  eventAction: "created",
  deliveryId: "delivery-1",
  actions: [
    {
      type: "installation.upsert",
      installation: { id: 123, accountLogin: "octo", accountType: "Organization" },
    },
  ],
};

describe("control-plane worker", () => {
  it("completes a durable job only after database lifecycle planning finishes", async () => {
    const lifecycle = lifecycleStore();
    const jobs = jobStore();

    const result = await processControlPlaneJob(job, {
      workerId: "worker-1",
      jobs,
      lifecycle,
    });

    expect(result).toMatchObject({ status: "completed", jobId: "job-1" });
    expect(lifecycle.upsertInstallation).toHaveBeenCalledWith(job.actions[0], {
      deliveryId: "delivery-1",
      eventType: "installation",
      eventAction: "created",
    });
    expect(jobs.completeJob).toHaveBeenCalledWith({ jobId: "job-1", workerId: "worker-1" });
    expect(jobs.failJob).not.toHaveBeenCalled();
  });

  it("plans release-run and outbox state without a direct GitHub client", async () => {
    const lifecycle = lifecycleStore();
    const jobs = jobStore();
    const releaseJob: ClaimedControlPlaneJob = {
      ...job,
      eventType: "pull_request",
      actions: [
        {
          type: "release_run.enqueue",
          installation: { id: 123 },
          repository: {
            id: 456,
            owner: "octo",
            name: "board",
            fullName: "octo/board",
            private: false,
            defaultBranch: "main",
          },
          pullRequestNumber: 7,
          ref: "refs/pull/7/head",
          commitSha: "a".repeat(40),
          triggerKind: "pr",
        },
      ],
    };

    await expect(processControlPlaneJob(releaseJob, { workerId: "worker-1", jobs, lifecycle })).resolves.toMatchObject({
      status: "completed",
    });
    expect(lifecycle.enqueueReleaseRunWithOutbox).toHaveBeenCalledOnce();
    expect(jobs.completeJob).toHaveBeenCalledOnce();
  });

  it("executes a setup PR interaction before completing the durable webhook job", async () => {
    const lifecycle = lifecycleStore();
    const jobs = jobStore();
    const setupAction = {
      type: "setup_pr.create" as const,
      installation: { id: 123 },
      repository: {
        id: 456,
        owner: "octo",
        name: "board",
        fullName: "octo/board",
        private: false,
        defaultBranch: "main",
      },
      checkRunId: 91,
      requestedBy: "octocat",
    };
    const interactions = { createSetupPr: vi.fn(async () => undefined) };
    const setupJob: ClaimedControlPlaneJob = {
      ...job,
      eventType: "check_run",
      eventAction: "requested_action",
      actions: [setupAction],
    };

    await expect(
      processControlPlaneJob(setupJob, { workerId: "worker-1", jobs, lifecycle, interactions }),
    ).resolves.toMatchObject({ status: "completed" });
    expect(interactions.createSetupPr).toHaveBeenCalledWith(setupAction, {
      deliveryId: "delivery-1",
      eventType: "check_run",
      eventAction: "requested_action",
    });
    expect(jobs.completeJob).toHaveBeenCalledOnce();
  });

  it("dispatches a merged setup probe interaction before completing the durable webhook job", async () => {
    const lifecycle = lifecycleStore();
    const jobs = jobStore();
    const probeAction = {
      type: "setup_probe.dispatch" as const,
      installation: { id: 123 },
      repository: {
        id: 456,
        owner: "octo",
        name: "board",
        fullName: "octo/board",
        private: false,
        defaultBranch: "main",
      },
      pullRequestNumber: 12,
      commitSha: "c".repeat(40),
      requestedBy: "maintainer",
    };
    const interactions = { probeSetup: vi.fn(async () => undefined) };
    const probeJob: ClaimedControlPlaneJob = {
      ...job,
      eventType: "pull_request",
      eventAction: "closed",
      actions: [probeAction],
    };

    await expect(
      processControlPlaneJob(probeJob, { workerId: "worker-1", jobs, lifecycle, interactions }),
    ).resolves.toMatchObject({ status: "completed" });
    expect(interactions.probeSetup).toHaveBeenCalledWith(probeAction, {
      deliveryId: "delivery-1",
      eventType: "pull_request",
      eventAction: "closed",
    });
    expect(jobs.completeJob).toHaveBeenCalledOnce();
  });

  it("executes a waiver PR interaction before completing the durable webhook job", async () => {
    const lifecycle = lifecycleStore();
    const jobs = jobStore();
    const waiverAction = {
      type: "waiver_pr.request" as const,
      installation: { id: 123 },
      repository: {
        id: 456,
        owner: "octo",
        name: "board",
        fullName: "octo/board",
        private: false,
        defaultBranch: "main",
      },
      ruleId: "rule.test",
      reason: "temporary",
      requestedBy: "octocat",
    };
    const interactions = { createWaiverPr: vi.fn(async () => undefined) };
    const waiverJob: ClaimedControlPlaneJob = {
      ...job,
      eventType: "issue_comment",
      eventAction: "created",
      actions: [waiverAction],
    };

    await expect(
      processControlPlaneJob(waiverJob, { workerId: "worker-1", jobs, lifecycle, interactions }),
    ).resolves.toMatchObject({ status: "completed" });
    expect(interactions.createWaiverPr).toHaveBeenCalledWith(waiverAction, {
      deliveryId: "delivery-1",
      eventType: "issue_comment",
      eventAction: "created",
    });
    expect(jobs.completeJob).toHaveBeenCalledOnce();
  });

  it("routes release.prepare follow-up through durable release-run planning before completing the job", async () => {
    const lifecycle = lifecycleStore();
    const jobs = jobStore();
    const prepareAction = {
      type: "release.prepare" as const,
      installation: { id: 123 },
      repository: {
        id: 456,
        owner: "octo",
        name: "board",
        fullName: "octo/board",
        private: false,
        defaultBranch: "main",
      },
      pullRequestNumber: 7,
      ref: "feature/board",
      commitSha: "a".repeat(40),
      baseCommitSha: "b".repeat(40),
      pullRequestDraft: false,
      pullRequestFromFork: false,
      requestedBy: "octocat",
    };
    const releaseRunAction = {
      type: "release_run.enqueue" as const,
      installation: { id: 123 },
      repository: prepareAction.repository,
      pullRequestNumber: 7,
      ref: "feature/board",
      commitSha: "a".repeat(40),
      baseCommitSha: "b".repeat(40),
      triggerKind: "pr" as const,
      pullRequestDraft: false,
      pullRequestFromFork: false,
      deliveryId: "delivery-1",
    };
    const interactions = { prepareRelease: vi.fn(async () => [releaseRunAction]) };
    const prepareJob: ClaimedControlPlaneJob = {
      ...job,
      eventType: "check_run",
      eventAction: "requested_action",
      actions: [prepareAction],
    };

    await expect(
      processControlPlaneJob(prepareJob, { workerId: "worker-1", jobs, lifecycle, interactions }),
    ).resolves.toMatchObject({ status: "completed" });
    expect(interactions.prepareRelease).toHaveBeenCalledWith(prepareAction, {
      deliveryId: "delivery-1",
      eventType: "check_run",
      eventAction: "requested_action",
    });
    expect(lifecycle.enqueueReleaseRunWithOutbox).toHaveBeenCalledWith(releaseRunAction);
    expect(jobs.completeJob).toHaveBeenCalledOnce();
  });

  it("supports a command-only interaction executor configuration", async () => {
    const lifecycle = lifecycleStore();
    const jobs = jobStore();
    const commandAction = {
      type: "github_command.execute" as const,
      installation: { id: 123 },
      repository: {
        id: 456,
        owner: "octo",
        name: "board",
        fullName: "octo/board",
        private: false,
        defaultBranch: "main",
      },
      pullRequestNumber: 7,
      commentId: 45,
      commentBody: "/boardreadyops status",
      commentAuthor: "octocat",
      authorAssociation: "NONE",
    };
    const interactions = {
      executeGitHubCommand: vi.fn(async () => []),
    };
    const commandJob: ClaimedControlPlaneJob = {
      ...job,
      eventType: "issue_comment",
      eventAction: "created",
      actions: [commandAction],
    };

    await expect(
      processControlPlaneJob(commandJob, { workerId: "worker-1", jobs, lifecycle, interactions }),
    ).resolves.toMatchObject({ status: "completed" });
    expect(interactions.executeGitHubCommand).toHaveBeenCalledOnce();
  });

  it("routes GitHub command actions back through durable lifecycle planning before completing the job", async () => {
    const lifecycle = lifecycleStore();
    const jobs = jobStore();
    const commandAction = {
      type: "github_command.execute" as const,
      installation: { id: 123 },
      repository: {
        id: 456,
        owner: "octo",
        name: "board",
        fullName: "octo/board",
        private: false,
        defaultBranch: "main",
      },
      pullRequestNumber: 7,
      commentId: 44,
      commentBody: "/boardreadyops rerun",
      commentAuthor: "octocat",
      authorAssociation: "MEMBER",
    };
    const rerunAction = {
      type: "release_run.enqueue" as const,
      installation: { id: 123 },
      repository: commandAction.repository,
      pullRequestNumber: 7,
      ref: "feature/board",
      commitSha: "a".repeat(40),
      baseCommitSha: "b".repeat(40),
      triggerKind: "pr" as const,
    };
    const interactions = {
      createSetupPr: vi.fn(async () => undefined),
      executeGitHubCommand: vi.fn(async () => [rerunAction]),
    };
    const commandJob: ClaimedControlPlaneJob = {
      ...job,
      eventType: "issue_comment",
      eventAction: "created",
      actions: [commandAction],
    };

    await expect(
      processControlPlaneJob(commandJob, { workerId: "worker-1", jobs, lifecycle, interactions }),
    ).resolves.toMatchObject({ status: "completed" });
    expect(interactions.executeGitHubCommand).toHaveBeenCalledWith(commandAction, {
      deliveryId: "delivery-1",
      eventType: "issue_comment",
      eventAction: "created",
    });
    expect(lifecycle.enqueueReleaseRunWithOutbox).toHaveBeenCalledWith(rerunAction);
    expect(jobs.completeJob).toHaveBeenCalledOnce();
  });

  it("requeues a failed database plan with a bounded redacted error", async () => {
    const lifecycle = lifecycleStore();
    vi.mocked(lifecycle.upsertInstallation).mockRejectedValue(new Error(`secret=${"x".repeat(1200)}`));
    const jobs = jobStore();

    const result = await processControlPlaneJob(job, {
      workerId: "worker-1",
      jobs,
      lifecycle,
    });

    expect(result).toMatchObject({ status: "retry", jobId: "job-1" });
    expect(jobs.completeJob).not.toHaveBeenCalled();
    expect(jobs.failJob).toHaveBeenCalledOnce();
    const failure = vi.mocked(jobs.failJob).mock.calls[0]?.[0];
    expect(failure?.errorClass).toBe("Error");
    expect(failure?.errorMessage.length).toBeLessThanOrEqual(500);
    expect(failure?.errorMessage).not.toContain("secret=");
  });
});
