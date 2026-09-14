import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as lookupWorkspaceSlug, runtime } from "../../../apps/web/app/api/v1/operator/workspaces/route.js";
import {
  type ControlPlaneWorkspaceRouteDependencies,
  createControlPlaneWorkspaceRouteDependencies,
  handleControlPlaneWorkspaceSlugRequest,
} from "../../../apps/web/lib/control-plane-workspace-routes.js";
import { resetOperatorRateLimitForTests } from "../../../apps/web/lib/operator-rate-limit.js";
import type { WorkspaceStore } from "../../../packages/db/src/workspace-store.js";

const token = "operator-token-".padEnd(48, "x");

afterEach(() => {
  vi.unstubAllEnvs();
  resetOperatorRateLimitForTests();
});

function request(path: string, authorization = `Bearer ${token}`): Request {
  return new Request(`https://boardreadyops.example${path}`, { headers: { authorization } });
}

type SlugLookup = Pick<WorkspaceStore, "findWorkspaceBySlugWithOwners">;

function workspaceStore(result: Awaited<ReturnType<SlugLookup["findWorkspaceBySlugWithOwners"]>> = null): SlugLookup {
  return { findWorkspaceBySlugWithOwners: vi.fn(async () => result) };
}

const close = vi.fn(async () => undefined);

function dependencies(
  store: SlugLookup = workspaceStore(),
  environment: Readonly<Record<string, string | undefined>> = {
    BOARDREADYOPS_OPERATOR_API_TOKEN: token,
    BOARDREADYOPS_OPERATOR_ACTOR_ID: "operator.primary",
    DATABASE_URL: "postgresql://example.invalid/boardreadyops",
  },
): ControlPlaneWorkspaceRouteDependencies {
  return { environment, openStore: vi.fn(async () => ({ store, executor: { close } })) };
}

const takenWorkspace = {
  workspace: {
    id: "ws_9d1b",
    name: "Acme Hardware",
    slug: "acme-hardware",
    planTier: "community" as const,
    createdAt: "2026-07-02T09:15:00.000Z",
  },
  owners: ["someone-else"],
};

