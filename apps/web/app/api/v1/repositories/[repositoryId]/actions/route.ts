import { handleRepositoryAction } from "../../../../../../lib/repository-actions.js";

export const runtime = "nodejs";

type RepositoryActionRouteProps = {
  params: Promise<{ repositoryId: string }>;
};

export async function POST(request: Request, props: RepositoryActionRouteProps): Promise<Response> {
  const { repositoryId } = await props.params;
  return handleRepositoryAction(request, repositoryId);
}
