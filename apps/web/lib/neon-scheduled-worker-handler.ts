/**
 * Admission boundary for Neon schedule-trigger deliveries.
 *
 * Neon strips client-supplied X-Neon-* headers at its public edge, so this
 * check authenticates a platform trigger ONLY when hosted on Neon Functions.
 * Never expose this handler on a proxy or runtime without that header contract.
 *
 * The injected callback must use the existing exclusive PostgreSQL worker
 * ownership and durable claim/retry mechanisms; it is not a second job runner.
 */
const maximumRequestBytes = 40_960;

type WorkerScheduledHandlerOptions = {
  triggerId: string;
  runOnce(): Promise<void>;
};

type Payload = Record<string, unknown>;

function isRecord(value: unknown): value is Payload {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reply(status: number, error?: string, retry = false): Response {
  return new Response(JSON.stringify(error ? { ok: false, error } : { ok: true }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(retry ? { "retry-after": "60" } : {}),
    },
  });
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const length = request.headers.get("content-length");
  if (length && (!/^[0-9]+$/u.test(length) || Number(length) > maximumRequestBytes)) {
    throw new RangeError("payload exceeds limit");
  }
  if (!request.body) throw new SyntaxError("missing request body");
  const reader = request.body.getReader();
  const buffers: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumRequestBytes) {
        await reader.cancel();
        throw new RangeError("payload exceeds limit");
      }
      buffers.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const buffer of buffers) {
    bytes.set(buffer, offset);
    offset += buffer.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

function validSchedule(payload: unknown, invocationId: string, triggerId: string): "ok" | "invalid" | "forbidden" {
  if (
    !isRecord(payload) ||
    Object.keys(payload).some(
      (key) =>
        !["version", "invocation_id", "trigger", "data", "previous_attempts", "previous_attempts_omitted"].includes(
          key,
        ),
    )
  ) {
    return "invalid";
  }
  if (payload.version !== 1 || !isRecord(payload.trigger) || !isRecord(payload.data)) return "invalid";
  if (payload.trigger.id !== triggerId || payload.trigger.type !== "schedule") return "forbidden";
  if (
    typeof payload.invocation_id !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/u.test(payload.invocation_id) ||
    payload.invocation_id !== invocationId
  ) {
    return "invalid";
  }
  if (
    Object.keys(payload.data).some((key) => key !== "scheduled_at") ||
    typeof payload.data.scheduled_at !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(payload.data.scheduled_at) ||
    !Number.isFinite(Date.parse(payload.data.scheduled_at))
  ) {
    return "invalid";
  }
  if (payload.previous_attempts !== undefined && !Array.isArray(payload.previous_attempts)) return "invalid";
  if (
    payload.previous_attempts_omitted !== undefined &&
    (!Number.isSafeInteger(payload.previous_attempts_omitted) || (payload.previous_attempts_omitted as number) < 0)
  ) {
    return "invalid";
  }
  return "ok";
}

/**
 * A callable contract for a future Neon Function, not a production endpoint.
 * Never accept caller-provided installation/repository/job scope from the body.
 */
export function createNeonScheduledWorkerHandler(
  options: WorkerScheduledHandlerOptions,
): (request: Request) => Promise<Response> {
  if (!/^trigger-[a-zA-Z0-9-]{8,100}$/u.test(options.triggerId)) {
    throw new Error("A specific Neon schedule trigger ID must be configured");
  }
  let inFlight = false;
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.pathname !== "/" || url.search) return reply(404, "not_found");
    if (request.method !== "POST") return reply(405, "method_not_allowed");
    const invocationId = request.headers.get("x-neon-trigger-invocation-id");
    if (!invocationId) return reply(401, "unauthorized");
    if (!/^application\/json(?:\s*;.*)?$/iu.test(request.headers.get("content-type") ?? "")) {
      return reply(415, "unsupported_media_type");
    }
    let parsed: unknown;
    try {
      parsed = await readBoundedJson(request);
    } catch (error) {
      return error instanceof RangeError ? reply(413, "payload_too_large") : reply(400, "invalid_request");
    }
    const admission = validSchedule(parsed, invocationId, options.triggerId);
    if (admission === "forbidden") return reply(403, "forbidden");
    if (admission !== "ok") return reply(400, "invalid_request");
    if (inFlight) return reply(503, "temporarily_unavailable", true);
    inFlight = true;
    try {
      await options.runOnce();
      return reply(200);
    } catch {
      return reply(503, "temporarily_unavailable", true);
    } finally {
      inFlight = false;
    }
  };
}
