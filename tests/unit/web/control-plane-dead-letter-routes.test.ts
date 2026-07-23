import { afterEach, describe, expect, it, vi } from "vitest";
import {
  POST as replayDeadLetter,
  runtime as replayRuntime,
} from "../../../apps/web/app/api/v1/operator/installations/[installationId]/dead-letters/[itemType]/[itemId]/replay/route.js";
import {
  GET as listDeadLetters,
  runtime as listRuntime,
} from "../../../apps/web/app/api/v1/operator/installations/[installationId]/dead-letters/route.js";
import {
  type ControlPlaneDeadLetterRouteDependencies,
  createControlPlaneDeadLetterRouteDependencies,
  handleControlPlaneDeadLetterListRequest,
  handleControlPlaneDeadLetterReplayRequest,
} from "../../../apps/web/lib/control-plane-dead-letter-routes.js";
import type { ControlPlaneOperationsStore } from "../../../packages/db/src/control-plane-operations-store.js";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";

const token = "operator-token-".padEnd(48, "x");
const installationId = "11111111-1111-4111-8111-111111111111";
const itemId = "22222222-2222-4222-8222-222222222222";
const operationId = "33333333-3333-4333-8333-333333333333";
const executor = { query: vi.fn() } as unknown as SqlQueryExecutor;
afterEach(() => {
  vi.unstubAllEnvs();
});

function request(
  path: string,
  input: { authorization?: string; idempotencyKey?: string; method?: string } = {},
): Request {
  const headers = new Headers();
  if (input.authorization !== undefined) headers.set("authorization", input.authorization);
  if (input.idempotencyKey !== undefined) headers.set("idempotency-key", input.idempotencyKey);
  return new Request(`https://boardreadyops.example${path}`, {
    method: input.method ?? "GET",
    headers,
  });
}

function operationsStore(
  overrides: Partial<Pick<ControlPlaneOperationsStore, "listDeadLetters" | "replayDeadLetter">> = {},
): Pick<ControlPlaneOperationsStore, "listDeadLetters" | "replayDeadLetter"> {
  return {
    listDeadLetters: vi.fn(async () => []),
    replayDeadLetter: vi.fn(async () => ({ outcome: "replayed" as const, auditEventId: "audit-1" })),
    ...overrides,
  };
}

