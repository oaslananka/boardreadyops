import { handleRunnerHeartbeatRequest } from "../../../../../../lib/runner-lease-routes.js";

export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return handleRunnerHeartbeatRequest(request);
}
