import { handleControlPlaneWorkspaceSlugRequest } from "../../../../../lib/control-plane-workspace-routes.js";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handleControlPlaneWorkspaceSlugRequest(request);
}
