import { createHash, timingSafeEqual } from "node:crypto";
import { runProductionBoundedPass } from "../../../../lib/serverless-worker-production.js";

export const runtime = "nodejs";
export const maxDuration = 60;

function reply(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function validCronToken(request: Request, secret: string): boolean {
  const value = request.headers.get("authorization") ?? "";
  const token = value.startsWith("Bearer ") ? value.slice(7) : "";
  if (token.length === 0) return false;
  const expected = createHash("sha256").update(secret).digest();
  const actual = createHash("sha256").update(token).digest();
  return timingSafeEqual(expected, actual);
}

/** Free Hobby plan: one signed recovery pass daily; event-driven webhooks stay immediate. */
export async function GET(request: Request): Promise<Response> {
  if (
    process.env.BOARDREADYOPS_BOUNDED_WORKER_ENABLED !== "1" ||
    process.env.BOARDREADYOPS_BOUNDED_WORKER_VERIFY_ONLY === "1"
  ) {
    return reply({ ok: false, error: "not_found" }, 404);
  }
  const secret = process.env.CRON_SECRET;
  if (!secret) return reply({ ok: false, error: "not_configured" }, 503);
  if (!validCronToken(request, secret)) return reply({ ok: false, error: "unauthorized" }, 401);

  try {
    const claimed = await runProductionBoundedPass();
    return reply({ ok: true, claimed }, 200);
  } catch {
    return reply({ ok: false, error: "worker_unavailable" }, 503);
  }
}
