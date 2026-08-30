const DOCS_HOSTNAME = "docs.boardreadyops.com";
const MARKDOWN_CONTENT_TYPE = "text/markdown; charset=utf-8";
const LLMS_PATH = "/llms.txt";
const NON_PAGE_MARKDOWN_PATHS = new Set(["/AGENTS.md", "/sitemap.md"]);

export function wantsMarkdown(request) {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return false;

  const accept = request.headers.get("accept");
  if (!accept) return false;
  return accept.split(",").some((entry) => {
    const [mediaType, ...parameters] = entry.split(";").map((part) => part.trim().toLowerCase());
    if (mediaType !== "text/markdown") return false;
    const quality = parameters.find((parameter) => parameter.startsWith("q="));
    return quality ? Number.parseFloat(quality.slice(2)) > 0 : true;
  });
}

export function markdownMirrorPath(pathname) {
  if (pathname === "/") return "/index.md";

  const withoutTrailingSlash = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (!withoutTrailingSlash || withoutTrailingSlash === "/") return "/index.md";

  const lastSegment = withoutTrailingSlash.slice(withoutTrailingSlash.lastIndexOf("/") + 1);
  if (!lastSegment || lastSegment.includes(".")) return null;
  return `${withoutTrailingSlash}.md`;
}

export function canonicalPathForMirror(pathname) {
  if (NON_PAGE_MARKDOWN_PATHS.has(pathname) || !pathname.endsWith(".md")) return null;
  if (pathname === "/index.md") return "/";

  if (pathname.endsWith("/index.md") || pathname.endsWith("/README.md")) {
    return `${pathname.slice(0, pathname.lastIndexOf("/") + 1)}`;
  }

  return `${pathname.slice(0, -3)}/`;
}

export async function handleDocsEdgeRequest(request, fetchOrigin = fetch) {
  const url = new URL(request.url);
  if (url.hostname !== DOCS_HOSTNAME) {
    return new Response("Misdirected Request\n", {
      status: 421,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const directCanonicalPath = canonicalPathForMirror(url.pathname);

  if (directCanonicalPath || NON_PAGE_MARKDOWN_PATHS.has(url.pathname)) {
    const response = await fetchOrigin(request);
    return decorateMarkdownResponse(response, url, directCanonicalPath);
  }

  const mirrorPath = wantsMarkdown(request) ? markdownMirrorPath(url.pathname) : null;
  if (mirrorPath) {
    const mirrorUrl = new URL(request.url);
    mirrorUrl.pathname = mirrorPath;
    const mirrorRequest = new Request(mirrorUrl, request);
    const mirrorResponse = await fetchOrigin(mirrorRequest);
    if (mirrorResponse.status !== 404) {
      const canonicalPath = canonicalPathForMirror(mirrorPath);
      return canonicalPath ? decorateMarkdownResponse(mirrorResponse, mirrorUrl, canonicalPath) : mirrorResponse;
    }
  }

  const response = await fetchOrigin(request);
  return decorateHtmlResponse(response, url);
}

function decorateMarkdownResponse(response, requestUrl, canonicalPath) {
  const headers = new Headers(response.headers);
  if (response.ok) headers.set("content-type", MARKDOWN_CONTENT_TYPE);
  appendVary(headers, "Accept");
  if (canonicalPath) appendLink(headers, `<${new URL(canonicalPath, requestUrl.origin).href}>; rel="canonical"`);
  appendLink(headers, `<${new URL(LLMS_PATH, requestUrl.origin).href}>; rel="describedby"`);
  return cloneResponse(response, headers);
}

function decorateHtmlResponse(response, requestUrl) {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("text/html")) return response;

  const headers = new Headers(response.headers);
  appendVary(headers, "Accept");
  appendLink(headers, `<${new URL(LLMS_PATH, requestUrl.origin).href}>; rel="describedby"`);
  return cloneResponse(response, headers);
}

function appendVary(headers, value) {
  const existing = headers.get("vary");
  if (!existing) {
    headers.set("vary", value);
    return;
  }
  if (existing.trim() === "*") return;
  const values = existing.split(",").map((entry) => entry.trim().toLowerCase());
  if (!values.includes(value.toLowerCase())) headers.set("vary", `${existing}, ${value}`);
}

function appendLink(headers, value) {
  const existing = headers.get("link");
  if (!existing) {
    headers.set("link", value);
    return;
  }
  if (!existing.includes(value)) headers.set("link", `${existing}, ${value}`);
}

function cloneResponse(response, headers) {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  fetch(request) {
    return handleDocsEdgeRequest(request);
  },
};
