export function wantsMarkdown(request: Request): boolean;
export function markdownMirrorPath(pathname: string): string | null;
export function canonicalPathForMirror(pathname: string): string | null;
export function handleDocsEdgeRequest(
  request: Request,
  fetchOrigin?: (input: Request | URL | string, init?: RequestInit) => Promise<Response>,
): Promise<Response>;

declare const worker: {
  fetch(request: Request): Promise<Response>;
};

export default worker;
