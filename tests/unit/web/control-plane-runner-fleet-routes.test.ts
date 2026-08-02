import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GET as getRunnerFleet,
  runtime,
} from "../../../apps/web/app/api/v1/operator/installations/[installationId]/runner-fleet/route.js";
import {
  type ControlPlaneRunnerFleetRouteDependencies,
  createControlPlaneRunnerFleetRouteDependencies,
  handleControlPlaneRunnerFleetRequest,
} from "../../../apps/web/lib/control-plane-runner-fleet-routes.js";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";
import type { RunnerFleetHealthStore } from "../../../packages/db/src/runner-fleet-health-store.js";

const token = "operator-token-".padEnd(48, "x");
const installationId = "11111111-1111-4111-8111-111111111111";
const observedAt = new Date("2026-08-02T09:30:00.000Z");
const executor = { query: vi.fn() } as unknown as SqlQueryExecutor;

afterEach(() => vi.unstubAllEnvs());

function request(authorization = `Bearer ${token}`): Request {
  return new Request(`https://boardreadyops.example/api/v1/operator/installations/${installationId}/runner-fleet`, {
    headers: { authorization },
  });
}

function snapshot() {
  return {
    observedAt: observedAt.toISOString(),
    observationWindowSeconds: 300,
    status: "healthy" as const,
    registrations: { active: 1, online: 1, stale: 0, versionUnreported: 0, lastSeenAt: observedAt.toISOString() },
    queue: { pendingJobs: 0 },
    leases: { active: 0 },
    versions: [{ version: "1.27.1", registrations: 1 }],
  };
}

function dependencies(
  store: RunnerFleetHealthStore = { readFleetHealth: vi.fn(async () => snapshot()) },
  environment: Readonly<Record<string, string | undefined>> = {
    BOARDREADYOPS_OPERATOR_API_TOKEN: token,
    BOARDREADYOPS_OPERATOR_ACTOR_ID: "operator.primary",
    DATABASE_URL: "postgresql://example.invalid/boardreadyops",
  },
): ControlPlaneRunnerFleetRouteDependencies {
  return {
    environment,
    now: () => observedAt,
    queryExecutor: vi.fn(() => executor),
    createRunnerFleetHealthStore: vi.fn(() => store),
  };
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("control-plane runner fleet route", () => {
  it("exposes a node-runtime GET route and explicit database wiring", async () => {
    expect(runtime).toBe("nodejs");
    expect(getRunnerFleet).toBeTypeOf("function");

    const store: RunnerFleetHealthStore = { readFleetHealth: vi.fn(async () => snapshot()) };
    const createQueryExecutor = vi.fn(() => executor);
    const createRunnerFleetHealthStore = vi.fn(() => store);
    const wired = createControlPlaneRunnerFleetRouteDependencies(
      { DATABASE_URL: "postgresql://db.example/boardreadyops", DATABASE_POOL_MAX: "7" },
      { createQueryExecutor, createRunnerFleetHealthStore },
    );
    expect(wired.queryExecutor()).toBe(executor);
    expect(createQueryExecutor).toHaveBeenCalledWith({
      connectionString: "postgresql://db.example/boardreadyops",
      max: 7,
    });
    expect(wired.createRunnerFleetHealthStore(executor)).toBe(store);

    vi.stubEnv("BOARDREADYOPS_OPERATOR_API_TOKEN", token);
    vi.stubEnv("BOARDREADYOPS_OPERATOR_ACTOR_ID", "operator.primary");
    vi.stubEnv("DATABASE_URL", "");
    const response = await getRunnerFleet(request(), { params: Promise.resolve({ installationId }) });
    expect(response.status).toBe(503);
  });

  it("fails closed before database access when disabled, unauthorized, or invalid", async () => {
    const disabled = dependencies({ readFleetHealth: vi.fn(async () => snapshot()) }, {});
    const disabledResponse = await handleControlPlaneRunnerFleetRequest(request(), installationId, disabled);
    expect(disabledResponse.status).toBe(503);
    expect(disabled.queryExecutor).not.toHaveBeenCalled();

    const unauthorized = dependencies();
    const unauthorizedResponse = await handleControlPlaneRunnerFleetRequest(
      request("Bearer invalid"),
      installationId,
      unauthorized,
    );
    expect(unauthorizedResponse.status).toBe(401);
    expect(unauthorizedResponse.headers.get("www-authenticate")).toBe("Bearer");
    expect(unauthorized.queryExecutor).not.toHaveBeenCalled();

    const invalid = dependencies();
    const invalidResponse = await handleControlPlaneRunnerFleetRequest(request(), "bad installation", invalid);
    expect(invalidResponse.status).toBe(400);
    expect(invalid.queryExecutor).not.toHaveBeenCalled();
  });

  it("returns only aggregate fleet health and fixed observation-window metadata", async () => {
    const readFleetHealth = vi.fn(async () => snapshot());
    const deps = dependencies({ readFleetHealth });
    const response = await handleControlPlaneRunnerFleetRequest(request(), installationId, deps);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(readFleetHealth).toHaveBeenCalledWith({
      installationId,
      observedAt,
      observationWindowSeconds: 300,
    });
    const payload = await json(response);
    expect(payload).toEqual({ ok: true, fleet: snapshot() });
    const serialized = JSON.stringify(payload);
    for (const forbidden of ["repository", "owner", "source", "publicKey", "fingerprint", "allowedRepositories"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("returns stable not-found and unavailable responses without leaking database errors", async () => {
    const missing = dependencies({ readFleetHealth: vi.fn(async () => undefined) });
    const missingResponse = await handleControlPlaneRunnerFleetRequest(request(), installationId, missing);
    expect(missingResponse.status).toBe(404);
    expect(await json(missingResponse)).toEqual({ ok: false, error: "installation was not found" });

    const unavailable = dependencies({
      readFleetHealth: vi.fn(async () => {
        throw new Error("password=[REDACTED]");
      }),
    });
    const unavailableResponse = await handleControlPlaneRunnerFleetRequest(request(), installationId, unavailable);
    expect(unavailableResponse.status).toBe(503);
    expect(await json(unavailableResponse)).toEqual({
      ok: false,
      error: "runner fleet health is temporarily unavailable",
    });
  });
});