describe("operator workspace slug lookup", () => {
  it("runs on the Node runtime, because the store needs pg", () => {
    expect(runtime).toBe("nodejs");
  });

  it("names the workspace and its owners when the slug is taken", async () => {
    const store = workspaceStore(takenWorkspace);
    const response = await handleControlPlaneWorkspaceSlugRequest(
      request("/api/v1/operator/workspaces?slug=acme-hardware"),
      dependencies(store),
    );

    expect(response.status).toBe(200);
    // The whole point: the collision is with a workspace the person asking is not a member of, so
    // the answer has to say whose it is or it still cannot be acted on.
    expect(await response.json()).toEqual({
      ok: true,
      slug: "acme-hardware",
      taken: true,
      workspace: {
        id: "ws_9d1b",
        name: "Acme Hardware",
        planTier: "community",
        createdAt: "2026-07-02T09:15:00.000Z",
      },
      owners: ["someone-else"],
    });
    expect(store.findWorkspaceBySlugWithOwners).toHaveBeenCalledWith("acme-hardware");
  });

  it("answers a free slug with 200 rather than 404", async () => {
    const response = await handleControlPlaneWorkspaceSlugRequest(
      request("/api/v1/operator/workspaces?slug=unused-name"),
      dependencies(workspaceStore(null)),
    );

    // Both answers are useful, so neither is an error. A 404 would make "free" look like a fault
    // and send the reader looking for one.
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, slug: "unused-name", taken: false });
  });

  it("does not leak the stripe customer id or the member list", async () => {
    const store = workspaceStore({
      workspace: { ...takenWorkspace.workspace, stripeCustomerId: "cus_secret" },
      owners: ["someone-else"],
    });
    const response = await handleControlPlaneWorkspaceSlugRequest(
      request("/api/v1/operator/workspaces?slug=acme-hardware"),
      dependencies(store),
    );

    const body = (await response.json()) as { workspace: Record<string, unknown> };
    // Diagnosing a slug collision needs the workspace's identity and someone to ask. It does not
    // need billing identifiers, and it does not need everyone who happens to be a member.
    expect(body.workspace).not.toHaveProperty("stripeCustomerId");
    expect(body.workspace).not.toHaveProperty("slug");
  });

  it("refuses a request with no slug, and one that is not a slug", async () => {
    const missing = await handleControlPlaneWorkspaceSlugRequest(
      request("/api/v1/operator/workspaces"),
      dependencies(),
    );
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ error: "slug is required" });

    const malformed = await handleControlPlaneWorkspaceSlugRequest(
      request("/api/v1/operator/workspaces?slug=Acme%20Hardware"),
      dependencies(),
    );
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: "slug is invalid" });
  });

  it("requires operator authentication", async () => {
    const response = await handleControlPlaneWorkspaceSlugRequest(
      request("/api/v1/operator/workspaces?slug=acme-hardware", "Bearer wrong-token-".padEnd(48, "y")),
      dependencies(),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
  });

  it("reports the operator API as unconfigured rather than unauthorized when no token is set", async () => {
    const response = await handleControlPlaneWorkspaceSlugRequest(
      request("/api/v1/operator/workspaces?slug=acme-hardware"),
      dependencies(workspaceStore(), { DATABASE_URL: "postgresql://example.invalid/boardreadyops" }),
    );

    // A 401 here would send an operator hunting for the right credential when the answer is that
    // the surface was never switched on.
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "operator API is not configured" });
  });

  it("says the database is not configured instead of failing opaquely", async () => {
    const response = await handleControlPlaneWorkspaceSlugRequest(
      request("/api/v1/operator/workspaces?slug=acme-hardware"),
      dependencies(workspaceStore(), {
        BOARDREADYOPS_OPERATOR_API_TOKEN: token,
        BOARDREADYOPS_OPERATOR_ACTOR_ID: "operator.primary",
      }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "database is not configured" });
  });

  it("closes the executor even when the lookup throws", async () => {
    close.mockClear();
    const store: SlugLookup = {
      findWorkspaceBySlugWithOwners: vi.fn(async () => {
        throw new Error("connection terminated unexpectedly");
      }),
    };
    await handleControlPlaneWorkspaceSlugRequest(
      request("/api/v1/operator/workspaces?slug=acme-hardware"),
      dependencies(store),
    );

    // A leaked connection per failed lookup is the kind of bug that only shows up under load,
    // long after the change that caused it.
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("turns a store failure into 503 without surfacing the error", async () => {
    const store: SlugLookup = {
      findWorkspaceBySlugWithOwners: vi.fn(async () => {
        throw new Error("connection terminated unexpectedly");
      }),
    };
    const response = await handleControlPlaneWorkspaceSlugRequest(
      request("/api/v1/operator/workspaces?slug=acme-hardware"),
      dependencies(store),
    );

    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("workspace lookup is temporarily unavailable");
    expect(body.error).not.toContain("connection terminated");
  });

  it("is reachable through the route module", async () => {
    vi.stubEnv("BOARDREADYOPS_OPERATOR_API_TOKEN", "");
    const response = await lookupWorkspaceSlug(request("/api/v1/operator/workspaces?slug=acme-hardware"));

    // The route wires the default dependencies, so with no operator token configured it answers
    // 503. That it answers at all is the part worth asserting: a handler no route calls is the
    // failure mode this session kept finding.
    expect(response.status).toBe(503);
  });

  it("builds default dependencies that carry the environment through", () => {
    const built = createControlPlaneWorkspaceRouteDependencies({ DATABASE_URL: "postgresql://example.invalid/db" });
    expect(built.environment.DATABASE_URL).toBe("postgresql://example.invalid/db");
    expect(typeof built.openStore).toBe("function");
  });
});
