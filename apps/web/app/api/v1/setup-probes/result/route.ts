import { handleRepositorySetupProbeResult } from "../../../../../lib/repository-setup-probe-route.js";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleRepositorySetupProbeResult(request);
}
