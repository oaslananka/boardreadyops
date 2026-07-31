export type RunLiveRefreshEvent = "online" | "visibilitychange";

export type RunLiveRefreshState =
  | "completed"
  | "current"
  | "dead_letter"
  | "failed"
  | "partial_data"
  | "reconciliation"
  | "stale"
  | "superseded"
  | "timed_out";

export type RunLiveRefreshEnvironment = {
  scheduleRepeating(callback: () => void, intervalMilliseconds: number): unknown;
  cancelRepeating(handle: unknown): void;
  subscribe(event: RunLiveRefreshEvent, callback: () => void): () => void;
  isOnline(): boolean;
  isVisible(): boolean;
};

const refreshableStates = new Set<RunLiveRefreshState>(["current", "reconciliation", "stale"]);

export function shouldLiveRefreshRun(state: RunLiveRefreshState): boolean {
  return refreshableStates.has(state);
}

export function startRunLiveRefresh(options: {
  refresh: () => void;
  intervalMilliseconds: number;
  environment: RunLiveRefreshEnvironment;
}): () => void {
  let stopped = false;
  const refreshWhenAvailable = () => {
    if (!stopped && options.environment.isOnline() && options.environment.isVisible()) {
      options.refresh();
    }
  };

  const intervalHandle = options.environment.scheduleRepeating(refreshWhenAvailable, options.intervalMilliseconds);
  const unsubscribeOnline = options.environment.subscribe("online", refreshWhenAvailable);
  const unsubscribeVisibility = options.environment.subscribe("visibilitychange", refreshWhenAvailable);

  return () => {
    stopped = true;
    options.environment.cancelRepeating(intervalHandle);
    unsubscribeOnline();
    unsubscribeVisibility();
  };
}
