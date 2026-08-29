import { buildPublicOpenApiDocument } from "../../lib/public-discovery-content.js";

export function GET(): Response {
  return Response.json(buildPublicOpenApiDocument(), {
    headers: { "Cache-Control": "public, max-age=300, s-maxage=3600" },
  });
}
