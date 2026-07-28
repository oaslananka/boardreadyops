export function controlPlaneJsonResponse(
  value: unknown,
  status: number,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

export function controlPlaneJsonError(
  error: string,
  status: number,
  headers?: Readonly<Record<string, string>>,
): Response {
  return controlPlaneJsonResponse({ ok: false, error }, status, headers);
}
