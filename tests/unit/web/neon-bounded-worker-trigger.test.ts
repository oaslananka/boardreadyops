import { afterEach, describe, expect, it, vi } from "vitest";
import workerTrigger from "../../../infra/neon/functions/brdrain/index.js";

const env = ["BOARDREADYOPS_WORKER_ENDPOINT", "BOARDREADYOPS_BOUNDED_WORKER_SECRET"] as const;
const previous = new Map(env.map((key) => [key, process.env[key]]));
const validBody = JSON.stringify({
  version: 1,
  invocation_id: "test-invocation-1",
  trigger: { type: "schedule", id: "trigger-test-1", name: "brdrain" },
  data: { scheduled_at: "2026-11-15T14:00:00Z" },
});
const call = (signed = true, body = validBody) =>
  new Request("https://brdrain.functions.neon.tech/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(signed ? { "x-neon-trigger-invocation-id": "test-invocation-1" } : {}),
    },
    body,
  });

afterEach(() => {
  for (const name of env) {
    const value = previous.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.unstubAllGlobals();
});

describe("Neon bounded-worker scheduled trigger", () => {
  it("rejects requests without an actual trigger invocation marker and never calls Vercel", async () => {
    process.env.BOARDREADYOPS_WORKER_ENDPOINT = "https://project-eubao.vercel.app/api/internal/worker";
    process.env.BOARDREADYOPS_BOUNDED_WORKER_SECRET = "private-worker-secret";
    const mocked = vi.fn();
    vi.stubGlobal("fetch", mocked);
    const response = await workerTrigger.fetch(call(false));
    expect(response.status).toBe(403);
    expect(mocked).not.toHaveBeenCalled();
  });

  it("rejects malformed schedules and unsupported targets before sending the private token", async () => {
    process.env.BOARDREADYOPS_WORKER_ENDPOINT = "http://127.0.0.1/api/internal/worker";
    process.env.BOARDREADYOPS_BOUNDED_WORKER_SECRET = "private-worker-secret";
    const mocked = vi.fn();
    vi.stubGlobal("fetch", mocked);
    expect((await workerTrigger.fetch(call(true))).status).toBe(503);
    process.env.BOARDREADYOPS_WORKER_ENDPOINT = "https://project-eubao.vercel.app/api/internal/worker";
    expect((await workerTrigger.fetch(call(true, "{}"))).status).toBe(400);
    expect(mocked).not.toHaveBeenCalled();
  });

  it("rejects a forged or mismatched trigger correlation id", async () => {
    process.env.BOARDREADYOPS_WORKER_ENDPOINT = "https://project-eubao.vercel.app/api/internal/worker";
    process.env.BOARDREADYOPS_BOUNDED_WORKER_SECRET = "private-worker-secret";
    const mocked = vi.fn();
    vi.stubGlobal("fetch", mocked);
    const body = JSON.stringify({
      version: 1,
      invocation_id: "different-invocation",
      trigger: { type: "schedule", id: "trigger-test-1", name: "brdrain" },
      data: { scheduled_at: "2026-11-15T14:00:00Z" },
    });
    expect((await workerTrigger.fetch(call(true, body))).status).toBe(403);
    expect(mocked).not.toHaveBeenCalled();
  });

  it("rejects invalid or unbounded timestamps without dispatching a worker", async () => {
    process.env.BOARDREADYOPS_WORKER_ENDPOINT = "https://project-eubao.vercel.app/api/internal/worker";
    process.env.BOARDREADYOPS_BOUNDED_WORKER_SECRET = "private-worker-secret";
    const mocked = vi.fn();
    vi.stubGlobal("fetch", mocked);
    for (const scheduledAt of [
      "2026-11-15T14:00:00.1234Z",
      "2026-11-15T14:00:00Z".repeat(300),
      "2026-11-15 14:00:00Z",
      "2026-11-15T14:00:00+00:00",
      "2026-11-15T99:99:99Z",
    ]) {
      const body = JSON.stringify({
        version: 1,
        invocation_id: "test-invocation-1",
        trigger: { type: "schedule" },
        data: { scheduled_at: scheduledAt },
      });
      expect((await workerTrigger.fetch(call(true, body))).status).toBe(400);
    }
    expect(mocked).not.toHaveBeenCalled();
  });

  it("accepts bounded UTC timestamps with one to three fractional digits", async () => {
    process.env.BOARDREADYOPS_WORKER_ENDPOINT = "https://project-eubao.vercel.app/api/internal/worker";
    process.env.BOARDREADYOPS_BOUNDED_WORKER_SECRET = "private-worker-secret";
    const mocked = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", mocked);
    for (const scheduledAt of ["2026-11-15T14:00:00.1Z", "2026-11-15T14:00:00.123Z"]) {
      const body = JSON.stringify({
        version: 1,
        invocation_id: "test-invocation-1",
        trigger: { type: "schedule" },
        data: { scheduled_at: scheduledAt },
      });
      expect((await workerTrigger.fetch(call(true, body))).status).toBe(200);
    }
    expect(mocked).toHaveBeenCalledTimes(2);
  });

  it("passes the private token directly to the bounded endpoint on a valid schedule", async () => {
    process.env.BOARDREADYOPS_WORKER_ENDPOINT = "https://project-eubao.vercel.app/api/internal/worker";
    process.env.BOARDREADYOPS_BOUNDED_WORKER_SECRET = "private-worker-secret";
    const mocked = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal("fetch", mocked);
    const response = await workerTrigger.fetch(call());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
    expect(mocked).toHaveBeenCalledOnce();
    const [url, init] = mocked.mock.calls[0] ?? [];
    expect(url).toBe("https://project-eubao.vercel.app/api/internal/worker");
    expect(init).toMatchObject({
      method: "POST",
      headers: { authorization: "Bearer private-worker-secret" },
    });
  });

  it("does not treat an unavailable Vercel worker as successful", async () => {
    process.env.BOARDREADYOPS_WORKER_ENDPOINT = "https://project-eubao.vercel.app/api/internal/worker";
    process.env.BOARDREADYOPS_BOUNDED_WORKER_SECRET = "private-worker-secret";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("server failure", { status: 503 })),
    );
    const response = await workerTrigger.fetch(call());
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("server failure");
  });
});
