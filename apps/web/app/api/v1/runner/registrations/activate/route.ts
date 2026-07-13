import { handleRunnerRegistrationActivationRequest } from "../../../../../../lib/runner-registration-activation-route.js";

export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return handleRunnerRegistrationActivationRequest(request);
}
