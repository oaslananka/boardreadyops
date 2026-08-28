import { viewerAuthorization } from "./viewer-authorization.js";

const noStoreHeaders = { "cache-control": "private, no-store" } as const;

export async function retiredPaidBillingPost(_request: Request): Promise<Response> {
  const viewer = await viewerAuthorization();
  if (!viewer.session) {
    return Response.json({ ok: false, error: "authentication required" }, { status: 401, headers: noStoreHeaders });
  }

  return Response.json(
    {
      ok: false,
      error: "External paid billing is unavailable while the GitHub Marketplace listing is Community Free",
      code: "marketplace_free_only",
    },
    { status: 410, headers: noStoreHeaders },
  );
}
