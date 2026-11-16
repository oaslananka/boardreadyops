import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { scheduleRepositoryActionWorkerWakeup } from "../../../apps/web/lib/serverless-worker-wakeup.js";

const enabled = {
  BOARDREADYOPS_BOUNDED_WORKER_ENABLED: "1",
  BOARDREADYOPS_BOUNDED_WORKER_VERIFY_ONLY: "0",
};

function accepted(queued = true): Response {
  return Response.json({ ok: true, outcome: "accepted", queued }, { status: 202 });
}

describe("dashboard action post-response worker wakeup", () => {
  it("schedules exactly one bounded pass for a queued, authenticated action", async () => {
    let callback: (() => Promise<void>) | undefined;
    const schedule = vi.fn((fn: () => Promise<void>) => {
      callback = fn;
    });
    const work = vi.fn(async () => ({ jobs: 1 }));
    const response = accepted();

    const result = await scheduleRepositoryActionWorkerWakeup({ response, environment: enabled, schedule, work });
    expect(result).toBe(response);
    expect(await result.json()).toMatchObject({ ok: true, queued: true });
    expect(schedule).toHaveBeenCalledOnce();
    expect(work).not.toHaveBeenCalled();
    await callback?.();
    expect(work).toHaveBeenCalledOnce();
  });

  it("never schedules on duplicate, denied, invalid or not-queued actions", async () => {
    const schedule = vi.fn();
    const work = vi.fn(async () => undefined);
    for (const response of [
      accepted(false),
      Response.json({ ok: true, queued: false }, { status: 200 }),
      Response.json({ ok: false }, { status: 400 }),
      Response.json({ ok: false }, { status: 403 }),
      Response.json({ ok: true }, { status: 202 }),
    ]) {
      expect(await scheduleRepositoryActionWorkerWakeup({ response, environment: enabled, schedule, work })).toBe(
        response,
      );
    }
    expect(schedule).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
  });

  it("does not schedule in disabled or verify-only production mode", async () => {
    const schedule = vi.fn();
    const work = vi.fn(async () => undefined);
    for (const environment of [
      { ...enabled, BOARDREADYOPS_BOUNDED_WORKER_ENABLED: "0" },
      { ...enabled, BOARDREADYOPS_BOUNDED_WORKER_VERIFY_ONLY: "1" },
    ]) {
      expect(
        (await scheduleRepositoryActionWorkerWakeup({ response: accepted(), environment, schedule, work })).status,
      ).toBe(202);
    }
    expect(schedule).not.toHaveBeenCalled();
  });

  it("preserves durable intake results when post-response scheduling fails", async () => {
    const response = accepted();
    const schedule = vi.fn(() => {
      throw new Error("after() unavailable");
    });
    const result = await scheduleRepositoryActionWorkerWakeup({
      response,
      environment: enabled,
      schedule,
      work: async () => undefined,
    });
    expect(result).toBe(response);
    expect(await result.json()).toMatchObject({ ok: true, queued: true });
  });

  it("wires the safe post-response helper in the authenticated Next.js route", async () => {
    const source = await readFile(
      new URL("../../../apps/web/app/api/v1/repositories/[repositoryId]/actions/route.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("await handleRepositoryAction(request, repositoryId)");
    expect(source).toContain("scheduleRepositoryActionWorkerWakeup({");
    expect(source).toContain("schedule: after");
    expect(source).toContain("maxDuration = 60");
  });
});
