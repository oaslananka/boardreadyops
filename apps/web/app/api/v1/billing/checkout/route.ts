import { viewerAuthorization } from "../../../../../lib/viewer-authorization.js";

export const runtime = "nodejs";

export async function POST(_request: Request): Promise<Response> {
  const viewer = await viewerAuthorization();
  if (!viewer.session) {
    return Response.json(
      { ok: false, error: "authentication required" },
      { status: 401, headers: { "cache-control": "private, no-store" } },
    );
  }

  return Response.json(
    {
      ok: false,
      error: "External paid billing is unavailable while the GitHub Marketplace listing is Community Free",
      code: "marketplace_free_only",
    },
    { status: 410, headers: { "cache-control": "private, no-store" } },
  );
}
