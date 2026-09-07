import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE as deletePolicy, PATCH as patchPolicy } from "../../../apps/web/app/api/v1/policies/[id]/route.js";
import { POST as createPolicy, GET as listPolicies } from "../../../apps/web/app/api/v1/policies/route.js";
import * as cloudConfig from "../../../apps/web/lib/cloud-runtime-config.js";
import * as viewerAuth from "../../../apps/web/lib/viewer-authorization.js";

/**
 * These four handlers each guard on persistence before touching the database. The guard is the
 * whole point: they used to call the *throwing* resolver first, so an authenticated request on a
 * deployment with no `DATABASE_URL` got a 500 instead of the 503 they intended, and the route
 * audit reported it as a P0 on `/policies`.
 *
 * A 500 and a 503 are read very differently — by an operator mid-provisioning, by a load
 * balancer, and by the audit — so the distinction is pinned here rather than left to the page
 * test, which only covers the server component.
 */

const mockClose = vi.fn();

vi.mock("../../../packages/db/src/pg-executor.js", () => ({
  createPgQueryExecutor: vi.fn(() => ({ query: vi.fn().mockResolvedValue({ rows: [] }), close: mockClose })),
}));

function signedIn() {
  vi.spyOn(viewerAuth, "viewerAuthorization").mockResolvedValue({
    session: {
      userId: 1,
      login: "octocat",
      installationIds: [1],
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    },
  } as Awaited<ReturnType<typeof viewerAuth.viewerAuthorization>>);
}

function signedOut() {
  vi.spyOn(viewerAuth, "viewerAuthorization").mockResolvedValue(
    {} as Awaited<ReturnType<typeof viewerAuth.viewerAuthorization>>,
  );
}

/** What an operator who has not provisioned Postgres yet actually has. */
function withoutDatabase() {
  vi.spyOn(cloudConfig, "optionalCloudPersistenceConfiguration").mockReturnValue(undefined);
}

const policyRequest = (body: unknown) =>
  new Request("https://boardreadyops.test/api/v1/policies", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const params = { params: Promise.resolve({ id: "pol_1" }) };

describe("/api/v1/policies without a database", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockClose.mockReset();
  });

  it("answers 503 rather than 500 on GET", async () => {
    signedIn();
    withoutDatabase();

    const response = await listPolicies();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "Database not configured" });
  });

  it("answers 503 on POST, after the payload has already been validated", async () => {
    signedIn();
    withoutDatabase();

    const response = await createPolicy(policyRequest({ scope: "organization", name: "Release gate" }));
    expect(response.status).toBe(503);
  });

  it("answers 503 on PATCH", async () => {
    signedIn();
    withoutDatabase();

    const response = await patchPolicy(
      new Request("https://boardreadyops.test/api/v1/policies/pol_1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Renamed" }),
      }),
      params,
    );
    expect(response.status).toBe(503);
  });

  it("answers 503 on DELETE", async () => {
    signedIn();
    withoutDatabase();

    const response = await deletePolicy(new Request("https://boardreadyops.test/api/v1/policies/pol_1"), params);
    expect(response.status).toBe(503);
  });

  it("never opens a connection it cannot use", async () => {
    signedIn();
    withoutDatabase();

    await listPolicies();
    expect(mockClose).not.toHaveBeenCalled();
  });
});

describe("/api/v1/policies request validation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockClose.mockReset();
  });

  it("requires a session before anything else", async () => {
    signedOut();
    const persistence = vi.spyOn(cloudConfig, "optionalCloudPersistenceConfiguration");

    expect((await listPolicies()).status).toBe(401);
    // Authentication is checked first, so an anonymous caller cannot probe whether this
    // deployment has a database.
    expect(persistence).not.toHaveBeenCalled();
  });

  it("rejects a malformed body before reaching persistence", async () => {
    signedIn();
    const persistence = vi.spyOn(cloudConfig, "optionalCloudPersistenceConfiguration");

    const response = await createPolicy(
      new Request("https://boardreadyops.test/api/v1/policies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{ not json",
      }),
    );

    expect(response.status).toBe(400);
    expect(persistence).not.toHaveBeenCalled();
  });

  it("holds team and repository policies to naming the scope they apply to", async () => {
    signedIn();
    withoutDatabase();

    const response = await createPolicy(policyRequest({ scope: "repository", name: "Repo gate" }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "scopeId is required for team/repository scope",
    });
  });

  it("accepts an organization policy without a scopeId", async () => {
    signedIn();
    withoutDatabase();

    // Reaching the persistence guard is the proof it passed validation: organization scope is the
    // one case where an absent scopeId is correct rather than a 400.
    const response = await createPolicy(policyRequest({ scope: "organization", name: "Org gate" }));
    expect(response.status).toBe(503);
  });
});
