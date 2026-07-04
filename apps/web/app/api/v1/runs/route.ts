import { createReleaseRunRequestSchema } from "@boardreadyops/contracts";

export const runtime = "nodejs";

export function GET(): Response {
  return Response.json({ ok: true, runs: [], next: null });
}

export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json();
  const parsed = createReleaseRunRequestSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ ok: false, error: "invalid release run request" }, { status: 400 });
  }

  return Response.json({ ok: true, status: "queued", run: parsed.data }, { status: 202 });
}
