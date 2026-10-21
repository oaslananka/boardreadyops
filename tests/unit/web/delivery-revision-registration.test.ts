import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  workspaceRoleFor: vi.fn(),
  registerValidatedRevisionFromArtifact: vi.fn(),
  workspaceIdForRevision: vi.fn(),
  revisionHasValidatedManufacturingEvidence: vi.fn(),
  createDeliveryLink: vi.fn(),
}));

const close = vi.hoisted(() => vi.fn(async () => undefined));
const query = vi.hoisted(() => vi.fn(async () => ({ rows: [{}] })));

vi.mock("../../../apps/web/lib/workspace-store-access.js", () => ({
  openWorkspaceStore: vi.fn(async () => ({ store, executor: { close, query } })),
}));

vi.mock("../../../apps/web/lib/viewer-authorization.js", () => ({
  viewerAuthorization: vi.fn(async () => ({
    session: { userId: 4711, login: "owner-person", installationIds: [1] },
    authorizeRepository: async () => true,
    authorizeInstallation: async () => true,
  })),
}));

process.env.DATABASE_URL = "postgres://test_user:test_secret@test_db_host:5432/test_db";

const {
  authorizeManufacturingShareAction,
  createDeliveryLinkAction,
  registerValidatedRevisionAction,
  revokeManufacturingShareAction,
} = await import("../../../apps/web/app/deliveries/actions.js");

const idle = { status: "idle" } as never;

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

function registration(candidate = "prj-1|run-1|art-1"): FormData {
  return form({
    workspaceId: "ws-1",
    candidate,
    revisionLabel: "rev C",
  });
}

