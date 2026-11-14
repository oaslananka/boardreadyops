import { describe, expect, it, vi } from "vitest";
import { createNeonScheduledWorkerHandler } from "../../../apps/web/lib/neon-scheduled-worker-handler.js";

const invocationId = "abc123FUPHOw0Pl1ZooidgpJhvHaShi1aX40cQ0b321";
const triggerId = "trigger-1a2b3c4d-5e6f-7890-abcd-ef1234567890";
const event = {
  version: 1,
  invocation_id: invocationId,
  trigger: { type: "schedule", id: triggerId, name: "control-plane-recovery" },
  data: { scheduled_at: "2026-11-14T17:00:00Z" },
  previous_attempts: [],
  previous_attempts_omitted: 0,
};

function request(input?: {
  method?: string;
  header?: string | null;
  path?: string;
  body?: unknown;
  contentType?: string;
}): Request {
  const method = input?.method ?? "POST";
  return new Request(`https://example.neon.tech${input?.path ?? "/"}`, {
    method,
    ...(method !== "GET" ? { body: JSON.stringify(input?.body ?? event) } : {}),
    headers: {
      "content-type": input?.contentType ?? "application/json",
      ...(input?.header !== null ? { "x-neon-trigger-invocation-id": input?.header ?? invocationId } : {}),
    },
  });
}

function handler(runOnce = vi.fn(async () => undefined)) {
  return { fetch: createNeonScheduledWorkerHandler({ triggerId, runOnce }), runOnce };
}

describe("Neon scheduled worker request admission", () => {
  it("accepts a matching schedule event and runs exactly one bounded pass", async () => {
    const { fetch, runOnce } = handler();
    const res = await fetch(request());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true });
    expect(runOnce).toHaveBeenCalledTimes(1);
  });

  it("rejects external calls, unexpected methods and paths before invoking work", async () => {
    const { fetch, runOnce } = handler();
    expect((await fetch(request({ header: null }))).status).toBe(401);
    expect((await fetch(request({ method: "GET" }))).status).toBe(405);
    expect((await fetch(request({ path: "/elsewhere" }))).status).toBe(404);
    expect((await fetch(request({ path: "/?x=1" }))).status).toBe(404);
    expect(runOnce).not.toHaveBeenCalled();
  });

  it("checks the configured trigger ID, type, and matching invocation ID", async () => {
    const { fetch, runOnce } = handler();
    expect((await fetch(request({ header: "another-id" }))).status).toBe(400);
    expect(
      (await fetch(request({ body: { ...event, trigger: { ...event.trigger, id: "trigger-other" } } }))).status,
    ).toBe(403);
    expect(
      (await fetch(request({ body: { ...event, trigger: { ...event.trigger, type: "storage_object_created" } } })))
        .status,
    ).toBe(403);
    expect(runOnce).not.toHaveBeenCalled();
  });

  it("rejects unsupported envelope fields, bad data, wrong content type and oversized bodies", async () => {
    const { fetch, runOnce } = handler();
    expect((await fetch(request({ body: { ...event, repositoryId: "other-tenant" } }))).status).toBe(400);
    expect((await fetch(request({ body: { ...event, data: { scheduled_at: "not-time" } } }))).status).toBe(400);
    expect((await fetch(request({ contentType: "text/plain" }))).status).toBe(415);
    expect((await fetch(request({ body: "x".repeat(50_000) }))).status).toBe(413);
    expect(runOnce).not.toHaveBeenCalled();
  });

  it("returns bounded non-sensitive failure and Neon retry hint", async () => {
    const runOnce = vi.fn(async () => {
      throw new Error("SECRET_DATABASE_URL");
    });
    const { fetch } = handler(runOnce);
    const res = await fetch(request());
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(JSON.stringify(await res.json())).not.toContain("SECRET_DATABASE_URL");
    expect(runOnce).toHaveBeenCalledTimes(1);
  });

  it("does not overlap work within one Neon isolate and recovers when settled", async () => {
    let finish!: () => void;
    const work = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const runOnce = vi.fn(() => work);
    const { fetch } = handler(runOnce);
    const first = fetch(request());
    await vi.waitFor(() => expect(runOnce).toHaveBeenCalledTimes(1));
    expect((await fetch(request())).status).toBe(503);
    finish();
    expect((await first).status).toBe(200);
    expect((await fetch(request())).status).toBe(200);
    expect(runOnce).toHaveBeenCalledTimes(2);
  });
});
