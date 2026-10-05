import { handleProductionOutcomeImport } from "../../../../../../lib/production-outcome-routes.js";

export const runtime = "nodejs";

type ProductionOutcomeRouteProps = {
  params: Promise<{ runId: string }>;
};

export async function POST(request: Request, props: ProductionOutcomeRouteProps): Promise<Response> {
  const { runId } = await props.params;
  return handleProductionOutcomeImport(request, runId);
}
