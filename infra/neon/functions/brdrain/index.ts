/**
 * Neon schedule -> authenticated Vercel bounded worker wakeup.
 *
 * The schedule runs independently of scale-to-zero PostgreSQL. This bridge
 * cannot claim jobs, call GitHub or see the database; it only requests one
 * private, limited pass of the canonical BoardReadyOps lifecycle processor.
 */
function result(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function approvedWorkerEndpoint(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      (host !== "boardreadyops.com" && !host.endsWith(".vercel.app")) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/api/internal/worker"
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

async function fetchScheduled(request: Request): Promise<Response> {
  if (request.method !== "POST") return result({ ok: false, error: "method_not_allowed" }, 405);

  // The public function URL is not an authorization credential. Keep the real
  // control-plane credentials only in the Vercel route, not in client responses.
  if (!request.headers.get("x-neon-trigger-invocation-id")) {
    return result({ ok: false, error: "trigger_required" }, 403);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return result({ ok: false, error: "invalid_schedule" }, 400);
  }
  const data =
    typeof payload === "object" && payload !== null && "data" in payload
      ? (payload as { data?: unknown }).data
      : undefined;
  const scheduledAt =
    typeof data === "object" && data !== null && "scheduled_at" in data
      ? (data as { scheduled_at?: unknown }).scheduled_at
      : undefined;
  if (
    typeof scheduledAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(scheduledAt) ||
    !Number.isFinite(Date.parse(scheduledAt))
  ) {
    return result({ ok: false, error: "invalid_schedule" }, 400);
  }

  // Neon strips client-supplied x-neon-* headers before invoking Functions.
  // Correlate the surviving trigger header with Neon's scheduled JSON body.
  const envelope = payload as { version?: unknown; invocation_id?: unknown; trigger?: unknown };
  const trigger = envelope.trigger;
  if (
    envelope.version !== 1 ||
    typeof envelope.invocation_id !== "string" ||
    typeof trigger !== "object" ||
    trigger === null ||
    !("type" in trigger) ||
    trigger.type !== "schedule"
  ) {
    return result({ ok: false, error: "invalid_schedule" }, 400);
  }
  if (envelope.invocation_id !== request.headers.get("x-neon-trigger-invocation-id")) {
    return result({ ok: false, error: "trigger_mismatch" }, 403);
  }

  const endpoint = approvedWorkerEndpoint(process.env.BOARDREADYOPS_WORKER_ENDPOINT);
  const secret = process.env.BOARDREADYOPS_BOUNDED_WORKER_SECRET;
  if (!endpoint || !secret) return result({ ok: false, error: "not_configured" }, 503);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(45_000),
    });
    return response.ok ? result({ ok: true }, 200) : result({ ok: false, error: "bounded_worker_unavailable" }, 502);
  } catch {
    return result({ ok: false, error: "bounded_worker_unavailable" }, 502);
  }
}

export default { fetch: fetchScheduled };
