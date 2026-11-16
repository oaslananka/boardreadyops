/**
 * Wake the durable worker after a webhook has been accepted in PostgreSQL.
 * An independent Neon scheduled trigger recovers work if this callback fails.
 */
export function boundedWorkerMayProcess(environment: Readonly<Record<string, string | undefined>>): boolean {
  return (
    environment.BOARDREADYOPS_BOUNDED_WORKER_ENABLED === "1" &&
    environment.BOARDREADYOPS_BOUNDED_WORKER_VERIFY_ONLY !== "1"
  );
}

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

/**
 * Dashboard reruns share the same event-driven, lease-protected worker as
 * GitHub webhooks. Only a genuinely accepted, queued API response can trigger
 * a post-response pass. A scheduling failure never changes durable intake.
 */
export async function scheduleRepositoryActionWorkerWakeup(input: {
  response: Response;
  environment: Readonly<Record<string, string | undefined>>;
  schedule: (work: () => Promise<void>) => void;
  work: () => Promise<unknown>;
}): Promise<Response> {
  const { response, environment, schedule, work } = input;
  if (response.status !== 202 || !boundedWorkerMayProcess(environment)) return response;
  try {
    const receipt: unknown = await response.clone().json();
    const queued = typeof receipt === "object" && receipt !== null && "queued" in receipt && receipt.queued === true;
    scheduleBoundedWorkerWakeup({ queued, enabled: true, schedule, work });
  } catch {
    // Already queued work is recovered via the existing scheduled worker.
    // Never replace the authoritative accepted response with an error.
  }
  return response;
}
