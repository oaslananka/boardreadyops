import { buildLlmsFullTxt } from "../../lib/public-discovery-content.js";

export function GET(): Response {
  return new Response(buildLlmsFullTxt(), {
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=3600",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
