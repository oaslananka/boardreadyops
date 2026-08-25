import { handleComponentCredentialSubmission } from "../../../../../lib/component-credential-routes.js";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleComponentCredentialSubmission(request);
}
