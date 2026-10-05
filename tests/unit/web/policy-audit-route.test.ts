import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getPolicyAudit } from "../../../apps/web/app/api/v1/policies/[id]/audit/route.js";
import * as cloudConfig from "../../../apps/web/lib/cloud-runtime-config.js";
import * as viewerAuth from "../../../apps/web/lib/viewer-authorization.js";

const mockQuery = vi.fn();
const mockClose = vi.fn();

vi.mock("@boardreadyops/db/pg-executor", () => ({
  createPgQueryExecutor: vi.fn(() => ({ query: mockQuery, close: mockClose })),
}));

function signedIn(login = "octocat") {
  vi.spyOn(viewerAuth, "viewerAuthorization").mockResolvedValue({
    session: {
      userId: 42,
      login,
      installationIds: [1],
      issuedAt: "2026-10-05T03:00:00.000Z",
      expiresAt: "2026-10-05T11:00:00.000Z",
    },
  } as Awaited<ReturnType<typeof viewerAuth.viewerAuthorization>>);
}

function postgres() {
  vi.spyOn(cloudConfig, "optionalCloudPersistenceConfiguration").mockReturnValue({
    mode: "postgres",
    databaseUrl: "postgresql://postgres:postgres@localhost:5432/boardreadyops",
  });
}

const request = new Request("https://boardreadyops.test/api/v1/policies/rpol_1/audit");
const props = { params: Promise.resolve({ id: "rpol_1" }) };

describe("policy audit route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockQuery.mockReset();
    mockClose.mockReset();
  });

  it("requires an authenticated viewer before probing persistence", async () => {
    vi.spyOn(viewerAuth, "viewerAuthorization").mockResolvedValue(
      {} as Awaited<ReturnType<typeof viewerAuth.viewerAuthorization>>,
    );
    const persistence = vi.spyOn(cloudConfig, "optionalCloudPersistenceConfiguration");

    const response = await getPolicyAudit(request, props);

    expect(response.status).toBe(401);
    expect(persistence).not.toHaveBeenCalled();
  });

  it("returns 404 when the policy belongs to another tenant", async () => {
    signedIn();
    postgres();
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "rpol_1",
          tenantId: "other-tenant",
          scope: "organization",
          scopeId: null,
          name: "Other policy",
          description: null,
          requiredChecklist: [],
          requiredRoles: [],
          severityGate: null,
          requireEvidencePack: false,
          requireExternalReview: false,
          createdAt: "2026-10-05T03:00:00.000Z",
          updatedAt: "2026-10-05T03:00:00.000Z",
        },
      ],
    });

    const response = await getPolicyAudit(request, props);

    expect(response.status).toBe(404);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockClose).toHaveBeenCalledOnce();
  });

  it("keeps deleted policy history readable for the same tenant", async () => {
    signedIn();
    postgres();
    mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          tenantId: "octocat",
          policyId: "rpol_1",
          action: "delete",
          scope: "organization",
          scopeId: null,
          actorGithubUserId: "42",
          actorLogin: "octocat",
          beforePolicy: { id: "rpol_1", name: "Deleted gate" },
          afterPolicy: null,
          createdAt: "2026-10-05T03:10:00.000Z",
        },
      ],
    });

    const response = await getPolicyAudit(request, props);
    const body = (await response.json()) as { ok: boolean; events: Array<{ action: string }> };

    expect(response.status).toBe(200);
    expect(body.events).toEqual([expect.objectContaining({ action: "delete" })]);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("returns 404 for an unknown policy with no tenant audit history", async () => {
    signedIn();
    postgres();
    mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });

    const response = await getPolicyAudit(request, props);

    expect(response.status).toBe(404);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("returns only the owned policy's bounded tenant-scoped audit history", async () => {
    signedIn();
    postgres();
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: "rpol_1",
            tenantId: "octocat",
            scope: "organization",
            scopeId: null,
            name: "Release gate",
            description: null,
            requiredChecklist: [],
            requiredRoles: [],
            severityGate: "high",
            requireEvidencePack: true,
            requireExternalReview: false,
            createdAt: "2026-10-05T03:00:00.000Z",
            updatedAt: "2026-10-05T03:05:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            tenantId: "octocat",
            policyId: "rpol_1",
            action: "update",
            scope: "organization",
            scopeId: null,
            actorGithubUserId: "42",
            actorLogin: "octocat",
            beforePolicy: { name: "Release gate" },
            afterPolicy: { name: "Release gate", severityGate: "high" },
            createdAt: "2026-10-05T03:05:00.000Z",
          },
        ],
      });

    const response = await getPolicyAudit(request, props);
    const body = (await response.json()) as { ok: boolean; events: Array<{ actorLogin: string; action: string }> };

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      events: [expect.objectContaining({ action: "update", actorLogin: "octocat" })],
    });
    const [, auditParams] = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(auditParams).toEqual(["octocat", "rpol_1", 100]);
    expect(mockClose).toHaveBeenCalledOnce();
  });
});
