import { handleRunnerTerminalResultRequest } from "../../../../../lib/runner-terminal-result-routes.js";

export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return handleRunnerTerminalResultRequest(request);
}
