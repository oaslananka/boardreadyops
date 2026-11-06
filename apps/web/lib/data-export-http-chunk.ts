import type { ServerResponse } from "node:http";

/**
 * Internal Node HTTP byte-sink; NOT an authenticated download route.
 *
 * A bounded write resolves only after Node's write callback and any drain
 * acknowledgement. A disconnect, AbortSignal or stalled write destroys the
 * response before rejecting, so the caller may safely roll back its
 * PostgreSQL read-admission transaction. Never race this against a detached
 * write promise: no database lock may be released while transport could send.
 */
export async function writePrivateExportHttpChunk(
  response: ServerResponse,
  chunk: Uint8Array,
  signal?: AbortSignal,
  timeoutMs = 10_000,
): Promise<void> {
  if (
    !response ||
    !chunk ||
    chunk.byteLength < 1 ||
    chunk.byteLength > 16 * 1024 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 25_000
  ) {
    throw new Error("Invalid ZIP transport write");
  }
  if (response.destroyed || response.writableEnded || signal?.aborted) throw new Error("ZIP transport closed");
  await new Promise<void>((resolve, reject) => {
    let finished = false;
    let flushed = false;
    let drained = false;
    const cleanup = () => {
      clearTimeout(timeout);
      response.off("close", onClose);
      response.off("error", onError);
      response.off("drain", onDrain);
      signal?.removeEventListener("abort", onAbort);
    };
    const settle = (error?: Error) => {
      if (finished) return;
      finished = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onClose = () => settle(new Error("ZIP transport closed"));
    const onError = () => {
      response.destroy();
      settle(new Error("ZIP transport failed"));
    };
    const onAbort = () => {
      response.destroy();
      settle(new Error("ZIP transport aborted"));
    };
    const onDrain = () => {
      drained = true;
      if (flushed && !response.destroyed) settle();
    };
    const timeout = setTimeout(() => {
      response.destroy();
      settle(new Error("ZIP transport write deadline exceeded"));
    }, timeoutMs);
    response.once("close", onClose);
    response.once("error", onError);
    response.on("drain", onDrain);
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const accepted = response.write(Buffer.from(chunk), (error?: Error | null) => {
        if (error) {
          response.destroy();
          settle(new Error("ZIP transport failed"));
          return;
        }
        flushed = true;
        if (drained && !response.destroyed) settle();
      });
      drained = accepted;
      if (flushed && drained && !response.destroyed) settle();
      if (signal?.aborted && !finished) onAbort();
    } catch {
      response.destroy();
      settle(new Error("ZIP transport failed"));
    }
  });
}

/**
 * Close a bounded internal Node HTTP ZIP response *inside* the transaction
 * that holds its revocation fence. Node's "finish" means data handed to the
 * OS for transmission, NOT independently confirmed delivery to the peer.
 *
 * Socket disconnect, callback error, abort or deadline destroys the sink
 * before rejecting. A response is not reusable after a failed finish.
 */
export async function finishPrivateExportHttpResponse(
  response: ServerResponse,
  signal?: AbortSignal,
  timeoutMs = 10_000,
): Promise<void> {
  if (!response || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 25_000)
    throw new Error("Invalid ZIP response finish");
  if (response.destroyed || response.writableEnded || signal?.aborted) {
    throw new Error("ZIP transport closed");
  }
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      response.off("finish", onFinish);
      response.off("close", onClose);
      response.off("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const fail = (reason: string) => {
      response.destroy();
      settle(new Error(reason));
    };
    const onFinish = () => settle();
    const onClose = () => settle(new Error("ZIP transport closed"));
    const onError = () => fail("ZIP transport failed");
    const onAbort = () => fail("ZIP transport aborted");
    const timer = setTimeout(() => fail("ZIP transport finish deadline exceeded"), timeoutMs);
    response.once("finish", onFinish);
    response.once("close", onClose);
    response.once("error", onError);
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      response.end();
      if (signal?.aborted && !settled) onAbort();
    } catch {
      fail("ZIP transport failed");
    }
  });
}
