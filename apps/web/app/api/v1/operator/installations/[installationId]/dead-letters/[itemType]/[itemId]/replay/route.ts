import { handleControlPlaneDeadLetterReplayRequest } from "../../../../../../../../../../lib/control-plane-dead-letter-routes.js";

export const runtime = "nodejs";

type DeadLetterReplayRouteProps = {
  params: Promise<{ installationId: string; itemType: string; itemId: string }>;
};

export async function POST(request: Request, props: DeadLetterReplayRouteProps): Promise<Response> {
  return handleControlPlaneDeadLetterReplayRequest(request, await props.params);
}
