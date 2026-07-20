import { describe, expect, it } from "vitest";
import { RequestBodyTooLargeError, readBoundedRequestBody } from "../../../apps/web/lib/bounded-request-body.js";

describe("bounded request body", () => {
  it("rejects a declared oversized body before reading it", async () => {
    const request = new Request("https://boardreadyops.test/webhook", {
      method: "POST",
      headers: { "content-length": "11" },
      body: "small",
    });

    await expect(readBoundedRequestBody(request, 10)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });

  it("returns the exact bytes used for signature verification", async () => {
    const request = new Request("https://boardreadyops.test/webhook", {
      method: "POST",
      body: Buffer.from([0x7b, 0x7d]),
    });

    await expect(readBoundedRequestBody(request, 10)).resolves.toEqual(Buffer.from("{}"));
  });
});
