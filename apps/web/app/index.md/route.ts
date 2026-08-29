import { buildHomeMarkdown } from "../../lib/public-discovery-content.js";

export const dynamic = "force-static";

export function GET(): Response {
  return new Response(buildHomeMarkdown(), {
    status: 200,
    headers: {
      "cache-control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      "content-type": "text/markdown; charset=utf-8",
      link: '<https://boardreadyops.com/>; rel="canonical"',
      vary: "Accept",
    },
  });
}
