import { afterEach, describe, expect, it, vi } from "vitest";

const work = vi.hoisted(() =>
  vi.fn(async () => ({
    jobs: 2,
    outbox: 0,
    lifecycle: 0,
    workflow: 0,
    checkRun: 0,
  })),
);

vi.mock("../../../apps/web/lib/serverless-worker-production.js", () => ({
  runProductionBoundedPass: work,
}));

import { GET } from "../../../apps/web/app/api/internal/worker-recovery/route.js";

const keys = [
  "CRON_SECRET",
  "BOARDREADYOPS_BOUNDED_WORKER_ENABLED",
  "BOARDREADYOPS_BOUNDED_WORKER_VERIFY_ONLY",
] as const;
const previous = new Map(keys.map((key) => [key, process.env[key]]));
const call = (secret?: string) =>
  new Request("https://boardreadyops.com/api/internal/worker-recovery", {
    headers: secret === undefined ? {} : { authorization: `Bearer ${secret}` },
  });

afterEach(() => {
  for (const key of keys) {
    const value = previous.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  work.mockReset();
  work.mockResolvedValue({ jobs: 2, outbox: 0, lifecycle: 0, workflow: 0, checkRun: 0 });
});

describe("Vercel cron bounded recovery", () => {
  it("never starts when the worker is disabled or in verification-only mode", async () => {
    process.env.CRON_SECRET = "recovery-key";
    process.env.BOARDREADYOPS_BOUNDED_WORKER_ENABLED = "0";
    expect((await GET(call("recovery-key"))).status).toBe(404);
    process.env.BOARDREADYOPS_BOUNDED_WORKER_ENABLED = "1";
    process.env.BOARDREADYOPS_BOUNDED_WORKER_VERIFY_ONLY = "1";
    expect((await GET(call("recovery-key"))).status).toBe(404);
    expect(work).not.toHaveBeenCalled();
  });

  it("fails closed with no configured cron token", async () => {
    process.env.BOARDREADYOPS_BOUNDED_WORKER_ENABLED = "1";
    delete process.env.CRON_SECRET;
    expect((await GET(call())).status).toBe(503);
    expect(work).not.toHaveBeenCalled();
  });

  it("rejects an absent, incorrect, or empty token before touching durable state", async () => {
    process.env.BOARDREADYOPS_BOUNDED_WORKER_ENABLED = "1";
    process.env.CRON_SECRET = "recovery-key";
    expect((await GET(call())).status).toBe(401);
    expect((await GET(call("not-the-key"))).status).toBe(401);
    expect((await GET(call(""))).status).toBe(401);
    expect(work).not.toHaveBeenCalled();
  });

  it("only runs a single canonical bounded pass when authorized", async () => {
    process.env.BOARDREADYOPS_BOUNDED_WORKER_ENABLED = "1";
    process.env.CRON_SECRET = "recovery-key";
    const response = await GET(call("recovery-key"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      ok: true,
      claimed: { jobs: 2, outbox: 0, lifecycle: 0, workflow: 0, checkRun: 0 },
    });
    expect(work).toHaveBeenCalledOnce();
  });

  it("does not leak worker errors or claim success on failure", async () => {
    process.env.BOARDREADYOPS_BOUNDED_WORKER_ENABLED = "1";
    process.env.CRON_SECRET = "recovery-key";
    work.mockRejectedValueOnce(new Error("private-provider-detail"));
    const response = await GET(call("recovery-key"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: "worker_unavailable" });
    expect(work).toHaveBeenCalledOnce();
  });
});
