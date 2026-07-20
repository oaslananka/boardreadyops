import { checkCloudReadiness } from "../../../../lib/cloud-readiness.js";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const result = await checkCloudReadiness();
  return Response.json(result, { status: result.ok ? 200 : 503 });
}
