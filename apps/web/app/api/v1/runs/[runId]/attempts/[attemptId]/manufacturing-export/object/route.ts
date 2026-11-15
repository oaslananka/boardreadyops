import { handleManufacturingObjectTransfer } from "../../../../../../../../../lib/manufacturing-object-transfer.js";

export const runtime = "nodejs";

type RouteProps = { params: Promise<{ runId: string; attemptId: string }> };

export async function POST(request: Request, { params }: RouteProps): Promise<Response> {
  return await handleManufacturingObjectTransfer(request, await params);
}
