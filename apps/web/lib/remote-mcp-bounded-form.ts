/**
 * Consume a small OAuth form without ever buffering an unbounded request.
 * Content-Length is only an early rejection hint; missing or forged smaller
 * lengths are not authoritative. Invalid UTF-8 and incomplete bodies fail
 * closed rather than silently replacing bytes inside OAuth parameters.
 *
 * The ingress proxy must separately enforce total request/connection timeouts.
 */
export async function readBoundedRemoteMcpForm(request: Request, maxBytes: number): Promise<string | null> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 16_384) return null;
  const advertised = request.headers.get("content-length");
  if (advertised !== null && (!/^(0|[1-9][0-9]*)$/u.test(advertised) || Number(advertised) > maxBytes)) {
    return null;
  }
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    if (!request.body) return null;
    reader = request.body.getReader();
  } catch {
    return null;
  }
  let total = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) return null;
      total += value.byteLength;
      if (total > maxBytes) {
        // Do not wait for the untrusted stream's cancel hook before denying.
        void reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
    if (total === 0 || (advertised !== null && total !== Number(advertised))) return null;
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    void reader.cancel().catch(() => undefined);
    return null;
  } finally {
    reader.releaseLock();
  }
}
