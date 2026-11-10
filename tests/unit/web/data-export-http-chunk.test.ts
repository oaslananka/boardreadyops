import { EventEmitter } from "node:events";
import { createServer, get, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import {
  finishPrivateExportHttpResponse,
  writePrivateExportHttpChunk,
} from "../../../apps/web/lib/data-export-http-chunk.js";

class PendingHttpSink extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  writes = 0;

  write(_chunk: Buffer, _callback: (error?: Error | null) => void): boolean {
    this.writes++;
    // Simulate an unresponsive socket: never acknowledge any queued bytes.
    return false;
  }

  end(): this {
    // Simulate a response whose finish event never fires.
    return this;
  }

  destroy(): this {
    this.destroyed = true;
    this.emit("close");
    return this;
  }
}

describe("internal, nonpublic ZIP HTTP sink", () => {
  it("acknowledges a real localhost HTTP socket write, including drain/backpressure", async () => {
    const payload = Buffer.alloc(16 * 1024, 0x41);
    const server = createServer((_request, response) => {
      void (async () => {
        try {
          await writePrivateExportHttpChunk(response, payload);
          response.end();
        } catch {
          response.destroy();
        }
      })();
    });
    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address() as AddressInfo;
      const actual = await new Promise<Buffer>((resolve, reject) => {
        const request = get(`http://127.0.0.1:${address.port}/internal-test`, (response) => {
          const parts: Buffer[] = [];
          response.on("data", (chunk: Buffer) => parts.push(chunk));
          response.once("end", () => resolve(Buffer.concat(parts)));
          response.once("error", reject);
        });
        request.once("error", reject);
      });
      expect(actual).toEqual(payload);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 8000);

  it("waits for Node HTTP finish before reporting a completed response", async () => {
    const server = createServer((_request, response) => {
      void (async () => {
        try {
          await writePrivateExportHttpChunk(response, Buffer.from("private-test"));
          await finishPrivateExportHttpResponse(response);
        } catch {
          response.destroy();
        }
      })();
    });
    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address() as AddressInfo;
      const data = await new Promise<Buffer>((resolve, reject) => {
        const request = get(`http://127.0.0.1:${address.port}/finish-test`, (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.once("end", () => resolve(Buffer.concat(chunks)));
          response.once("error", reject);
        });
        request.once("error", reject);
      });
      expect(data.toString()).toBe("private-test");
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 8000);

  it("closes a stuck response before reporting finish deadline exceeded", async () => {
    const response = new PendingHttpSink();
    await expect(finishPrivateExportHttpResponse(response as unknown as ServerResponse, undefined, 15)).rejects.toThrow(
      /ZIP transport/u,
    );
    expect(response.destroyed).toBe(true);
  });

  it("destroys a still-pending HTTP finish when its cancellation signal fires", async () => {
    const response = new PendingHttpSink();
    const controller = new AbortController();
    const pending = finishPrivateExportHttpResponse(response as unknown as ServerResponse, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow(/ZIP transport/u);
    expect(response.destroyed).toBe(true);
  });

  it("destroys a stalled response before releasing its pending write", async () => {
    const response = new PendingHttpSink();
    await expect(
      writePrivateExportHttpChunk(response as unknown as ServerResponse, new Uint8Array(100), undefined, 20),
    ).rejects.toThrow(/ZIP transport/u);
    expect(response.destroyed).toBe(true);
    expect(response.writes).toBe(1);
  });

  it("destroys an in-flight socket write on AbortSignal before settling", async () => {
    const response = new PendingHttpSink();
    const controller = new AbortController();
    const pending = writePrivateExportHttpChunk(
      response as unknown as ServerResponse,
      new Uint8Array(100),
      controller.signal,
      2_000,
    );
    controller.abort();
    await expect(pending).rejects.toThrow(/ZIP transport/u);
    expect(response.destroyed).toBe(true);
    expect(response.writes).toBe(1);
  });

  it("destroys a transport on a failed write callback before releasing the pending request", async () => {
    const response = new PendingHttpSink();
    response.write = (_chunk, callback) => {
      response.writes++;
      queueMicrotask(() => callback(new Error("synthetic write failure")));
      return true;
    };
    await expect(
      writePrivateExportHttpChunk(response as unknown as ServerResponse, new Uint8Array(16)),
    ).rejects.toThrow(/ZIP transport/u);
    expect(response.destroyed).toBe(true);
    expect(response.writes).toBe(1);
  });

  it("refuses oversized, empty and already-aborted writes without contacting the sink", async () => {
    const response = new PendingHttpSink();
    const controller = new AbortController();
    controller.abort();
    await expect(writePrivateExportHttpChunk(response as unknown as ServerResponse, new Uint8Array())).rejects.toThrow(
      "Invalid ZIP transport write",
    );
    await expect(
      writePrivateExportHttpChunk(response as unknown as ServerResponse, new Uint8Array(16 * 1024 + 1)),
    ).rejects.toThrow("Invalid ZIP transport write");
    await expect(
      writePrivateExportHttpChunk(response as unknown as ServerResponse, new Uint8Array(5), controller.signal),
    ).rejects.toThrow("ZIP transport closed");
    expect(response.writes).toBe(0);
    expect(response.destroyed).toBe(false);
  });
});
