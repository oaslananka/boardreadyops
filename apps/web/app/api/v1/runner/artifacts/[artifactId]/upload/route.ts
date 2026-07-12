import { handleRunnerArtifactUploadRequest } from "../../../../../../../lib/runner-artifact-routes.js";

export const runtime = "nodejs";

type ArtifactUploadRouteProps = {
  params: Promise<{ artifactId: string }>;
};

export async function PUT(request: Request, { params }: ArtifactUploadRouteProps): Promise<Response> {
  const { artifactId } = await params;
  return await handleRunnerArtifactUploadRequest(request, artifactId);
}
