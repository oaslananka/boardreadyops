import { handleSignedManufacturingExportImport } from "../../../../../../../../lib/signed-manufacturing-export-import.js";

export const runtime = "nodejs";

type RouteProps = { params: Promise<{ runId: string; attemptId: string }> };

export async function POST(request: Request, { params }: RouteProps): Promise<Response> {
  return await handleSignedManufacturingExportImport(request, await params);
}
