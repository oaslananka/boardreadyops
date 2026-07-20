export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("request body exceeded the configured byte limit");
    this.name = "RequestBodyTooLargeError";
  }
}

export async function readBoundedRequestBody(request: Request, maximumBytes: number): Promise<Buffer> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && /^\d+$/u.test(contentLength) && Number(contentLength) > maximumBytes) {
    throw new RequestBodyTooLargeError();
  }

  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel();
        throw new RequestBodyTooLargeError();
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, bytes);
}
