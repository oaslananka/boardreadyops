import { describe, expect, it } from "vitest";
import {
  type RunLiveRefreshEnvironment,
  type RunLiveRefreshEvent,
  shouldLiveRefreshRun,
  startRunLiveRefresh,
} from "../../../apps/web/lib/run-live-refresh.js";

function refreshHarness() {
  let online = true;
  let visible = true;
  let scheduled: (() => void) | undefined;
  let cancelled: unknown;
  const listeners = new Map<RunLiveRefreshEvent, Set<() => void>>();

  const environment: RunLiveRefreshEnvironment = {
    scheduleRepeating(callback, intervalMilliseconds) {
      expect(intervalMilliseconds).toBe(5_000);
      scheduled = callback;
      return "interval-handle";
    },
    cancelRepeating(handle) {
      cancelled = handle;
    },
    subscribe(event, callback) {
      const callbacks = listeners.get(event) ?? new Set<() => void>();
      callbacks.add(callback);
      listeners.set(event, callbacks);
      return () => callbacks.delete(callback);
    },
    isOnline: () => online,
    isVisible: () => visible,
  };

  return {
    environment,
    tick: () => scheduled?.(),
    emit(event: RunLiveRefreshEvent) {
      for (const callback of listeners.get(event) ?? []) callback();
    },
    setOnline(value: boolean) {
      online = value;
    },
    setVisible(value: boolean) {
      visible = value;
    },
    cancelled: () => cancelled,
    listenerCount: () => [...listeners.values()].reduce((count, callbacks) => count + callbacks.size, 0),
  };
}

describe("run live refresh", () => {
  it("continues only for non-terminal and recovery investigation states", () => {
    for (const state of ["current", "reconciliation", "stale"] as const) {
      expect(shouldLiveRefreshRun(state)).toBe(true);
    }
    for (const state of ["completed", "dead_letter", "failed", "partial_data", "superseded", "timed_out"] as const) {
      expect(shouldLiveRefreshRun(state)).toBe(false);
    }
  });

  it("refreshes periodically only while the page is visible and online", () => {
    const harness = refreshHarness();
    let refreshCount = 0;
    const stop = startRunLiveRefresh({
      refresh: () => refreshCount++,
      intervalMilliseconds: 5_000,
      environment: harness.environment,
    });

    harness.tick();
    expect(refreshCount).toBe(1);

    harness.setVisible(false);
    harness.tick();
    harness.setVisible(true);
    harness.setOnline(false);
    harness.tick();
    expect(refreshCount).toBe(1);

    stop();
  });

  it("refreshes immediately after reconnect and removes every listener when stopped", () => {
    const harness = refreshHarness();
    let refreshCount = 0;
    const stop = startRunLiveRefresh({
      refresh: () => refreshCount++,
      intervalMilliseconds: 5_000,
      environment: harness.environment,
    });

    harness.setOnline(false);
    harness.emit("online");
    expect(refreshCount).toBe(0);

    harness.setOnline(true);
    harness.emit("online");
    expect(refreshCount).toBe(1);

    harness.setVisible(false);
    harness.emit("visibilitychange");
    expect(refreshCount).toBe(1);

    harness.setVisible(true);
    harness.emit("visibilitychange");
    expect(refreshCount).toBe(2);

    stop();
    expect(harness.cancelled()).toBe("interval-handle");
    expect(harness.listenerCount()).toBe(0);

    harness.emit("online");
    harness.tick();
    expect(refreshCount).toBe(2);
  });
});
