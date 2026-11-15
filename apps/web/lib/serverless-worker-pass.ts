/**
 * A single bounded control-plane drain. The existing durable SQL stores own
 * leases, retries, idempotency and transitions; this scheduler never bypasses them.
 *
 * No timers, independent worker ownership, or API mutations happen at import time.
 */
type BoundedWorkQueue<T> = {
  claim(limit: number): Promise<readonly T[]>;
  process(item: T): Promise<unknown>;
};

type BoundedWorkQueues<J, O, L, W, C> = {
  jobs: BoundedWorkQueue<J>;
  outbox?: BoundedWorkQueue<O>;
  lifecycle?: BoundedWorkQueue<L>;
  workflow?: BoundedWorkQueue<W>;
  checkRun?: BoundedWorkQueue<C>;
};

export type BoundedPassCounts = {
  jobs: number;
  outbox: number;
  lifecycle: number;
  workflow: number;
  checkRun: number;
};

async function drainQueue<T>(queue: BoundedWorkQueue<T> | undefined, limit: number): Promise<number> {
  if (!queue) return 0;
  const claimed = await queue.claim(limit);
  if (claimed.length > limit) throw new Error("durable store returned more claimed work than requested");
  for (const item of claimed) await queue.process(item);
  return claimed.length;
}

export async function drainBoundedQueues<J, O = never, L = never, W = never, C = never>(
  queues: BoundedWorkQueues<J, O, L, W, C>,
  options: { batchSize?: number } = {},
): Promise<BoundedPassCounts> {
  const requested = options.batchSize ?? 2;
  const batchSize = Number.isInteger(requested) ? Math.max(1, Math.min(requested, 4)) : 2;
  const jobs = await drainQueue(queues.jobs, batchSize);
  const outbox = await drainQueue(queues.outbox, batchSize);
  const lifecycle = await drainQueue(queues.lifecycle, batchSize);
  const workflow = await drainQueue(queues.workflow, batchSize);
  const checkRun = await drainQueue(queues.checkRun, batchSize);
  return { jobs, outbox, lifecycle, workflow, checkRun };
}

/**
 * The long-running worker periodically detects missing terminal acknowledgements.
 * A serverless process cannot keep that interval state in memory; perform a
 * bounded, idempotent detection before claiming reconciliation work instead.
 */
type ReconciliationDetector = {
  detectLifecycleReconciliationCandidates(input: ReconciliationInput): Promise<number>;
  detectWorkflowReconciliationCandidates(input: ReconciliationInput): Promise<number>;
  detectCheckRunReconciliationCandidates(input: ReconciliationInput): Promise<number>;
};

type ReconciliationInput = {
  observationDelaySeconds: number;
  terminalDeadlineSeconds: number;
  limit: number;
};

export async function detectBoundedReconciliationCandidates(
  detector: ReconciliationDetector,
  observationDelaySeconds = 300,
): Promise<{ lifecycle: number; workflow: number; checkRun: number }> {
  const input = {
    observationDelaySeconds,
    terminalDeadlineSeconds: 1800,
    limit: 16,
  };
  const [lifecycle, workflow, checkRun] = await Promise.all([
    detector.detectLifecycleReconciliationCandidates(input),
    detector.detectWorkflowReconciliationCandidates(input),
    detector.detectCheckRunReconciliationCandidates(input),
  ]);
  return { lifecycle, workflow, checkRun };
}
