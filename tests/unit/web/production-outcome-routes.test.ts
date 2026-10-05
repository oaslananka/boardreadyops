import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedApiContext, RepositoryApiContext } from "../../../apps/web/lib/api-auth.js";
import {
  handleProductionOutcomeImport,
  type ProductionOutcomeImportDependencies,
} from "../../../apps/web/lib/production-outcome-routes.js";
import type { ProductionOutcomeStore } from "../../../packages/db/src/production-outcome-store.js";

const auth: AuthenticatedApiContext = {
  ok: true,
  repositoryId: "repo-1",
  actorId: "token-1",
  scopes: ["runs:write"],
  authType: "bearer_token",
};

const csv = [
  "batch_id,manufacturer,manufactured_on,quantity,first_pass_yield,rework_count,scrap_count,defect_kind,defect_code,defect_count,notes,corrective_action",
  "LOT-7,Acme EMS,2026-10-01,100,97.25%,2,1,aoi,BRIDGE,3,First production lot,Adjust stencil",
  "LOT-7,Acme EMS,2026-10-01,100,97.25%,2,1,functional_test,NO_BOOT,1,First production lot,Adjust stencil",
].join("\n");

const jsonBatch = JSON.stringify({
  externalBatchId: "LOT-JSON-7",
  manufacturer: "Acme EMS",
  manufacturedOn: "2026-10-03",
  quantity: 80,
  firstPassYieldBps: 9875,
  reworkCount: 1,
  scrapCount: 0,
  defects: [{ category: "aoi", code: "BRIDGE", count: 2 }],
});

type HarnessOptions = {
  authResult?: Awaited<ReturnType<ProductionOutcomeImportDependencies["authenticate"]>>;
  resolveResult?: RepositoryApiContext | Response;
  installationRows?: readonly Record<string, unknown>[];
  imported?: { id: string; created: boolean };
  importError?: Error;
};

function harness(options: HarnessOptions = {}) {
  const query = vi.fn().mockResolvedValue({ rows: options.installationRows ?? [{ installation_id: "inst-1" }] });
  const close = vi.fn().mockResolvedValue(undefined);
  const executor = { query, close } as RepositoryApiContext["executor"];
  const importBatch = options.importError
    ? vi.fn().mockRejectedValue(options.importError)
    : vi.fn().mockResolvedValue(options.imported ?? { id: "batch-row-1", created: true });
  const store: ProductionOutcomeStore = { importBatch };

  const authenticate = vi.fn().mockResolvedValue(options.authResult ?? auth);
  const resolveRepository = vi
    .fn()
    .mockResolvedValue(options.resolveResult ?? ({ repositoryId: "repo-1", executor } satisfies RepositoryApiContext));
  const createStore = vi.fn(() => store);

  const dependencies: ProductionOutcomeImportDependencies = {
    authenticate,
    resolveRepository,
    createStore,
  };

  return { dependencies, authenticate, resolveRepository, createStore, importBatch, query, close, executor };
}

function request(body = csv, init: { contentType?: string; url?: string; contentLength?: string } = {}): Request {
  return new Request(
    init.url ??
      "https://boardreadyops.test/api/v1/runs/run-1/production-outcomes?repositoryId=repo-1&sourceName=lot-7.csv",
    {
      method: "POST",
      headers: {
        "content-type": init.contentType ?? "text/csv; charset=utf-8",
        ...(init.contentLength ? { "content-length": init.contentLength } : {}),
      },
      body,
    },
  );
}

