import { describe, expect, it, vi } from "vitest";
import { scheduleBoundedWorkerWakeup } from "../../../apps/web/lib/serverless-worker-wakeup.js";

describe("serverless webhook wakeup", () => {
  it("does not schedule a wakeup for duplicate or disabled webhook intake", () => {
    const schedule = vi.fn();
    const work = vi.fn(async () => undefined);

    scheduleBoundedWorkerWakeup({ queued: false, enabled: true, schedule, work });
    scheduleBoundedWorkerWakeup({ queued: true, enabled: false, schedule, work });

    expect(schedule).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
  });

  it("schedules exactly one bounded pass for an accepted queued event", async () => {
    const work = vi.fn(async () => undefined);
    let callback: (() => Promise<void>) | undefined;
    const schedule = vi.fn((fn: () => Promise<void>) => {
      callback = fn;
    });

    scheduleBoundedWorkerWakeup({ queued: true, enabled: true, schedule, work });
    expect(schedule).toHaveBeenCalledOnce();
    expect(work).not.toHaveBeenCalled();

    expect(callback).toBeDefined();
    await callback?.();
    expect(work).toHaveBeenCalledOnce();
  });

  it("does not leak worker failures through the accepted webhook response callback", async () => {
    const work = vi.fn(async () => {
      throw new Error("private-key-must-not-leak");
    });
    let callback: (() => Promise<void>) | undefined;
    scheduleBoundedWorkerWakeup({
      queued: true,
      enabled: true,
      schedule: (fn) => {
        callback = fn;
      },
      work,
    });
    await expect(callback?.()).resolves.toBeUndefined();
  });
});
