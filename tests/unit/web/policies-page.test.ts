import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE as deletePolicy } from "../../../apps/web/app/api/v1/policies/[id]/route.js";
import { POST as createPolicy, GET as getPolicies } from "../../../apps/web/app/api/v1/policies/route.js";
import PoliciesPage from "../../../apps/web/app/policies/page.js";
import PoliciesClient from "../../../apps/web/app/policies/policies-client.js";
import * as cloudConfig from "../../../apps/web/lib/cloud-runtime-config.js";
import * as viewerAuth from "../../../apps/web/lib/viewer-authorization.js";
import { ReviewPolicyStore } from "../../../packages/db/src/review-policy-store.js";

const mockPolicyDbQuery = vi.fn();
const mockPolicyDbClose = vi.fn();

vi.mock("@boardreadyops/db/pg-executor", () => ({
  createPgQueryExecutor: vi.fn(() => ({
    query: mockPolicyDbQuery,
    close: mockPolicyDbClose,
  })),
}));

vi.mock("../../../packages/db/src/pg-executor.js", () => ({
  createPgQueryExecutor: vi.fn(() => ({
    query: mockPolicyDbQuery,
    close: mockPolicyDbClose,
  })),
}));

function createMockPolicyExecutor(initialPolicies: Record<string, unknown>[] = []) {
  const queries: { sql: string; params: unknown[] }[] = [];
  const policies = [...initialPolicies];

  return {
    queries,
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      const norm = sql.toLowerCase().replace(/\s+/g, " ");

      if (norm.includes("from review_policies where tenant_id = $1")) {
        return { rows: policies };
      }

      if (norm.includes("from review_policies where id = $1")) {
        const found = policies.find((p) => p.id === params[0]);
        return { rows: found ? [found] : [] };
      }

      if (norm.includes("insert into review_policies")) {
        const record = {
          id: params[0] as string,
          tenantId: params[1] as string,
          scope: params[2] as string,
          scopeId: params[3] as string | null,
          name: params[4] as string,
          description: params[5] as string | null,
          requiredChecklist: JSON.parse((params[6] as string) || "[]"),
          requiredRoles: JSON.parse((params[7] as string) || "[]"),
          severityGate: params[8] as string | null,
          requireEvidencePack: params[9] as boolean,
          requireExternalReview: params[10] as boolean,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        policies.unshift(record);
        return { rows: [record] };
      }

      if (norm.includes("delete from review_policies where id = $1")) {
        const idx = policies.findIndex((p) => p.id === params[0]);
        if (idx >= 0) policies.splice(idx, 1);
        return { rows: [{ id: params[0] }] };
      }

      return { rows: [] };
    }),
    close: vi.fn(async () => {}),
  };
}

