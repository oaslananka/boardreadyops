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

/** Bounded ISO UTC timestamp validation without a backtracking regexp. */
function scheduledUtcTimestamp(value: unknown): boolean {
  if (typeof value !== "string" || ![20, 22, 23, 24].includes(value.length) || !value.endsWith("Z")) return false;
  const separators: Record<number, string> = { 4: "-", 7: "-", 10: "T", 13: ":", 16: ":", 19: "." };
  for (let index = 0; index < value.length - 1; index++) {
    const separator = separators[index];
    if (separator) {
      if (value[index] !== separator) return false;
    } else {
      const code = value.charCodeAt(index);
      if (code < 48 || code > 57) return false;
    }
  }
  return Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateSchedule(payload: unknown, invocationId: string): "valid" | "invalid" | "mismatch" {
  if (!isRecord(payload) || !isRecord(payload.data) || !isRecord(payload.trigger)) return "invalid";
  if (
    !scheduledUtcTimestamp(payload.data.scheduled_at) ||
    payload.version !== 1 ||
    typeof payload.invocation_id !== "string" ||
    payload.trigger.type !== "schedule"
  ) {
    return "invalid";
  }
  // Neon strips client-supplied x-neon-* headers before invoking Functions.
  return payload.invocation_id === invocationId ? "valid" : "mismatch";
}

async function fetchScheduled(request: Request): Promise<Response> {
  if (request.method !== "POST") return result({ ok: false, error: "method_not_allowed" }, 405);

  // A public Function URL is not authority to call the private Vercel worker.
  const invocationId = request.headers.get("x-neon-trigger-invocation-id");
  if (!invocationId) return result({ ok: false, error: "trigger_required" }, 403);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return result({ ok: false, error: "invalid_schedule" }, 400);
  }
  const schedule = validateSchedule(payload, invocationId);
  if (schedule !== "valid") {
    return schedule === "mismatch"
      ? result({ ok: false, error: "trigger_mismatch" }, 403)
      : result({ ok: false, error: "invalid_schedule" }, 400);
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
