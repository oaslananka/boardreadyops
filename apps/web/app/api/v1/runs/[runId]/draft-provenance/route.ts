import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { resolveCloudPersistenceConfiguration } from "../../../../../../lib/cloud-runtime-config.js";
import { handleDraftProvenanceStatus } from "../../../../../../lib/draft-provenance-routes.js";
import { verifyStoredManufacturingDraftClaim } from "../../../../../../lib/manufacturing-draft-provenance.js";
import { viewerAuthorization } from "../../../../../../lib/viewer-authorization.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ runId: string }> };

export async function GET(_request: Request, props: RouteProps): Promise<Response> {
  const { runId } = await props.params;
  return handleDraftProvenanceStatus(runId, {
    authorize: viewerAuthorization,
    openExecutor() {
      const config = resolveCloudPersistenceConfiguration();
      if (config.mode !== "postgres") return undefined;
      return createPgQueryExecutor({ connectionString: config.databaseUrl, max: 2 });
    },
    verify: verifyStoredManufacturingDraftClaim,
    environment: process.env,
  });
}
