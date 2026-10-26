import { describe, expect, it } from "vitest";
import { readBoundedRemoteMcpForm } from "../../../apps/web/lib/remote-mcp-bounded-form.js";

const encoder = new TextEncoder();
const url = "https://boardreadyops.com/oauth/token";
function streamingRequest(
  parts: Uint8Array[],
  options: {
    contentLength?: string;
    onCancel?: () => void;
    error?: Error;
  } = {},
): Request {
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (options.error && index === parts.length) {
        controller.error(options.error);
        return;
      }
      if (index < parts.length) controller.enqueue(parts[index++] as Uint8Array);
      else controller.close();
    },
    cancel() {
      options.onCancel?.();
    },
  });
  return new Request(url, {
    method: "POST",
    body: stream,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(options.contentLength === undefined ? {} : { "content-length": options.contentLength }),
    },
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

describe("bounded remote MCP OAuth form ingestion", () => {
  it("reads exactly the allowed byte limit across stream chunks", async () => {
    const content = "x".repeat(2048);
    const parts = [encoder.encode(content.slice(0, 100)), encoder.encode(content.slice(100))];
    expect(await readBoundedRemoteMcpForm(streamingRequest(parts, { contentLength: "2048" }), 2048)).toBe(content);
  });

  it("cancels at first over-limit chunk and does not collect further bytes", async () => {
    let canceled = false;
    const request = streamingRequest(
      [encoder.encode("a".repeat(100)), encoder.encode("b".repeat(2049)), encoder.encode("should-not-be-read")],
      {
        onCancel: () => {
          canceled = true;
        },
      },
    );
    expect(await readBoundedRemoteMcpForm(request, 2048)).toBeNull();
    expect(canceled).toBe(true);
  });

  it("rejects invalid UTF-8 and underdeclared or untrusted Content-Length", async () => {
    expect(await readBoundedRemoteMcpForm(streamingRequest([new Uint8Array([255, 254])]), 4096)).toBeNull();
    expect(
      await readBoundedRemoteMcpForm(
        streamingRequest([encoder.encode("abc")], {
          contentLength: "2",
        }),
        4096,
      ),
    ).toBeNull();
    expect(
      await readBoundedRemoteMcpForm(
        streamingRequest([encoder.encode("abc")], {
          contentLength: "not-a-number",
        }),
        4096,
      ),
    ).toBeNull();
    expect(
      await readBoundedRemoteMcpForm(
        streamingRequest([encoder.encode("abc")], {
          contentLength: "4097",
        }),
        4096,
      ),
    ).toBeNull();
  });

  it("rejects empty, failed or already-consumed bodies", async () => {
    expect(await readBoundedRemoteMcpForm(streamingRequest([]), 2048)).toBeNull();
    expect(
      await readBoundedRemoteMcpForm(
        streamingRequest([encoder.encode("abc")], {
          error: new Error("network interrupted"),
        }),
        2048,
      ),
    ).toBeNull();
    const request = streamingRequest([encoder.encode("abc")]);
    await request.text();
    expect(await readBoundedRemoteMcpForm(request, 2048)).toBeNull();
  });

  it("rejects invalid byte caps without touching request content", async () => {
    const request = streamingRequest([encoder.encode("valid")]);
    for (const bound of [0, -1, Number.NaN, 0.5, 16_385]) {
      expect(await readBoundedRemoteMcpForm(request, bound)).toBeNull();
    }
    expect(request.bodyUsed).toBe(false);
  });
});
