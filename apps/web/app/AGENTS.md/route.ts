import { buildPublicAgentsMarkdown } from "../../lib/public-discovery-content.js";

export function GET(): Response {
  return new Response(buildPublicAgentsMarkdown(), {
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=3600",
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
}
