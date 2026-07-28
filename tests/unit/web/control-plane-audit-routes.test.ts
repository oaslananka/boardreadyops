import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GET as listAuditEvents,
  runtime,
} from "../../../apps/web/app/api/v1/operator/installations/[installationId]/audit-events/route.js";
import {
  type ControlPlaneAuditRouteDependencies,
  createControlPlaneAuditRouteDependencies,
  handleControlPlaneAuditListRequest,
} from "../../../apps/web/lib/control-plane-audit-routes.js";
import type { AuditLogStore } from "../../../packages/db/src/audit-log-store.js";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";

const token = "operator-token-".padEnd(48, "x");
const installationId = "11111111-1111-4111-8111-111111111111";
const repositoryId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
const eventId = "44444444-4444-4444-8444-444444444444";
const executor = { query: vi.fn() } as unknown as SqlQueryExecutor;

afterEach(() => vi.unstubAllEnvs());

function request(path: string, authorization = `Bearer ${token}`): Request {
  return new Request(`https://boardreadyops.example${path}`, { headers: { authorization } });
}

function encodedCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function auditStore(overrides: Partial<AuditLogStore> = {}): AuditLogStore {
  return { listAuditEvents: vi.fn(async () => []), ...overrides };
}

function dependencies(
  store = auditStore(),
  environment: Readonly<Record<string, string | undefined>> = {
    BOARDREADYOPS_OPERATOR_API_TOKEN: token,
    BOARDREADYOPS_OPERATOR_ACTOR_ID: "operator.primary",
    DATABASE_URL: "postgresql://example.invalid/boardreadyops",
  },
): ControlPlaneAuditRouteDependencies {
  return {
    environment,
    queryExecutor: vi.fn(() => executor),
    createAuditLogStore: vi.fn(() => store),
  };
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("control-plane audit export route", () => {
  it("exposes a node-runtime GET route and explicit database wiring", async () => {
    expect(runtime).toBe("nodejs");
    expect(listAuditEvents).toBeTypeOf("function");

    const store = auditStore();
    const createQueryExecutor = vi.fn(() => executor);
    const createAuditLogStore = vi.fn(() => store);
    const wired = createControlPlaneAuditRouteDependencies(
      { DATABASE_URL: "postgresql://db.example/boardreadyops", DATABASE_POOL_MAX: "7" },
      { createQueryExecutor, createAuditLogStore },
    );
    expect(wired.queryExecutor()).toBe(executor);
    expect(createQueryExecutor).toHaveBeenCalledWith({
      connectionString: "postgresql://db.example/boardreadyops",
      max: 7,
    });
    expect(wired.createAuditLogStore(executor)).toBe(store);

    const defaultPool = createControlPlaneAuditRouteDependencies(
      { DATABASE_URL: "postgresql://db.example/boardreadyops" },
      { createQueryExecutor, createAuditLogStore },
    );
    expect(defaultPool.queryExecutor()).toBe(executor);
    expect(createQueryExecutor).toHaveBeenLastCalledWith({
      connectionString: "postgresql://db.example/boardreadyops",
      max: 5,
    });

    const withoutDatabase = createControlPlaneAuditRouteDependencies({}, { createQueryExecutor, createAuditLogStore });
    expect(withoutDatabase.queryExecutor()).toBeUndefined();
  });

  it("executes the Next route wrapper and fails closed without a database", async () => {
    vi.stubEnv("BOARDREADYOPS_OPERATOR_API_TOKEN", token);
    vi.stubEnv("BOARDREADYOPS_OPERATOR_ACTOR_ID", "operator.primary");
    vi.stubEnv("DATABASE_URL", "");

    const response = await listAuditEvents(request(`/api/v1/operator/installations/${installationId}/audit-events`), {
      params: Promise.resolve({ installationId }),
    });
    expect(response.status).toBe(503);
    expect(await json(response)).toEqual({ ok: false, error: "database is not configured" });
  });

  it("fails closed before database access when disabled or unauthorized", async () => {
    const disabled = dependencies(auditStore(), {});
    const disabledResponse = await handleControlPlaneAuditListRequest(
      request(`/api/v1/operator/installations/${installationId}/audit-events`),
      installationId,
      disabled,
    );
    expect(disabledResponse.status).toBe(503);
    expect(disabled.queryExecutor).not.toHaveBeenCalled();

    const unauthorized = dependencies();
    const unauthorizedResponse = await handleControlPlaneAuditListRequest(
      request(`/api/v1/operator/installations/${installationId}/audit-events`, "Bearer invalid"),
      installationId,
      unauthorized,
    );
    expect(unauthorizedResponse.status).toBe(401);
    expect(unauthorizedResponse.headers.get("www-authenticate")).toBe("Bearer");
    expect(unauthorized.queryExecutor).not.toHaveBeenCalled();
  });

  it("rejects invalid tenant filters and cursor before database access", async () => {
    const deps = dependencies();
    for (const path of [
      `/api/v1/operator/installations/${installationId}/audit-events?limit=0`,
      `/api/v1/operator/installations/${installationId}/audit-events?limit=101`,
      `/api/v1/operator/installations/${installationId}/audit-events?repositoryId=bad%20id`,
      `/api/v1/operator/installations/${installationId}/audit-events?releaseRunId=bad%20id`,
      `/api/v1/operator/installations/${installationId}/audit-events?eventType=Runner%20Result`,
      `/api/v1/operator/installations/${installationId}/audit-events?eventType=${"a".repeat(161)}`,
      `/api/v1/operator/installations/${installationId}/audit-events?cursor=not-base64`,
      `/api/v1/operator/installations/${installationId}/audit-events?cursor=${encodedCursor(null)}`,
      `/api/v1/operator/installations/${installationId}/audit-events?cursor=${encodedCursor([])}`,
      `/api/v1/operator/installations/${installationId}/audit-events?cursor=${encodedCursor({ createdAt: 1, id: "cursor-id" })}`,
      `/api/v1/operator/installations/${installationId}/audit-events?cursor=${encodedCursor({ createdAt: "not-a-date", id: "cursor-id" })}`,
      `/api/v1/operator/installations/${installationId}/audit-events?cursor=${encodedCursor({ createdAt: "2026-07-28T03:00:00.000Z", id: "bad id" })}`,
    ]) {
      const response = await handleControlPlaneAuditListRequest(request(path), installationId, deps);
      expect(response.status, path).toBe(400);
    }
    const invalidInstallation = await handleControlPlaneAuditListRequest(
      request("/api/v1/operator/installations/bad%20installation/audit-events"),
      "bad installation",
      deps,
    );
    expect(invalidInstallation.status).toBe(400);
    expect(deps.queryExecutor).not.toHaveBeenCalled();
  });

  it("decodes a valid cursor and returns an empty terminal page", async () => {
    const list = vi.fn(async () => []);
    const deps = dependencies(auditStore({ listAuditEvents: list }));
    const createdAt = "2026-07-28T03:00:00.000Z";
    const cursorId = "cursor-id";
    const response = await handleControlPlaneAuditListRequest(
      request(
        `/api/v1/operator/installations/${installationId}/audit-events?limit=2&cursor=${encodedCursor({ createdAt, id: cursorId })}`,
      ),
      installationId,
      deps,
    );

    expect(response.status).toBe(200);
    expect(list).toHaveBeenCalledWith({
      installationId,
      limit: 2,
      cursor: { createdAt: new Date(createdAt), id: cursorId },
    });
    expect(await json(response)).toEqual({ ok: true, items: [] });
  });

  it("lists privacy-safe events with stable cursor pagination", async () => {
    const list = vi.fn(async () => [
      {
        id: eventId,
        installationId,
        eventType: "runner.result.persisted",
        actorType: "runner",
        subjectType: "release_run",
        repositoryId,
        repositoryFullName: "octo/board",
        releaseRunId: runId,
        metadata: { status: "completed", conclusion: "success" },
        createdAt: "2026-07-28T02:00:00.000Z",
      },
    ]);
    const deps = dependencies(auditStore({ listAuditEvents: list }));
    const response = await handleControlPlaneAuditListRequest(
      request(
        `/api/v1/operator/installations/${installationId}/audit-events?limit=1&repositoryId=${repositoryId}&releaseRunId=${runId}&eventType=runner.result.persisted`,
      ),
      installationId,
      deps,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(list).toHaveBeenCalledWith({
      installationId,
      repositoryId,
      releaseRunId: runId,
      eventType: "runner.result.persisted",
      limit: 1,
    });
    const payload = await json(response);
    expect(payload).toMatchObject({
      ok: true,
      items: [expect.objectContaining({ id: eventId, metadata: { status: "completed", conclusion: "success" } })],
    });
    expect(payload.nextCursor).toBeTypeOf("string");
    expect(JSON.stringify(payload)).not.toContain("password");
    expect(JSON.stringify(payload)).not.toContain("authorization");
  });

  it("hides database failures behind a stable unavailable response", async () => {
    const deps = dependencies(
      auditStore({
        listAuditEvents: vi.fn(async () => {
          throw new Error("password=do-not-leak");
        }),
      }),
    );
    const response = await handleControlPlaneAuditListRequest(
      request(`/api/v1/operator/installations/${installationId}/audit-events`),
      installationId,
      deps,
    );
    expect(response.status).toBe(503);
    expect(await json(response)).toEqual({ ok: false, error: "audit export is temporarily unavailable" });
  });
});
