import { handleBoardReadyOpsMcpRequest } from "../../lib/mcp-resource-server.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleBoardReadyOpsMcpRequest(request);
}

export async function GET(request: Request): Promise<Response> {
  return handleBoardReadyOpsMcpRequest(request);
}
