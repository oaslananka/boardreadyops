import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { handleGuestManufacturingDownload } from "../../../../../../lib/guest-manufacturing-download.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || process.env.BOARDREADYOPS_PERSISTENCE_MODE === "memory") {
    return Response.json(
      { ok: false, error: "Delivery storage unavailable" },
      { status: 503, headers: { "cache-control": "private, no-store" } },
    );
  }
  const executor = createPgQueryExecutor({ connectionString: databaseUrl, max: 2 });
  try {
    return await handleGuestManufacturingDownload(token, { executor, environment: process.env });
  } finally {
    await executor.close();
  }
}
