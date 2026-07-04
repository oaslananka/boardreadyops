import { releaseRunResultSchema } from "@boardreadyops/contracts";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json();
  const parsed = releaseRunResultSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ ok: false, error: "invalid runner result" }, { status: 400 });
  }

  return Response.json({ ok: true, status: "accepted", result: parsed.data }, { status: 202 });
}
