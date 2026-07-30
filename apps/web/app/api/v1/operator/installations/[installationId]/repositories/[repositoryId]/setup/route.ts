import {
  handleRepositorySetupGet,
  handleRepositorySetupPost,
} from "../../../../../../../../../lib/repository-setup-routes.js";

export const runtime = "nodejs";

type RepositorySetupRouteProps = {
  params: Promise<{ installationId: string; repositoryId: string }>;
};

export async function GET(request: Request, props: RepositorySetupRouteProps): Promise<Response> {
  const { installationId, repositoryId } = await props.params;
  return handleRepositorySetupGet(request, installationId, repositoryId);
}

export async function POST(request: Request, props: RepositorySetupRouteProps): Promise<Response> {
  const { installationId, repositoryId } = await props.params;
  return handleRepositorySetupPost(request, installationId, repositoryId);
}
