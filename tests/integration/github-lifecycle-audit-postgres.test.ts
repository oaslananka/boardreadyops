import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { planGitHubAppLifecycleActions } from "../../packages/cloud-core/src/durable-lifecycle-planner.js";
import type { GitHubAppLifecycleAction } from "../../packages/cloud-core/src/lifecycle.js";
import { createSqlAuditLogStore } from "../../packages/db/src/audit-log-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { createSqlTransactionalGitHubAppLifecycleStore } from "../../packages/db/src/transactional-lifecycle-store.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 2 }) : undefined;

const installationExternalId = 43_101;
const repositoryExternalId = 43_111;
const installation = {
  id: installationExternalId,
  accountLogin: "lifecycle-audit-org",
  accountType: "Organization",
};
const repository = {
  id: repositoryExternalId,
  owner: "lifecycle-audit-org",
  name: "board",
  fullName: "lifecycle-audit-org/board",
  private: true,
  defaultBranch: "main",
};

type QueryRow = Record<string, unknown>;

function database() {
  if (!executor) throw new Error("DATABASE_URL is required");
  return executor;
}

function rows(result: unknown): QueryRow[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as { rows?: unknown }).rows;
  return Array.isArray(value) ? (value as QueryRow[]) : [];
}

function store() {
  return createSqlTransactionalGitHubAppLifecycleStore(database(), {
    id: randomUUID,
    now: () => new Date("2026-07-28T08:30:00.000Z"),
  });
}

const createdActions: GitHubAppLifecycleAction[] = [
  { type: "installation.upsert", installation },
  { type: "repository.upsert", installation, repository },
];

afterAll(async () => {
  if (!executor) return;
  await database().query("delete from installations where github_installation_id = $1", [installationExternalId]);
  await executor.close();
});

describeDatabase("GitHub lifecycle audit PostgreSQL integration", () => {
  it("writes retry-safe tenant events and excludes pull-request metadata refreshes", async () => {
    const lifecycle = store();
    const createdContext = {
      deliveryId: "delivery-installation-created",
      eventType: "installation",
      eventAction: "created",
    };

    await planGitHubAppLifecycleActions(createdActions, lifecycle, createdContext);
    await planGitHubAppLifecycleActions(createdActions, lifecycle, createdContext);
    await planGitHubAppLifecycleActions(createdActions, lifecycle, {
      deliveryId: "delivery-pull-request",
      eventType: "pull_request",
      eventAction: "synchronize",
    });

    const persisted = rows(
      await database().query(
        `select event_type, actor_type, subject_type, repository_id, request_id, metadata
           from audit_events
          where request_id in ($1, $2)
          order by event_type`,
        [createdContext.deliveryId, "delivery-pull-request"],
      ),
    );
    expect(persisted).toEqual([
      {
        event_type: "github_app.installation.enabled",
        actor_type: "github_webhook",
        subject_type: "installation",
        repository_id: null,
        request_id: "delivery-installation-created",
        metadata: { action: "created", githubInstallationId: installationExternalId },
      },
      {
        event_type: "github_app.repository.enabled",
        actor_type: "github_webhook",
        subject_type: "repository",
        repository_id: expect.any(String),
        request_id: "delivery-installation-created",
        metadata: { action: "created", githubRepositoryId: repositoryExternalId, repositoryPrivate: true },
      },
    ]);

    const installationRows = rows(
      await database().query("select id from installations where github_installation_id = $1", [
        installationExternalId,
      ]),
    );
    const installationId = installationRows[0]?.id;
    if (typeof installationId !== "string") throw new Error("installation fixture was not persisted");

    const auditExport = createSqlAuditLogStore(database());
    await expect(
      auditExport.listAuditEvents({
        installationId,
        eventType: "github_app.installation.enabled",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        installationId,
        eventType: "github_app.installation.enabled",
        actorType: "github_webhook",
        subjectType: "installation",
        requestId: createdContext.deliveryId,
        metadata: { action: "created", githubInstallationId: installationExternalId },
      }),
    ]);
    await expect(
      auditExport.listAuditEvents({
        installationId,
        eventType: "github_app.repository.enabled",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        installationId,
        eventType: "github_app.repository.enabled",
        actorType: "github_webhook",
        subjectType: "repository",
        repositoryFullName: "lifecycle-audit-org/board",
        requestId: createdContext.deliveryId,
        metadata: {
          action: "created",
          githubRepositoryId: repositoryExternalId,
          repositoryPrivate: true,
        },
      }),
    ]);
  });

  it("records repository removal and installation deletion under the same tenant", async () => {
    const lifecycle = store();
    await planGitHubAppLifecycleActions([{ type: "repository.removed", installation, repository }], lifecycle, {
      deliveryId: "delivery-repository-removed",
      eventType: "installation_repositories",
      eventAction: "removed",
    });
    await planGitHubAppLifecycleActions([{ type: "installation.deleted", installation }], lifecycle, {
      deliveryId: "delivery-installation-deleted",
      eventType: "installation",
      eventAction: "deleted",
    });

    const persisted = rows(
      await database().query(
        `select audit.event_type, audit.actor_type, audit.subject_type, audit.request_id,
                audit.metadata, installation.github_installation_id, repository.github_repo_id
           from audit_events as audit
           join installations as installation on installation.id = audit.installation_id
           left join repositories as repository on repository.id = audit.repository_id
          where audit.request_id in ($1, $2)
          order by audit.event_type`,
        ["delivery-repository-removed", "delivery-installation-deleted"],
      ),
    );
    expect(persisted).toEqual([
      {
        event_type: "github_app.installation.disabled",
        actor_type: "github_webhook",
        subject_type: "installation",
        request_id: "delivery-installation-deleted",
        metadata: { action: "deleted", githubInstallationId: installationExternalId },
        github_installation_id: String(installationExternalId),
        github_repo_id: null,
      },
      {
        event_type: "github_app.repository.disabled",
        actor_type: "github_webhook",
        subject_type: "repository",
        request_id: "delivery-repository-removed",
        metadata: { action: "removed", githubRepositoryId: repositoryExternalId, repositoryPrivate: true },
        github_installation_id: String(installationExternalId),
        github_repo_id: String(repositoryExternalId),
      },
    ]);
  });
});