function dependencies(
  store = operationsStore(),
  environment: Readonly<Record<string, string | undefined>> = {
    BOARDREADYOPS_OPERATOR_API_TOKEN: token,
    BOARDREADYOPS_OPERATOR_ACTOR_ID: "operator.primary",
    DATABASE_URL: "postgresql://example.invalid/boardreadyops",
  },
): ControlPlaneDeadLetterRouteDependencies {
  return {
    environment,
    queryExecutor: vi.fn(() => executor),
    createOperationsStore: vi.fn(() => store),
  };
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("control-plane dead-letter operator routes", () => {
  it("exposes node-runtime GET and POST route modules", () => {
    expect(listRuntime).toBe("nodejs");
    expect(replayRuntime).toBe("nodejs");
    expect(listDeadLetters).toBeTypeOf("function");
    expect(replayDeadLetter).toBeTypeOf("function");
  });

  it("builds explicit database wiring and delegates the Next routes", async () => {
    const store = operationsStore();
    const createQueryExecutor = vi.fn(() => executor);
    const createOperationsStore = vi.fn(() => store);
    const wired = createControlPlaneDeadLetterRouteDependencies(
      {
        BOARDREADYOPS_OPERATOR_API_TOKEN: token,
        BOARDREADYOPS_OPERATOR_ACTOR_ID: "operator.primary",
        DATABASE_URL: "postgresql://db.example/boardreadyops",
        DATABASE_POOL_MAX: "7",
      },
      { createQueryExecutor, createOperationsStore },
    );
    expect(wired.queryExecutor()).toBe(executor);
    expect(createQueryExecutor).toHaveBeenCalledWith({
      connectionString: "postgresql://db.example/boardreadyops",
      max: 7,
    });
    expect(wired.createOperationsStore(executor)).toBe(store);
    expect(createOperationsStore).toHaveBeenCalledWith(executor);

    const defaultPool = createControlPlaneDeadLetterRouteDependencies(
      { DATABASE_URL: "postgresql://db.example/boardreadyops" },
      { createQueryExecutor, createOperationsStore },
    );
    expect(defaultPool.queryExecutor()).toBe(executor);
    expect(createQueryExecutor).toHaveBeenLastCalledWith({
      connectionString: "postgresql://db.example/boardreadyops",
      max: 5,
    });

    const withoutDatabase = createControlPlaneDeadLetterRouteDependencies(
      {},
      { createQueryExecutor, createOperationsStore },
    );
    expect(withoutDatabase.queryExecutor()).toBeUndefined();

    vi.stubEnv("BOARDREADYOPS_OPERATOR_API_TOKEN", token);
    vi.stubEnv("BOARDREADYOPS_OPERATOR_ACTOR_ID", "operator.primary");
    vi.stubEnv("DATABASE_URL", "");
    const listResponse = await listDeadLetters(
      request(`/api/v1/operator/installations/${installationId}/dead-letters`, {
        authorization: `Bearer ${token}`,
      }),
      { params: Promise.resolve({ installationId }) },
    );
    expect(listResponse.status).toBe(503);
    expect(await json(listResponse)).toEqual({ ok: false, error: "database is not configured" });

    const replayResponse = await replayDeadLetter(
      request(`/api/v1/operator/installations/${installationId}/dead-letters/job/${itemId}/replay`, {
        method: "POST",
        authorization: `Bearer ${token}`,
      }),
      { params: Promise.resolve({ installationId, itemType: "job", itemId }) },
    );
    expect(replayResponse.status).toBe(400);
  });

  it("fails closed when operator configuration is disabled or authentication fails", async () => {
    const disabled = dependencies(operationsStore(), {});
    const disabledResponse = await handleControlPlaneDeadLetterListRequest(
      request(`/api/v1/operator/installations/${installationId}/dead-letters`, {
        authorization: `Bearer ${token}`,
      }),
      installationId,
      disabled,
    );
    expect(disabledResponse.status).toBe(503);
    expect(await json(disabledResponse)).toEqual({ ok: false, error: "operator API is not configured" });
    expect(disabled.queryExecutor).not.toHaveBeenCalled();

    const unauthorized = dependencies();
    const unauthorizedResponse = await handleControlPlaneDeadLetterListRequest(
      request(`/api/v1/operator/installations/${installationId}/dead-letters`, {
        authorization: "Bearer incorrect-credential-that-is-long-enough-xxxxxxxx",
      }),
      installationId,
      unauthorized,
    );
    expect(unauthorizedResponse.status).toBe(401);
    expect(unauthorizedResponse.headers.get("www-authenticate")).toBe("Bearer");
    expect(unauthorized.queryExecutor).not.toHaveBeenCalled();
  });

  it("rejects invalid installation identifiers and pagination", async () => {
    const deps = dependencies();
    const invalidInstallation = await handleControlPlaneDeadLetterListRequest(
      request("/api/v1/operator/installations/bad/dead-letters", { authorization: `Bearer ${token}` }),
      "bad installation",
      deps,
    );
    expect(invalidInstallation.status).toBe(400);

    for (const query of [
      "?limit=0",
      "?limit=101",
      "?limit=1.5",
      "?limit=01",
      "?before=not-a-date",
      `?before=${"x".repeat(65)}`,
    ]) {
      const response = await handleControlPlaneDeadLetterListRequest(
        request(`/api/v1/operator/installations/${installationId}/dead-letters${query}`, {
          authorization: `Bearer ${token}`,
        }),
        installationId,
        deps,
      );
      expect(response.status, query).toBe(400);
    }
    expect(deps.queryExecutor).not.toHaveBeenCalled();
  });

  it("lists bounded tenant metadata and forwards an opaque time cursor", async () => {
    const listDeadLetters = vi.fn(async () => [
      {
        itemType: "outbox" as const,
        itemId,
        installationId,
        repositoryId: "repository-1",
        repositoryFullName: "octo/board",
        releaseRunId: "run-1",
        reasonCode: "delivery_uncertain",
        errorClass: "WorkflowDispatchDeliveryUncertainError",
        attemptCount: 2,
        failedAt: "2026-07-23T15:30:00.000Z",
        replaySafe: false,
      },
    ]);
    const deps = dependencies(operationsStore({ listDeadLetters }));
    const response = await handleControlPlaneDeadLetterListRequest(
      request(
        `/api/v1/operator/installations/${installationId}/dead-letters?limit=1&before=2026-07-23T16%3A00%3A00.000Z`,
        { authorization: `Bearer ${token}` },
      ),
      installationId,
      deps,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(listDeadLetters).toHaveBeenCalledWith({
      installationId,
      limit: 1,
      before: new Date("2026-07-23T16:00:00.000Z"),
    });
    const payload = await json(response);
    expect(payload).toEqual({
      ok: true,
      items: [
        {
          itemType: "outbox",
          itemId,
          installationId,
          repositoryId: "repository-1",
          repositoryFullName: "octo/board",
          releaseRunId: "run-1",
          reasonCode: "delivery_uncertain",
          errorClass: "WorkflowDispatchDeliveryUncertainError",
          attemptCount: 2,
          failedAt: "2026-07-23T15:30:00.000Z",
          replaySafe: false,
        },
      ],
      nextBefore: "2026-07-23T15:30:00.000Z",
    });
    expect(JSON.stringify(payload)).not.toContain("payload");
    expect(JSON.stringify(payload)).not.toContain("normalizedActions");
  });

  it("lists an empty page without a cursor when fewer than the requested limit exist", async () => {
    const listDeadLetters = vi.fn(async () => []);
    const deps = dependencies(operationsStore({ listDeadLetters }));
    const response = await handleControlPlaneDeadLetterListRequest(
      request(`/api/v1/operator/installations/${installationId}/dead-letters`, {
        authorization: `Bearer ${token}`,
      }),
      installationId,
      deps,
    );

    expect(response.status).toBe(200);
    expect(listDeadLetters).toHaveBeenCalledWith({ installationId, limit: 50 });
    expect(await json(response)).toEqual({ ok: true, items: [] });
  });

  it("reports unavailable database configuration and hides store failures", async () => {
    const missingDatabase = dependencies();
    vi.mocked(missingDatabase.queryExecutor).mockReturnValue(undefined);
    const missingResponse = await handleControlPlaneDeadLetterListRequest(
      request(`/api/v1/operator/installations/${installationId}/dead-letters`, {
        authorization: `Bearer ${token}`,
      }),
      installationId,
      missingDatabase,
    );
    expect(missingResponse.status).toBe(503);
    expect(await json(missingResponse)).toEqual({ ok: false, error: "database is not configured" });

    const failing = dependencies(
      operationsStore({
        listDeadLetters: vi.fn(async () => {
          throw new Error("password=do-not-leak");
        }),
      }),
    );
    const failingResponse = await handleControlPlaneDeadLetterListRequest(
      request(`/api/v1/operator/installations/${installationId}/dead-letters`, {
        authorization: `Bearer ${token}`,
      }),
      installationId,
      failing,
    );
    expect(failingResponse.status).toBe(503);
    expect(JSON.stringify(await json(failingResponse))).not.toContain("do-not-leak");
  });

  it("fails replay authentication before accessing the database", async () => {
    const deps = dependencies();
    const response = await handleControlPlaneDeadLetterReplayRequest(
      request(`/api/v1/operator/installations/${installationId}/dead-letters/job/${itemId}/replay`, {
        method: "POST",
        authorization: `Bearer ${"z".repeat(token.length)}`,
        idempotencyKey: operationId,
      }),
      { installationId, itemType: "job", itemId },
      deps,
    );

    expect(response.status).toBe(401);
    expect(deps.queryExecutor).not.toHaveBeenCalled();
  });

  it("requires validated replay identifiers and an idempotency key", async () => {
    const deps = dependencies();
    const missingKey = await handleControlPlaneDeadLetterReplayRequest(
      request(`/api/v1/operator/installations/${installationId}/dead-letters/job/${itemId}/replay`, {
        method: "POST",
        authorization: `Bearer ${token}`,
      }),
      { installationId, itemType: "job", itemId },
      deps,
    );
    expect(missingKey.status).toBe(400);

    const invalidType = await handleControlPlaneDeadLetterReplayRequest(
      request(`/api/v1/operator/installations/${installationId}/dead-letters/unknown/${itemId}/replay`, {
        method: "POST",
        authorization: `Bearer ${token}`,
        idempotencyKey: operationId,
      }),
      { installationId, itemType: "unknown", itemId },
      deps,
    );
    expect(invalidType.status).toBe(400);

    const invalidOperation = await handleControlPlaneDeadLetterReplayRequest(
      request(`/api/v1/operator/installations/${installationId}/dead-letters/job/${itemId}/replay`, {
        method: "POST",
        authorization: `Bearer ${token}`,
        idempotencyKey: "bad operation",
      }),
      { installationId, itemType: "job", itemId },
      deps,
    );
    expect(invalidOperation.status).toBe(400);
    expect(deps.queryExecutor).not.toHaveBeenCalled();
  });

  it("reports unavailable replay storage after validating the request", async () => {
    const deps = dependencies();
    vi.mocked(deps.queryExecutor).mockReturnValue(undefined);
    const response = await handleControlPlaneDeadLetterReplayRequest(
      request(`/api/v1/operator/installations/${installationId}/dead-letters/job/${itemId}/replay`, {
        method: "POST",
        authorization: `Bearer ${token}`,
        idempotencyKey: operationId,
      }),
      { installationId, itemType: "job", itemId },
      deps,
    );

    expect(response.status).toBe(503);
    expect(await json(response)).toEqual({ ok: false, error: "database is not configured" });
  });

  it("replays with the configured actor and maps idempotent success outcomes", async () => {
    for (const outcome of ["replayed", "already_applied"] as const) {
      const replayDeadLetter = vi.fn(async () => ({ outcome, auditEventId: "audit-1" }));
      const deps = dependencies(operationsStore({ replayDeadLetter }));
      const response = await handleControlPlaneDeadLetterReplayRequest(
        request(`/api/v1/operator/installations/${installationId}/dead-letters/job/${itemId}/replay`, {
          method: "POST",
          authorization: `Bearer ${token}`,
          idempotencyKey: operationId,
        }),
        { installationId, itemType: "job", itemId },
        deps,
      );

      expect(response.status).toBe(200);
      expect(replayDeadLetter).toHaveBeenCalledWith({
        installationId,
        itemType: "job",
        itemId,
        operationId,
        actorId: "operator.primary",
      });
      expect(await json(response)).toEqual({ ok: true, outcome, auditEventId: "audit-1" });
    }
  });

  it("returns idempotent success without inventing an audit event identifier", async () => {
    const replayDeadLetter = vi.fn(async () => ({ outcome: "already_applied" as const }));
    const deps = dependencies(operationsStore({ replayDeadLetter }));
    const response = await handleControlPlaneDeadLetterReplayRequest(
      request(`/api/v1/operator/installations/${installationId}/dead-letters/job/${itemId}/replay`, {
        method: "POST",
        authorization: `Bearer ${token}`,
        idempotencyKey: operationId,
      }),
      { installationId, itemType: "job", itemId },
      deps,
    );

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ ok: true, outcome: "already_applied" });
  });

  it("hides replay store failures behind a stable unavailable response", async () => {
    const deps = dependencies(
      operationsStore({
        replayDeadLetter: vi.fn(async () => {
          throw new Error("password=do-not-leak");
        }),
      }),
    );
    const response = await handleControlPlaneDeadLetterReplayRequest(
      request(`/api/v1/operator/installations/${installationId}/dead-letters/job/${itemId}/replay`, {
        method: "POST",
        authorization: `Bearer ${token}`,
        idempotencyKey: operationId,
      }),
      { installationId, itemType: "job", itemId },
      deps,
    );
    expect(response.status).toBe(503);
    const payload = await json(response);
    expect(payload).toEqual({ ok: false, error: "dead-letter replay is temporarily unavailable" });
    expect(JSON.stringify(payload)).not.toContain("do-not-leak");
  });

  it("maps tenant misses and unsafe replay without revealing database details", async () => {
    const cases = [
      { outcome: "not_found" as const, status: 404, error: "dead-letter item not found" },
      { outcome: "not_replayable" as const, status: 409, error: "dead-letter item is not safely replayable" },
    ];
    for (const testCase of cases) {
      const deps = dependencies(
        operationsStore({ replayDeadLetter: vi.fn(async () => ({ outcome: testCase.outcome })) }),
      );
      const response = await handleControlPlaneDeadLetterReplayRequest(
        request(`/api/v1/operator/installations/${installationId}/dead-letters/outbox/${itemId}/replay`, {
          method: "POST",
          authorization: `Bearer ${token}`,
          idempotencyKey: operationId,
        }),
        { installationId, itemType: "outbox", itemId },
        deps,
      );
      expect(response.status).toBe(testCase.status);
      expect(await json(response)).toEqual({ ok: false, error: testCase.error });
    }
  });
});
