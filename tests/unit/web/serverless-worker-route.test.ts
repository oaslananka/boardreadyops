import { afterEach, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() =>
  vi.fn(async () => ({
    jobs: 1,
    outbox: 1,
    lifecycle: 0,
    workflow: 0,
    checkRun: 0,
  })),
);

vi.mock("../../../apps/web/lib/serverless-worker-production.js", () => ({
  runProductionBoundedPass: run,
}));

import { POST } from "../../../apps/web/app/api/internal/worker/route.js";

const keys = [
  "BOARDREADYOPS_BOUNDED_WORKER_ENABLED",
  "BOARDREADYOPS_BOUNDED_WORKER_SECRET",
  "BOARDREADYOPS_BOUNDED_WORKER_VERIFY_ONLY",
] as const;
const previous = new Map(keys.map((key) => [key, process.env[key]]));
const request = (token?: string) =>
  new Request("https://boardreadyops.test/api/internal/worker", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

afterEach(() => {
  for (const key of keys) {
    const value = previous.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  run.mockClear();
});

describe("private serverless worker endpoint", () => {
  it("remains disabled by default and does not touch durable queues", async () => {
    delete process.env.BOARDREADYOPS_BOUNDED_WORKER_ENABLED;
    process.env.BOARDREADYOPS_BOUNDED_WORKER_SECRET = "test-secret";
    const response = await POST(request("test-secret"));
    expect(response.status).toBe(404);
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects missing and incorrect tokens before touching the database", async () => {
    process.env.BOARDREADYOPS_BOUNDED_WORKER_ENABLED = "1";
    process.env.BOARDREADYOPS_BOUNDED_WORKER_SECRET = "test-secret";
    expect((await POST(request())).status).toBe(401);
    expect((await POST(request("wrong"))).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("fails closed if the private trigger token is not configured", async () => {
    process.env.BOARDREADYOPS_BOUNDED_WORKER_ENABLED = "1";
    delete process.env.BOARDREADYOPS_BOUNDED_WORKER_SECRET;
    expect((await POST(request())).status).toBe(503);
    expect(run).not.toHaveBeenCalled();
  });

  it("authenticates a verify-only pass without claiming or mutating any queues", async () => {
    process.env.BOARDREADYOPS_BOUNDED_WORKER_ENABLED = "1";
    process.env.BOARDREADYOPS_BOUNDED_WORKER_SECRET = "test-secret";
    process.env.BOARDREADYOPS_BOUNDED_WORKER_VERIFY_ONLY = "1";

    expect((await POST(request("wrong"))).status).toBe(401);
    expect(run).not.toHaveBeenCalled();

    const response = await POST(request("test-secret"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, mode: "verify-only" });
    expect(run).not.toHaveBeenCalled();
  });

  it("processes a bounded pass only with the exact private token and does not return secrets", async () => {
    process.env.BOARDREADYOPS_BOUNDED_WORKER_ENABLED = "1";
    process.env.BOARDREADYOPS_BOUNDED_WORKER_SECRET = "test-secret";
    const response = await POST(request("test-secret"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ ok: true, claimed: { jobs: 1, outbox: 1 } });
    expect(run).toHaveBeenCalledOnce();
  });

  it("does not return raw errors or claim success when the worker fails", async () => {
    process.env.BOARDREADYOPS_BOUNDED_WORKER_ENABLED = "1";
    process.env.BOARDREADYOPS_BOUNDED_WORKER_SECRET = "test-secret";
    run.mockRejectedValueOnce(new Error("leaked-secret-placeholder"));
    const response = await POST(request("test-secret"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("leaked-secret-placeholder");
  });
});
