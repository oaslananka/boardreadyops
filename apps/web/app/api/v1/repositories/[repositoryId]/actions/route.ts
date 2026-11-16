import { after } from "next/server";
import { handleRepositoryAction } from "../../../../../../lib/repository-actions.js";
import { scheduleRepositoryActionWorkerWakeup } from "../../../../../../lib/serverless-worker-wakeup.js";

export const runtime = "nodejs";
export const maxDuration = 60;

type RepositoryActionRouteProps = {
  params: Promise<{ repositoryId: string }>;
};

export async function POST(request: Request, props: RepositoryActionRouteProps): Promise<Response> {
  const { repositoryId } = await props.params;
  const response = await handleRepositoryAction(request, repositoryId);
  return scheduleRepositoryActionWorkerWakeup({
    response,
    environment: process.env,
    schedule: after,
    work: async () => {
      const { runProductionBoundedPass } = await import("../../../../../../lib/serverless-worker-production.js");
      return runProductionBoundedPass();
    },
  });
}
