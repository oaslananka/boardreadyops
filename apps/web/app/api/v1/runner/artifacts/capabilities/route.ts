import { handleRunnerArtifactCapabilityRequest } from "../../../../../../lib/runner-artifact-routes.js";

export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return handleRunnerArtifactCapabilityRequest(request);
}
