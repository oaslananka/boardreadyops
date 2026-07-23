import { handleControlPlaneDeadLetterListRequest } from "../../../../../../../lib/control-plane-dead-letter-routes.js";

export const runtime = "nodejs";

type DeadLetterListRouteProps = {
  params: Promise<{ installationId: string }>;
};

export async function GET(request: Request, props: DeadLetterListRouteProps): Promise<Response> {
  const { installationId } = await props.params;
  return handleControlPlaneDeadLetterListRequest(request, installationId);
}
