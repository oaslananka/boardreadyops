import { handleProtectedReleaseIntent } from "../../../../../../lib/protected-release-intent-route.js";

export const runtime = "nodejs";

type RouteProps = { params: Promise<{ repositoryId: string }> };

export async function GET(request: Request, props: RouteProps): Promise<Response> {
  const { repositoryId } = await props.params;
  return handleProtectedReleaseIntent(request, repositoryId);
}

export async function POST(request: Request, props: RouteProps): Promise<Response> {
  const { repositoryId } = await props.params;
  return handleProtectedReleaseIntent(request, repositoryId);
}