describe("Organization Policies Page & Server-Authoritative Management", () => {
  beforeEach(() => {
    mockPolicyDbQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.toLowerCase().replace(/\s+/g, " ");
      if (norm.includes("from review_policies where tenant_id = $1")) {
        return { rows: [] };
      }
      if (norm.includes("from review_policies where id = $1")) {
        return {
          rows: [
            {
              id: params[0],
              tenantId: "acme-corp",
              scope: "organization",
              scopeId: null,
              name: "Old Policy",
              description: null,
              requiredChecklist: [],
              requiredRoles: [],
              severityGate: null,
              requireEvidencePack: false,
              requireExternalReview: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        };
      }
      if (norm.includes("insert into review_policies")) {
        return {
          rows: [
            {
              id: params[0],
              tenantId: params[1],
              scope: params[2],
              scopeId: params[3],
              name: params[4],
              description: params[5],
              requiredChecklist: JSON.parse((params[6] as string) || "[]"),
              requiredRoles: JSON.parse((params[7] as string) || "[]"),
              severityGate: params[8],
              requireEvidencePack: params[9],
              requireExternalReview: params[10],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        };
      }
      if (norm.includes("delete from review_policies where id = $1")) {
        return { rows: [{ id: params[0] }] };
      }
      return { rows: [] };
    });
  });

  it("renders PoliciesPage with breadcrumbs, title, and governance frame", () => {
    const markup = renderToStaticMarkup(createElement(PoliciesPage));
    expect(markup).toContain("Organization Governance &amp; Release Policies");
    expect(markup).toContain("policies-page-frame");
    expect(markup).toContain("Policies");
  });

  it("renders PoliciesClient with hierarchy diagram, metrics toolbar, and action CTA", () => {
    const markup = renderToStaticMarkup(createElement(PoliciesClient));
    expect(markup).toContain("Policy Hierarchy &amp; Scope Resolution");
    expect(markup).toContain("Default baseline");
    expect(markup).toContain("Default open review");
    expect(markup).toContain("+ New Governance Policy");
  });

  it("GET /api/v1/policies returns list of tenant policies", async () => {
    vi.spyOn(viewerAuth, "viewerAuthorization").mockResolvedValue({
      status: "authenticated",
      session: {
        login: "acme-corp",
        name: "Acme Lead",
        email: "lead@acme.com",
        avatarUrl: "https://github.com/acme.png",
      },
    } as viewerAuth.ViewerAuthorizationResult);

    vi.spyOn(cloudConfig, "resolveCloudPersistenceConfiguration").mockReturnValue({
      mode: "postgres",
      databaseUrl: "postgresql://postgres:postgres@localhost:5432/boardreadyops",
    });

    const res = await getPolicies();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; policies: unknown[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.policies)).toBe(true);
  });

  it("POST /api/v1/policies creates a new policy authoritatively", async () => {
    vi.spyOn(viewerAuth, "viewerAuthorization").mockResolvedValue({
      status: "authenticated",
      session: {
        login: "acme-corp",
        name: "Acme Lead",
        email: "lead@acme.com",
        avatarUrl: "https://github.com/acme.png",
      },
    } as viewerAuth.ViewerAuthorizationResult);

    vi.spyOn(cloudConfig, "resolveCloudPersistenceConfiguration").mockReturnValue({
      mode: "postgres",
      databaseUrl: "postgresql://postgres:postgres@localhost:5432/boardreadyops",
    });

    const req = new Request("http://localhost/api/v1/policies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: "organization",
        name: "Production Pre-Fab Clearance Gate",
        description: "Zero errors on high-voltage power layers.",
        requiredChecklist: ["DFM Review Confirmed", "Thermal vias count verified"],
        requiredRoles: ["hardware-lead"],
        severityGate: "error",
        requireEvidencePack: true,
        requireExternalReview: false,
      }),
    });

    const res = await createPolicy(req);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; policy: { name: string } };
    expect(body.ok).toBe(true);
    expect(body.policy.name).toBe("Production Pre-Fab Clearance Gate");
  });

  it("ReviewPolicyStore creates and retrieves policies persistently", async () => {
    const executor = createMockPolicyExecutor();
    const store = new ReviewPolicyStore(executor);

    const created = await store.createPolicy({
      tenantId: "acme-corp",
      scope: "organization",
      scopeId: null,
      name: "High-Voltage Sign-Off Policy",
      description: "Mandatory isolation and creepage checks",
      requiredChecklist: ["Creepage >= 2.5mm", "Clearance >= 1.5mm"],
      requiredRoles: ["hardware-lead"],
      severityGate: "error",
      requireEvidencePack: true,
      requireExternalReview: false,
    });

    expect(created.id).toBeDefined();
    expect(created.name).toBe("High-Voltage Sign-Off Policy");

    const list = await store.listPolicies("acme-corp");
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(created.id);
  });

  it("DELETE /api/v1/policies/[id] deletes policy authoritatively", async () => {
    vi.spyOn(viewerAuth, "viewerAuthorization").mockResolvedValue({
      status: "authenticated",
      session: {
        login: "acme-corp",
        name: "Acme Lead",
        email: "lead@acme.com",
        avatarUrl: "https://github.com/acme.png",
      },
    } as viewerAuth.ViewerAuthorizationResult);

    vi.spyOn(cloudConfig, "resolveCloudPersistenceConfiguration").mockReturnValue({
      mode: "postgres",
      databaseUrl: "postgresql://postgres:postgres@localhost:5432/boardreadyops",
    });

    const params = Promise.resolve({ id: "pol_test_delete" });
    const req = new Request("http://localhost/api/v1/policies/pol_test_delete", {
      method: "DELETE",
    });

    const res = await deletePolicy(req, { params });
    expect(res.status).toBe(200);
  });
});
