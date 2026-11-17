/**
 * Fetch a recorded first-party manufacturing archive only after an explicit user action.
 * The first-party download route rechecks authorization and may redirect to the
 * temporary private object URL. No token is sent to an arbitrary URL by this UI.
 */
const maxPreviewBytes = 32 * 1024 * 1024;
const downloadPathSuffix = "/download";

export function isRecordedArchivePreviewUrl(url: string | undefined, runId: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const prefix = `/api/v1/runs/${encodeURIComponent(runId)}/artifacts/`;
    if (!["https:", "http:"].includes(parsed.protocol) || !parsed.pathname.startsWith(prefix)) return false;
    if (!parsed.pathname.endsWith(downloadPathSuffix)) return false;
    const artifactId = parsed.pathname.slice(prefix.length, -downloadPathSuffix.length);
    return /^[a-f0-9-]{36}$/iu.test(artifactId) && !parsed.username && !parsed.password && !parsed.hash;
  } catch {
    return false;
  }
}

export async function loadRecordedArchiveForPreview(
  url: string,
  runId: string,
  expectedBytes: number,
  pageOrigin: string,
  request: typeof fetch = fetch,
): Promise<Blob> {
  if (
    !isRecordedArchivePreviewUrl(url, runId) ||
    new URL(url).origin !== pageOrigin ||
    !Number.isSafeInteger(expectedBytes) ||
    expectedBytes <= 0 ||
    expectedBytes > maxPreviewBytes
  ) {
    throw new Error("This archive is not eligible for a first-party browser preview. Select a downloaded copy below.");
  }

  // No automatic request on page load. Do not send first-party credentials to
  // cross-origin redirect destinations; the object URL must support CORS.
  let response: Response;
  try {
    response = await request(url, { credentials: "same-origin", cache: "no-store" });
  } catch {
    throw new Error("The archive could not be read in this browser. Download it and select the file below.");
  }
  if (!response.ok) {
    throw new Error("The signed archive download is expired or unavailable. Select an already downloaded copy below.");
  }
  const header = response.headers.get("content-length");
  if (header && (!/^\d+$/u.test(header) || Number(header) > expectedBytes)) {
    throw new Error("The archive exceeds its recorded size. No preview was accepted.");
  }
  if (!response.body) {
    throw new Error("This browser cannot stream the archive. Download the file and select it below.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > expectedBytes) {
        await reader.cancel();
        throw new Error("The archive exceeds its recorded size. No preview was accepted.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (size !== expectedBytes) {
    throw new Error("The downloaded archive size does not match this Run's evidence.");
  }
  const copy = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    copy.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Blob([copy.buffer], { type: "application/gzip" });
}
