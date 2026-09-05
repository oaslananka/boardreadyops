import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { WorkspaceStore } from "../../packages/db/src/workspace-store.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDatabase = connectionString ? describe : describe.skip;
const executor = connectionString ? createPgQueryExecutor({ connectionString, max: 2 }) : undefined;

const workspaceId = "ws_test_integration_01";
const projectId = "prj_test_integration_01";
const revisionId = "rev_test_integration_01";

beforeAll(async () => {
  if (!executor) return;
  await executor.query("delete from workspaces where id = $1", [workspaceId]);
});

afterAll(async () => {
  if (!executor) return;
  await executor.query("delete from workspaces where id = $1", [workspaceId]);
  await executor.close();
});

describeDatabase("WorkspaceStore (PostgreSQL Integration)", () => {
  it("persists and queries workspaces, projects, revisions, and deliveries in PostgreSQL", async () => {
    if (!executor) throw new Error("Executor unavailable");
    const store = new WorkspaceStore(executor);

    const ws = await store.createWorkspace({
      id: workspaceId,
      name: "Integration Test Workspace",
      slug: "integration-test-ws",
      planTier: "team",
    });
    expect(ws.id).toBe(workspaceId);
    expect(ws.name).toBe("Integration Test Workspace");

    const project = await store.createProject({
      id: projectId,
      workspaceId: ws.id,
      name: "Integration PCB",
      defaultCadFormat: "altium",
    });
    expect(project.id).toBe(projectId);
    expect(project.defaultCadFormat).toBe("altium");

    const rev = await store.createRevisionFromUpload({
      id: revisionId,
      projectId: project.id,
      revisionLabel: "v1.0.0",
      bundleSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      normalizedSummary: { layerCount: 2 },
    });
    expect(rev.id).toBe(revisionId);

    const { delivery, rawToken } = await store.createDeliveryLink({
      revisionId: rev.id,
      expiresAt: new Date(Date.now() + 3600 * 1000),
      signedArchiveUrl: "https://storage.example.com/bundle.zip",
    });
    expect(delivery.revisionId).toBe(rev.id);

    const retrievedDelivery = await store.getDeliveryByToken(rawToken);
    expect(retrievedDelivery?.id).toBe(delivery.id);
  });
});
