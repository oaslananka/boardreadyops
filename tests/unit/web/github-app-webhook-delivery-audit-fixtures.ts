export const time = "2026-11-12T06:00:00Z";
export const guidA = "00000000-0000-4000-8000-000000000001";
export const guidB = "00000000-0000-4000-8000-000000000002";
export const guidC = "00000000-0000-4000-8000-000000000003";
export function delivery(id: number, guid: string, code: number, at = time) {
  return {
    id,
    guid,
    statusCode: code,
    status_code: code,
    status: code >= 200 && code < 300 ? "OK" : "failed",
    delivered_at: at,
  };
}
export function mockResponse(rows: unknown[], next?: string) {
  return new Response(JSON.stringify(rows), {
    status: 200,
    headers: { ...(next ? { link: `<${next}>; rel="next"` } : {}), "content-type": "application/json" },
  });
}
