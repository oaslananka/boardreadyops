import { handleRepositorySetupCreatePr } from "../../../../../../../../../../lib/repository-setup-routes.js";

export const runtime = "nodejs";

type RepositorySetupPrRouteProps = {
  params: Promise<{ installationId: string; repositoryId: string }>;
};

export async function POST(request: Request, props: RepositorySetupPrRouteProps): Promise<Response> {
  const { installationId, repositoryId } = await props.params;
  return handleRepositorySetupCreatePr(request, installationId, repositoryId);
}
