import { handleRunnerRelinquishRequest } from "../../../../../../lib/runner-lease-routes.js";

export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return handleRunnerRelinquishRequest(request);
}
