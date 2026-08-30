import { type NextRequest, NextResponse } from "next/server";

export const HOMEPAGE_LINK_HEADER =
  '<https://boardreadyops.com/>; rel="canonical", </llms.txt>; rel="describedby"' as const;

export function wantsMarkdown(accept: string | null): boolean {
  if (!accept) return false;

  return accept.split(",").some((entry) => {
    const [mediaType, ...parameters] = entry.split(";").map((part) => part.trim().toLowerCase());
    if (mediaType !== "text/markdown") return false;

    const qualityParameter = parameters.find((parameter) => parameter.startsWith("q="));
    if (!qualityParameter) return true;

    const quality = Number(qualityParameter.slice(2));
    return Number.isFinite(quality) && quality > 0 && quality <= 1;
  });
}

function appendHeaderToken(headers: Headers, name: string, token: string): void {
  const current = headers.get(name);
  if (!current) {
    headers.set(name, token);
    return;
  }

  const tokens = current.split(",").map((value) => value.trim().toLowerCase());
  if (!tokens.includes(token.toLowerCase())) headers.set(name, `${current}, ${token}`);
}

export function proxy(request: NextRequest) {
  const safeReadMethod = request.method === "GET" || request.method === "HEAD";
  const response =
    safeReadMethod && wantsMarkdown(request.headers.get("accept"))
      ? NextResponse.rewrite(new URL("/index.md", request.url))
      : NextResponse.next();

  response.headers.set("Link", HOMEPAGE_LINK_HEADER);
  appendHeaderToken(response.headers, "Vary", "Accept");
  return response;
}

export const config = {
  matcher: ["/"],
};
