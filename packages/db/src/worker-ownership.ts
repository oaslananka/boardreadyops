import pg from "pg";

const { Client } = pg;

// Distinct two-int advisory keyspace. Lock is database-scoped, never transactional.
// A dedicated session must remain alive for the ENTIRE worker lifetime.
const WORKER_KEY = [0x42524f50, 0x57524b52] as const;
const HEARTBEAT_MS = 5_000;

export type WorkerOwnership = {
  release(): Promise<void>;
};

/**
 * Refuse a second processing worker before it becomes ready or claims effects.
 * This does NOT fence a legacy worker that was deployed before this protocol.
 */
export async function acquireExclusiveWorkerOwnership(options: {
  connectionString: string;
  onLost(): void;
}): Promise<WorkerOwnership> {
  const client = new Client({
    connectionString: options.connectionString,
    connectionTimeoutMillis: 5_000,
    query_timeout: 5_000,
    application_name: "boardreadyops-control-plane-owner",
  });
  let acquired = false;
  let releasing = false;
  let lost = false;
  let heartbeat: NodeJS.Timeout | undefined;
  let pingPending = false;
  function onConnectionLost() {
    if (!acquired || releasing || lost) return;
    lost = true;
    if (heartbeat) clearInterval(heartbeat);
    options.onLost();
  }
  client.on("error", onConnectionLost);
  client.on("end", onConnectionLost);

  try {
    await client.connect();
    const lock = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock($1::integer, $2::integer) AS acquired",
      [...WORKER_KEY],
    );
    if (lock.rows[0]?.acquired !== true) throw new Error("exclusive_worker_ownership_unavailable");
    acquired = true;
    heartbeat = setInterval(() => {
      if (pingPending || releasing || lost) return;
      pingPending = true;
      void client
        .query("SELECT 1")
        .catch(onConnectionLost)
        .finally(() => {
          pingPending = false;
        });
    }, HEARTBEAT_MS);
    heartbeat.unref();

    return {
      async release() {
        if (releasing) return;
        releasing = true;
        if (heartbeat) clearInterval(heartbeat);
        try {
          if (acquired && !lost) {
            const unlocked = await client.query<{ released: boolean }>(
              "SELECT pg_advisory_unlock($1::integer, $2::integer) AS released",
              [...WORKER_KEY],
            );
            if (unlocked.rows[0]?.released !== true) throw new Error("exclusive_worker_ownership_release_failed");
          }
        } finally {
          await client.end().catch((error: unknown) => {
            if (!lost) throw error;
          });
        }
      },
    };
  } catch (error) {
    releasing = true;
    if (heartbeat) clearInterval(heartbeat);
    await client.end().catch(() => undefined);
    throw error;
  }
}
