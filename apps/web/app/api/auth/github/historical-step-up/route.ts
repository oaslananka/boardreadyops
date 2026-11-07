import { startHistoricalStepUp } from "../../../../../lib/data-export-historical-oauth-roundtrip.js";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return startHistoricalStepUp(request);
}
