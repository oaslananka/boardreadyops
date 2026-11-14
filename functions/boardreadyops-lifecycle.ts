import { randomUUID } from "node:crypto";
import { createProductionNeonLifecycleHandler } from "../apps/web/lib/neon-production-lifecycle.js";

let handler: ((request: Request) => Promise<Response>) | undefined;

function unavailable(): Response {
  return new Response(JSON.stringify({ ok: false, error: "temporarily_unavailable" }), {
    status: 503,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "retry-after": "60",
    },
  });
}

/**
 * Deployment-ready Neon module shape, but deliberately disabled by default.
 * Only Neon-native schedule headers can admit a request after activation.
 * This Function processes lifecycle jobs only; the other six queues remain
 * owned by the existing continuous worker until separately accepted.
 */
export default {
  async fetch(request: Request): Promise<Response> {
    if (process.env.BOARDREADYOPS_NEON_LIFECYCLE_ENABLED !== "true") return unavailable();
    try {
      handler ??= createProductionNeonLifecycleHandler({
        triggerId: process.env.BOARDREADYOPS_NEON_LIFECYCLE_TRIGGER_ID ?? "",
        connectionString: process.env.DATABASE_URL_UNPOOLED ?? "",
        workerConnectionString: process.env.DATABASE_URL ?? "",
        workerId: `neon-lifecycle-${randomUUID()}`,
        batchLimit: 2,
        enableOutbox: process.env.BOARDREADYOPS_NEON_OUTBOX_ENABLED === "true",
      });
      return await handler(request);
    } catch {
      // Never leak GitHub App private keys, PostgreSQL URLs or job payloads.
      return unavailable();
    }
  },
};
