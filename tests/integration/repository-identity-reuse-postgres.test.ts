import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createSqlGitHubAppMetadataStore } from "../../packages/db/src/lifecycle-store.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 2 }) : undefined;
const installations: number[] = [];

function database() {
  if (!executor) throw new Error("Disposable PostgreSQL opt-in is required");
  return executor;
}

function rows(result: unknown): Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as { rows?: unknown }).rows;
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

async function fixture(disabled: boolean) {
  const unique = Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16);
  const installation = {
    id: unique,
    accountLogin: `identity-${unique}`,
    accountType: "Organization" as const,
  };
  const oldRepositoryId = unique + 1;
  const newRepositoryId = unique + 2;
  const oldInternalId = randomUUID();
  const installationInternalId = randomUUID();
  installations.push(installation.id);
  await database().query(
    "insert into installations (id, github_installation_id, account_login, account_type) values ($1,$2,$3,'Organization')",
    [installationInternalId, installation.id, installation.accountLogin],
  );
  await database().query(
    "insert into repositories (id,installation_id,github_repo_id,owner,name,private,default_branch,disabled_at) values ($1,$2,$3,$4,'reused-name',true,'main',$5::timestamptz)",
    [
      oldInternalId,
      installationInternalId,
      oldRepositoryId,
      installation.accountLogin,
      disabled ? "2026-11-01T00:00:00.000Z" : null,
    ],
  );
  const newRepository = {
    id: newRepositoryId,
    owner: installation.accountLogin,
    name: "reused-name",
    fullName: `${installation.accountLogin}/reused-name`,
    private: true,
    defaultBranch: "main",
  };
  return { installation, oldInternalId, oldRepositoryId, newRepositoryId, newRepository };
}

afterAll(async () => {
  if (!executor) return;
  for (const installationId of installations) {
    await database().query("delete from installations where github_installation_id = $1", [installationId]);
  }
  await executor.close();
});

describeDatabase("GitHub repository immutable identity and reused names", () => {
  it("accepts a new GitHub ID after a same-name old repository is disabled without relabeling history", async () => {
    const setup = await fixture(true);
    const store = createSqlGitHubAppMetadataStore(database(), { id: randomUUID });

    await store.upsertRepository(
      { type: "repository.upsert", installation: setup.installation, repository: setup.newRepository },
      { deliveryId: randomUUID(), eventType: "installation_repositories", eventAction: "added" },
    );

    const records = rows(
      await database().query(
        "select id, github_repo_id::text, disabled_at from repositories where owner = $1 order by github_repo_id",
        [setup.installation.accountLogin],
      ),
    );
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      id: setup.oldInternalId,
      github_repo_id: String(setup.oldRepositoryId),
      disabled_at: expect.any(Date),
    });
    expect(records[1]).toMatchObject({
      github_repo_id: String(setup.newRepositoryId),
      disabled_at: null,
    });
    expect(records[1]?.id).not.toBe(setup.oldInternalId);
  });

  it("still rejects competing ACTIVE IDs with the same installation and name", async () => {
    const setup = await fixture(false);
    const store = createSqlGitHubAppMetadataStore(database(), { id: randomUUID });
    await expect(
      store.upsertRepository({
        type: "repository.upsert",
        installation: setup.installation,
        repository: setup.newRepository,
      }),
    ).rejects.toThrow();

    const records = rows(
      await database().query("select id, github_repo_id::text, disabled_at from repositories where owner = $1", [
        setup.installation.accountLogin,
      ]),
    );
    expect(records).toEqual([
      { id: setup.oldInternalId, github_repo_id: String(setup.oldRepositoryId), disabled_at: null },
    ]);
  });
});
