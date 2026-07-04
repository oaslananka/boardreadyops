export const runtime = "nodejs";

export function GET(): Response {
  return Response.json({ ok: true, service: "boardreadyops-cloud" });
}