describe("production outcome CSV import route", () => {
  it("requires runs:write authentication before resolving repository scope", async () => {
    const h = harness({ authResult: { ok: false, error: "Authentication required", status: 401 } });

    const response = await handleProductionOutcomeImport(request(), "run-1", h.dependencies);

    expect(response.status).toBe(401);
    expect(h.authenticate).toHaveBeenCalledWith(expect.any(Request), "runs:write");
    expect(h.resolveRepository).not.toHaveBeenCalled();
  });

  it("rejects unsupported media types before opening repository scope", async () => {
    const h = harness();

    const response = await handleProductionOutcomeImport(
      request("{}", { contentType: "application/xml" }),
      "run-1",
      h.dependencies,
    );

    expect(response.status).toBe(415);
    expect(h.resolveRepository).not.toHaveBeenCalled();
  });

  it("imports one JSON API batch with exact-body provenance", async () => {
    const h = harness();
    const req = request(jsonBatch, {
      contentType: "application/json; charset=utf-8",
      url: "https://boardreadyops.test/api/v1/runs/run-1/production-outcomes?repositoryId=repo-1&sourceName=partner-api",
    });

    const response = await handleProductionOutcomeImport(req, "run-1", h.dependencies);

    expect(response.status).toBe(201);
    expect(h.importBatch).toHaveBeenCalledWith({
      installationId: "inst-1",
      releaseRunId: "run-1",
      sourceKind: "api",
      sourceName: "partner-api",
      sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      batch: {
        externalBatchId: "LOT-JSON-7",
        manufacturer: "Acme EMS",
        manufacturedOn: "2026-10-03",
        quantity: 80,
        firstPassYieldBps: 9875,
        reworkCount: 1,
        scrapCount: 0,
        defects: [{ category: "aoi", code: "BRIDGE", count: 2 }],
      },
    });
    const expectedDigest = createHash("sha256").update(jsonBatch, "utf8").digest("hex");
    await expect(response.json()).resolves.toMatchObject({ sourceSha256: expectedDigest, releaseRunId: "run-1" });
    expect(h.close).toHaveBeenCalledOnce();
  });

  it("returns a bounded specific JSON date validation error", async () => {
    const h = harness();
    const body = JSON.stringify({
      externalBatchId: "LOT-BAD-DATE",
      manufacturer: "Acme",
      manufacturedOn: "2026-02-30",
      quantity: 1,
    });

    const response = await handleProductionOutcomeImport(
      request(body, { contentType: "application/json" }),
      "run-1",
      h.dependencies,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Production outcome JSON manufacturedOn must be a real calendar date",
    });
    expect(h.importBatch).not.toHaveBeenCalled();
    expect(h.close).toHaveBeenCalledOnce();
  });

  it("fails closed on malformed or unsupported JSON fields", async () => {
    for (const body of [
      "{",
      JSON.stringify({
        externalBatchId: "LOT-1",
        manufacturer: "Acme",
        manufacturedOn: "2026-10-03",
        quantity: 1,
        internalTrace: "do-not-store",
      }),
    ]) {
      const h = harness();
      const response = await handleProductionOutcomeImport(
        request(body, { contentType: "application/json" }),
        "run-1",
        h.dependencies,
      );

      expect(response.status).toBe(400);
      const payload = JSON.stringify(await response.json());
      expect(payload).toContain("Production outcome JSON");
      expect(payload).not.toContain("do-not-store");
      expect(h.importBatch).not.toHaveBeenCalled();
      expect(h.close).toHaveBeenCalledOnce();
    }
  });

  it("honors the central repository authorization boundary", async () => {
    const forbidden = Response.json({ ok: false, error: "Forbidden repository scope" }, { status: 403 });
    const h = harness({ resolveResult: forbidden });

    const req = request();
    const response = await handleProductionOutcomeImport(req, "run-1", h.dependencies);

    expect(response.status).toBe(403);
    expect(h.resolveRepository).toHaveBeenCalledWith(auth, req);
    expect(h.createStore).not.toHaveBeenCalled();
  });

  it("requires the release run to belong to the authorized repository", async () => {
    const h = harness({ installationRows: [] });

    const response = await handleProductionOutcomeImport(request(), "run-other", h.dependencies);

    expect(response.status).toBe(404);
    expect(h.query).toHaveBeenCalledWith(expect.stringContaining("release_runs.id = $1"), ["run-other", "repo-1"]);
    expect(String(h.query.mock.calls[0]?.[0])).toContain("repositories.id = $2");
    expect(h.importBatch).not.toHaveBeenCalled();
    expect(h.close).toHaveBeenCalledOnce();
  });

  it("rejects oversized uploads without parsing or importing them", async () => {
    const h = harness();

    const response = await handleProductionOutcomeImport(
      request("x", { contentLength: String(2 * 1024 * 1024 + 1) }),
      "run-1",
      h.dependencies,
    );

    expect(response.status).toBe(413);
    expect(h.importBatch).not.toHaveBeenCalled();
    expect(h.close).toHaveBeenCalledOnce();
  });

  it("returns bounded validation errors for malformed CSV", async () => {
    const h = harness();

    const response = await handleProductionOutcomeImport(
      request("batch_id,manufacturer,quantity\nLOT-1,Acme,10"),
      "run-1",
      h.dependencies,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'Production outcome CSV is missing required header "manufactured_on"',
    });
    expect(h.importBatch).not.toHaveBeenCalled();
    expect(h.close).toHaveBeenCalledOnce();
  });

  it("rejects multi-batch CSV instead of partially importing the document", async () => {
    const h = harness();
    const multiple = [
      "batch_id,manufacturer,manufactured_on,quantity",
      "LOT-1,Acme,2026-10-01,10",
      "LOT-2,Acme,2026-10-02,10",
    ].join("\n");

    const response = await handleProductionOutcomeImport(request(multiple), "run-1", h.dependencies);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "CSV import currently accepts exactly one production batch per request",
    });
    expect(h.importBatch).not.toHaveBeenCalled();
    expect(h.close).toHaveBeenCalledOnce();
  });

  it("imports one parsed batch with provenance and returns 201 for a new record", async () => {
    const h = harness();

    const response = await handleProductionOutcomeImport(request(), "run-1", h.dependencies);

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: true,
      batchId: "batch-row-1",
      created: true,
      releaseRunId: "run-1",
      sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(h.importBatch).toHaveBeenCalledWith({
      installationId: "inst-1",
      releaseRunId: "run-1",
      sourceKind: "csv",
      sourceName: "lot-7.csv",
      sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      batch: expect.objectContaining({
        externalBatchId: "LOT-7",
        manufacturer: "Acme EMS",
        quantity: 100,
        firstPassYieldBps: 9725,
        reworkCount: 2,
        scrapCount: 1,
        defects: [
          expect.objectContaining({ category: "aoi", code: "BRIDGE", count: 3 }),
          expect.objectContaining({ category: "functional_test", code: "NO_BOOT", count: 1 }),
        ],
      }),
    });
    expect(h.close).toHaveBeenCalledOnce();
  });

  it("returns 200 when the immutable batch import is replayed", async () => {
    const h = harness({ imported: { id: "batch-row-1", created: false } });

    const response = await handleProductionOutcomeImport(request(), "run-1", h.dependencies);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, created: false, batchId: "batch-row-1" });
    expect(h.close).toHaveBeenCalledOnce();
  });

  it("does not echo store/database details when an immutable batch conflicts", async () => {
    const h = harness({ importError: new Error("duplicate key on private_production_batch_index") });

    const response = await handleProductionOutcomeImport(request(), "run-1", h.dependencies);

    expect(response.status).toBe(409);
    const payload = JSON.stringify(await response.json());
    expect(payload).toContain("Production batch conflicts with existing release evidence");
    expect(payload).not.toContain("private_production_batch_index");
    expect(h.close).toHaveBeenCalledOnce();
  });

  it("rejects oversized source names before repository resolution", async () => {
    const h = harness();
    const url = `https://boardreadyops.test/api/v1/runs/run-1/production-outcomes?repositoryId=repo-1&sourceName=${"x".repeat(256)}`;

    const response = await handleProductionOutcomeImport(request(csv, { url }), "run-1", h.dependencies);

    expect(response.status).toBe(400);
    expect(h.resolveRepository).not.toHaveBeenCalled();
  });
});
