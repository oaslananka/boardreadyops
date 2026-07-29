import { describe, expect, it, vi } from "vitest";
import { createSqlAuditLogStore } from "../../../packages/db/src/audit-log-store.js";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";

const installationId = "11111111-1111-4111-8111-111111111111";
const repositoryId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
const eventId = "44444444-4444-4444-8444-444444444444";

function executor(rows: Record<string, unknown>[]) {
  return { query: vi.fn(async () => ({ rows })) } as unknown as SqlQueryExecutor;
}

describe("audit log store", () => {
  it("lists one tenant in deterministic reverse order and strips non-exportable metadata", async () => {
    const queryExecutor = executor([
      {
        id: eventId,
        installation_id: installationId,
        event_type: "runner.result.persisted",
        actor_type: "runner",
        actor_id: "attempt-1",
        actor_login: null,
        subject_type: "release_run",
        subject_id: runId,
        repository_id: repositoryId,
        repository_full_name: "octo/board",
        release_run_id: runId,
        artifact_id: null,
        runner_registration_id: null,
        request_id: "request-1",
        metadata: {
          status: "completed",
          conclusion: "success",
          decisionSummaryVersion: 1,
          decision: "pass",
          githubCheckConclusion: "neutral",
          readinessReported: true,
          readinessStatus: "at-risk",
          readinessScore: 84,
          blockingCount: 0,
          nonBlockingCount: 1,
          missingRequiredCount: 0,
          missingRecommendedCount: 1,
          warningCount: 1,
          waiversReported: true,
          activeWaiverCount: 1,
          expiredWaiverCount: 0,
          staleWaiverCount: 0,
          findingCount: 2,
          githubInstallationId: 12345,
          githubRepositoryId: 98765,
          repositoryPrivate: true,
          reason: "Bearer hidden-credential",
          error: "password=do-not-export",
          token: "secret",
          nested: { authorization: "Bearer hidden" },
        },
        created_at: "2026-07-28T02:00:00.000Z",
      },
    ]);
    const store = createSqlAuditLogStore(queryExecutor);

    await expect(
      store.listAuditEvents({
        installationId,
        repositoryId,
        releaseRunId: runId,
        eventType: "runner.result.persisted",
        cursor: { createdAt: new Date("2026-07-28T03:00:00.000Z"), id: "cursor-id" },
        limit: 25,
      }),
    ).resolves.toEqual([
      {
        id: eventId,
        installationId,
        eventType: "runner.result.persisted",
        actorType: "runner",
        actorId: "attempt-1",
        subjectType: "release_run",
        subjectId: runId,
        repositoryId,
        repositoryFullName: "octo/board",
        releaseRunId: runId,
        requestId: "request-1",
        metadata: {
          status: "completed",
          conclusion: "success",
          decisionSummaryVersion: 1,
          decision: "pass",
          githubCheckConclusion: "neutral",
          readinessReported: true,
          readinessStatus: "at-risk",
          readinessScore: 84,
          blockingCount: 0,
          nonBlockingCount: 1,
          missingRequiredCount: 0,
          missingRecommendedCount: 1,
          warningCount: 1,
          waiversReported: true,
          activeWaiverCount: 1,
          expiredWaiverCount: 0,
          staleWaiverCount: 0,
          findingCount: 2,
          githubInstallationId: 12345,
          githubRepositoryId: 98765,
          repositoryPrivate: true,
        },
        createdAt: "2026-07-28T02:00:00.000Z",
      },
    ]);

    const query = vi.mocked(queryExecutor.query);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, parameters] = query.mock.calls[0] ?? [];
    expect(sql).toContain("where audit.installation_id = $1");
    expect(sql).toContain("(audit.created_at, audit.id) <");
    expect(sql).toContain("order by audit.created_at desc, audit.id desc");
    expect(parameters).toEqual([
      installationId,
      repositoryId,
      runId,
      "runner.result.persisted",
      "2026-07-28T03:00:00.000Z",
      "cursor-id",
      25,
    ]);
  });

  it("uses bounded defaults and normalizes optional fields, dates, and primitive metadata", async () => {
    const createdAt = new Date("2026-07-28T04:00:00.000Z");
    const queryExecutor = executor([
      {
        id: eventId,
        installation_id: installationId,
        event_type: "artifact.uploaded",
        actor_type: "operator",
        actor_id: null,
        actor_login: "octocat",
        subject_type: "artifact",
        subject_id: null,
        repository_id: null,
        repository_full_name: null,
        release_run_id: null,
        artifact_id: "artifact-1",
        runner_registration_id: "registration-1",
        request_id: null,
        metadata: {
          action: true,
          bytes: 42,
          reason: "manual verification",
          metricCount: Number.POSITIVE_INFINITY,
          expiresAt: "x".repeat(513),
        },
        created_at: createdAt,
      },
    ]);
    const store = createSqlAuditLogStore(queryExecutor);

    await expect(store.listAuditEvents({ installationId })).resolves.toEqual([
      {
        id: eventId,
        installationId,
        eventType: "artifact.uploaded",
        actorType: "operator",
        actorLogin: "octocat",
        subjectType: "artifact",
        artifactId: "artifact-1",
        runnerRegistrationId: "registration-1",
        metadata: { action: true, bytes: 42, reason: "manual verification" },
        createdAt: createdAt.toISOString(),
      },
    ]);
    const [sql, parameters] = vi.mocked(queryExecutor.query).mock.calls[0] ?? [];
    expect(sql).not.toContain("audit.repository_id = $2");
    expect(parameters).toEqual([installationId, 50]);
  });

  it("rejects invalid cursors and malformed database rows", async () => {
    const queryExecutor = executor([]);
    const store = createSqlAuditLogStore(queryExecutor);

    await expect(
      store.listAuditEvents({
        installationId,
        cursor: { createdAt: new Date("invalid"), id: "cursor-id" },
      }),
    ).rejects.toThrow("cursor.createdAt is invalid");
    await expect(
      store.listAuditEvents({
        installationId,
        cursor: { createdAt: new Date("2026-07-28T03:00:00.000Z"), id: "bad id" },
      }),
    ).rejects.toThrow("cursor.id is invalid");
    expect(queryExecutor.query).not.toHaveBeenCalled();

    const invalidDateExecutor = executor([
      {
        id: eventId,
        installation_id: installationId,
        event_type: "artifact.uploaded",
        actor_type: "operator",
        subject_type: "artifact",
        metadata: null,
        created_at: "not-a-date",
      },
    ]);
    await expect(createSqlAuditLogStore(invalidDateExecutor).listAuditEvents({ installationId })).rejects.toThrow(
      "database row created_at is invalid",
    );
  });

  it("rejects invalid filters before querying PostgreSQL", async () => {
    const queryExecutor = executor([]);
    const store = createSqlAuditLogStore(queryExecutor);

    await expect(store.listAuditEvents({ installationId: "bad installation" })).rejects.toThrow(
      "installationId is invalid",
    );
    await expect(store.listAuditEvents({ installationId, limit: 0 })).rejects.toThrow("limit is invalid");
    await expect(store.listAuditEvents({ installationId, eventType: "Runner Result" })).rejects.toThrow(
      "eventType is invalid",
    );
    await expect(store.listAuditEvents({ installationId, eventType: "a".repeat(161) })).rejects.toThrow(
      "eventType is invalid",
    );
    expect(queryExecutor.query).not.toHaveBeenCalled();
  });
});
