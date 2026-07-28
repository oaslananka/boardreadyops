import { handleControlPlaneAuditListRequest } from "../../../../../../../lib/control-plane-audit-routes.js";

export const runtime = "nodejs";

type AuditListRouteProps = {
  params: Promise<{ installationId: string }>;
};

export async function GET(request: Request, props: AuditListRouteProps): Promise<Response> {
  const { installationId } = await props.params;
  return handleControlPlaneAuditListRequest(request, installationId);
}
