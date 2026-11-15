/**
 * Wake the durable worker after a webhook has been accepted in PostgreSQL.
 * An independent Neon scheduled trigger recovers work if this callback fails.
 */
export function scheduleBoundedWorkerWakeup(input: {
  queued: boolean;
  enabled: boolean;
  schedule: (work: () => Promise<void>) => void;
  work: () => Promise<unknown>;
}): boolean {
  if (!input.queued || !input.enabled) return false;
  input.schedule(async () => {
    try {
      await input.work();
    } catch {
      // Never change the already accepted webhook response. SQL leases and
      // scheduled recovery own all retries; no raw exception is logged.
    }
  });
  return true;
}