function delivery(): FormData {
  return form({
    revisionId: "rev-1",
    signedArchiveUrl: "https://storage.example.com/gerbers.zip",
    expiresInDays: "7",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  store.workspaceRoleFor.mockResolvedValue("owner");
  query.mockResolvedValue({ rows: [{}] });
  store.registerValidatedRevisionFromArtifact.mockResolvedValue({
    id: "rev-1",
    projectId: "prj-1",
    revisionLabel: "rev C",
    sourceKind: "github_commit",
    bundleSha256: "b".repeat(64),
    normalizedSummary: {},
    validationRunId: "run-1",
    validationArtifactId: "art-1",
    createdAt: "2026-10-02T03:00:00.000Z",
  });
  store.workspaceIdForRevision.mockResolvedValue("ws-1");
  store.revisionHasValidatedManufacturingEvidence.mockResolvedValue(true);
  store.createDeliveryLink.mockResolvedValue({
    delivery: {
      id: "del-1",
      revisionId: "rev-1",
      accessTokenHash: "hash",
      expiresAt: "2026-10-09T03:00:00.000Z",
      signedArchiveUrl: "https://storage.example.com/gerbers.zip",
      createdAt: "2026-10-02T03:00:00.000Z",
    },
    rawToken: "raw-token",
  });
});

describe("validated delivery revision actions", () => {
  it("registers only the selected trusted evidence tuple in the viewer's workspace", async () => {
    const result = await registerValidatedRevisionAction(idle, registration());

    expect(result).toMatchObject({ status: "ok", data: { revisionId: "rev-1" } });
    expect(store.registerValidatedRevisionFromArtifact).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      projectId: "prj-1",
      runId: "run-1",
      artifactId: "art-1",
      revisionLabel: "rev C",
    });
    expect(store.workspaceRoleFor).toHaveBeenCalledWith("ws-1", {
      githubUserId: 4711,
      login: "owner-person",
    });
  });

  it("rejects a malformed evidence tuple before touching the registration store", async () => {
    const result = await registerValidatedRevisionAction(idle, registration("prj-1|run-1"));

    expect(result).toMatchObject({ status: "error" });
    expect(store.registerValidatedRevisionFromArtifact).not.toHaveBeenCalled();
  });

  it("fails closed when the evidence tuple became stale or was forged", async () => {
    store.registerValidatedRevisionFromArtifact.mockResolvedValue(null);

    const result = await registerValidatedRevisionAction(idle, registration());

    expect(result).toMatchObject({ status: "error" });
    expect(JSON.stringify(result)).toContain("no longer eligible");
  });

  it("does not let a viewer register a revision", async () => {
    store.workspaceRoleFor.mockResolvedValue("viewer");

    const result = await registerValidatedRevisionAction(idle, registration());

    expect(result).toMatchObject({ status: "error" });
    expect(store.registerValidatedRevisionFromArtifact).not.toHaveBeenCalled();
  });

  it("revalidates manufacturing evidence before minting a public delivery link", async () => {
    const result = await createDeliveryLinkAction(idle, delivery());

    expect(result).toMatchObject({ status: "ok", data: { token: "raw-token", deliveryId: "del-1" } });
    expect(store.revisionHasValidatedManufacturingEvidence).toHaveBeenCalledWith("rev-1");
    expect(store.createDeliveryLink).toHaveBeenCalledTimes(1);
  });

  it("refuses a guest link without explicit manufacturing sharing authorization", async () => {
    query.mockResolvedValue({ rows: [] });
    const result = await createDeliveryLinkAction(idle, delivery());
    expect(result).toMatchObject({ status: "error" });
    expect(JSON.stringify(result)).toContain("explicit owner/admin sharing authorization");
    expect(store.createDeliveryLink).not.toHaveBeenCalled();
  });

  it("requires an explicit acknowledgement and owner/admin role to authorize sharing", async () => {
    const noCheckbox = await authorizeManufacturingShareAction(idle, form({ revisionId: "rev-1" }));
    expect(noCheckbox).toMatchObject({ status: "error" });
    store.workspaceRoleFor.mockResolvedValue("member");
    const unauthorized = await authorizeManufacturingShareAction(
      idle,
      form({ revisionId: "rev-1", acknowledgement: "AUTHORIZE_SHARING" }),
    );
    expect(unauthorized).toMatchObject({ status: "error" });
    store.workspaceRoleFor.mockResolvedValue("owner");
    const approved = await authorizeManufacturingShareAction(
      idle,
      form({ revisionId: "rev-1", acknowledgement: "AUTHORIZE_SHARING" }),
    );
    expect(approved).toMatchObject({ status: "ok" });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("insert into manufacturing_share_authorizations"), [
      "rev-1",
      4711,
      "owner-person",
    ]);
  });

  it("requires owner/admin to revoke an existing sharing authorization", async () => {
    store.workspaceRoleFor.mockResolvedValue("viewer");
    expect(await revokeManufacturingShareAction(idle, form({ revisionId: "rev-1" }))).toMatchObject({
      status: "error",
    });
    store.workspaceRoleFor.mockResolvedValue("admin");
    expect(await revokeManufacturingShareAction(idle, form({ revisionId: "rev-1" }))).toMatchObject({ status: "ok" });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("update manufacturing_share_authorizations"), [
      "rev-1",
      4711,
      "owner-person",
    ]);
  });

  it("rejects unsafe archive schemes before creating a public guest link", async () => {
    for (const unsafe of ["javascript:alert(1)", "data:text/plain,untrusted", "http://storage.example.com/a.zip"]) {
      const values = delivery();
      values.set("signedArchiveUrl", unsafe);
      const result = await createDeliveryLinkAction(idle, values);
      expect(result).toMatchObject({ status: "error" });
    }
    expect(store.createDeliveryLink).not.toHaveBeenCalled();
  });

  it("refuses delivery when a previously recorded revision no longer has live trusted evidence", async () => {
    store.revisionHasValidatedManufacturingEvidence.mockResolvedValue(false);

    const result = await createDeliveryLinkAction(idle, delivery());

    expect(result).toMatchObject({ status: "error" });
    expect(JSON.stringify(result)).toContain("validated manufacturing evidence");
    expect(store.createDeliveryLink).not.toHaveBeenCalled();
  });
});
