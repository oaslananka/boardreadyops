import { consumeAuthorizedSealedLocalExportArchiveChunks } from "./data-export-local-archive.js";

type PrivateArchiveInput = Parameters<typeof consumeAuthorizedSealedLocalExportArchiveChunks>[0];

/**
 * INTERNAL Web Streams bridge for a future Next.js Response body.
 *
 * The stream uses zero prefetch: a live reader pull acknowledges each bounded
 * chunk, and the final pull acknowledges end-of-stream. The PostgreSQL
 * revocation fence stays held until that end pull. Reader cancellation or a
 * deadline rejects a pending pull explicitly, unlike aborting a backpressured
 * TransformStream writer (which can remain suspended indefinitely).
 *
 * This does not authenticate an HTTP user, prove network receipt or publish a
 * customer download. The future route must bind session and storage first.
 */
export function createAuthorizedSealedLocalExportWebStream(
  input: PrivateArchiveInput & { signal?: AbortSignal },
  deadlineMs = 25_000,
): { body: ReadableStream<Uint8Array>; completed: Promise<boolean> } {
  if (!input?.db?.withTransaction || !Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 25_000)
    throw new Error("Invalid private ZIP stream request");

  const aborted = new AbortController();
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let demand = 0;
  let pendingPull: { resolve: () => void; reject: (reason: Error) => void } | undefined;

  const stop = () => {
    if (aborted.signal.aborted) return;
    aborted.abort();
    pendingPull?.reject(new Error("Private ZIP stream cancelled"));
    pendingPull = undefined;
    demand = 0;
    try {
      controller?.error(new Error("Private ZIP stream cancelled"));
    } catch {
      // A cancelled or already closed stream has no further consumer.
    }
  };
  const onExternalAbort = () => stop();
  input.signal?.addEventListener("abort", onExternalAbort, { once: true });
  const deadline = setTimeout(stop, deadlineMs);

  function nextPull(): Promise<void> {
    if (aborted.signal.aborted) return Promise.reject(new Error("Private ZIP stream cancelled"));
    if (demand > 0) {
      demand--;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      pendingPull = { resolve, reject };
    });
  }

  const body = new ReadableStream<Uint8Array>(
    {
      start(source) {
        controller = source;
      },
      pull() {
        if (aborted.signal.aborted) return;
        if (pendingPull) {
          const waiting = pendingPull;
          pendingPull = undefined;
          waiting.resolve();
        } else {
          demand++;
        }
      },
      cancel() {
        stop();
      },
    },
    { highWaterMark: 0 },
  );

  if (input.signal?.aborted) stop();

  const completed = (async (): Promise<boolean> => {
    try {
      const succeeded = await consumeAuthorizedSealedLocalExportArchiveChunks(
        { ...input, signal: aborted.signal },
        async (chunk) => {
          for (let offset = 0; offset < chunk.byteLength; offset += 1024) {
            await nextPull();
            if (aborted.signal.aborted) throw new Error("Private ZIP stream cancelled");
            controller.enqueue(Uint8Array.from(chunk.subarray(offset, offset + 1024)));
          }
        },
        async () => {
          await nextPull();
          if (aborted.signal.aborted) throw new Error("Private ZIP stream cancelled");
          controller.close();
        },
      );
      if (!succeeded) stop();
      return succeeded && !aborted.signal.aborted;
    } catch {
      stop();
      return false;
    } finally {
      clearTimeout(deadline);
      input.signal?.removeEventListener("abort", onExternalAbort);
    }
  })();
  return { body, completed };
}
