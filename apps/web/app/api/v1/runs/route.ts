import { createReleaseRunRequestSchema } from "@boardreadyops/contracts";
import { decodeRunListingCursor, loadViewerRuns, normalizedRunListingLimit } from "../../../../lib/run-listing.js";
import { viewerAuthorization } from "../../../../lib/viewer-authorization.js";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const viewer = await viewerAuthorization();
  if (!viewer.session) {
    return Response.json({ ok: false, error: "authentication required" }, { status: 401 });
  }

  const searchParams = new URL(request.url).searchParams;
  const cursor = decodeRunListingCursor(searchParams.get("cursor"));
  if (searchParams.get("cursor") && !cursor) {
    return Response.json({ ok: false, error: "invalid cursor" }, { status: 400 });
  }
  const requestedLimit = searchParams.get("limit");
  const limit = normalizedRunListingLimit(requestedLimit ? Number(requestedLimit) : undefined);

  const page = await loadViewerRuns(viewer.session, { ...(cursor ? { cursor } : {}), limit });
  if (page.state === "not-configured") {
    return Response.json({ ok: false, error: "run store is not configured" }, { status: 503 });
  }

  return Response.json(
    { ok: true, runs: page.runs, next: page.next ?? null },
    { headers: { "cache-control": "private, no-store" } },
  );
}

export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json();
  const parsed = createReleaseRunRequestSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ ok: false, error: "invalid release run request" }, { status: 400 });
  }

  return Response.json({ ok: true, status: "queued", run: parsed.data }, { status: 202 });
}
