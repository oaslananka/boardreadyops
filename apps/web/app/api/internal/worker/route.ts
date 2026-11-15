import { createHash, timingSafeEqual } from "node:crypto";
import { runProductionBoundedPass } from "../../../../lib/serverless-worker-production.js";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: Request, secret: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  const expectedDigest = createHash("sha256").update(secret).digest();
  const actualDigest = createHash("sha256").update(presented).digest();
  return presented.length > 0 && timingSafeEqual(expectedDigest, actualDigest);
}

function json(result: unknown, status: number): Response {
  return Response.json(result, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  if (process.env.BOARDREADYOPS_BOUNDED_WORKER_ENABLED !== "1") {
    return json({ ok: false, error: "not_found" }, 404);
  }
  const secret = process.env.BOARDREADYOPS_BOUNDED_WORKER_SECRET;
  if (!secret) return json({ ok: false, error: "not_configured" }, 503);
  if (!authorized(request, secret)) return json({ ok: false, error: "unauthorized" }, 401);

  // Validate the private Vercel route and Doppler sync without claiming stale
  // snapshot work or issuing GitHub mutations before the final cutover.
  if (process.env.BOARDREADYOPS_BOUNDED_WORKER_VERIFY_ONLY === "1") return json({ ok: true, mode: "verify-only" }, 200);

  try {
    const processed = await runProductionBoundedPass();
    return json({ ok: true, claimed: processed }, 200);
  } catch {
    return json({ ok: false, error: "worker_unavailable" }, 503);
  }
}
