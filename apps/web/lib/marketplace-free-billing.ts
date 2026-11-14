import { viewerAuthorization } from "./viewer-authorization.js";

const noStoreHeaders = { "cache-control": "private, no-store" } as const;

export async function retiredPaidBillingPost(
  _request: Request,
  mode: "marketplace_free" | "beta_free" = "marketplace_free",
): Promise<Response> {
  const viewer = await viewerAuthorization();
  if (!viewer.session) {
    return Response.json({ ok: false, error: "authentication required" }, { status: 401, headers: noStoreHeaders });
  }

  return Response.json(
    {
      ok: false,
      error:
        mode === "beta_free"
          ? "Paid upgrades and checkout are unavailable during the free beta"
          : "External paid billing is unavailable while the GitHub Marketplace listing is Community Free",
      code: mode === "beta_free" ? "free_beta_only" : "marketplace_free_only",
    },
    { status: 410, headers: noStoreHeaders },
  );
}
