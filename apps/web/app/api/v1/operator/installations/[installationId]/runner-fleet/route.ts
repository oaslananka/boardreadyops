import { handleControlPlaneRunnerFleetRequest } from "../../../../../../../lib/control-plane-runner-fleet-routes.js";

export const runtime = "nodejs";

type RunnerFleetRouteProps = {
  params: Promise<{ installationId: string }>;
};

export async function GET(request: Request, props: RunnerFleetRouteProps): Promise<Response> {
  const { installationId } = await props.params;
  return handleControlPlaneRunnerFleetRequest(request, installationId);
}
