import { describe, expect, it, vi } from "vitest";
import {
  isRecordedArchivePreviewUrl,
  loadRecordedArchiveForPreview,
} from "../../../apps/web/components/manufacturing-archive-preview-fetch.js";

const runId = "run-1";
const source = "https://boardreadyops.example";
const direct = `${source}/api/v1/runs/${runId}/artifacts/11111111-1111-4111-8111-111111111111/download?exp=123&sig=test`;
const bytes = new Uint8Array([31, 139, 8, 0, 1, 2, 3, 4]);

describe("first-party manufacturing archive preview download", () => {
  it("previews recorded same-origin root-relative download URLs without file re-selection", async () => {
    const relative = direct.slice(source.length);
    expect(isRecordedArchivePreviewUrl(relative, runId)).toBe(true);
    const request = vi.fn(async () => new Response(bytes));
    const archive = await loadRecordedArchiveForPreview(relative, runId, bytes.byteLength, source, request);
    expect(request).toHaveBeenCalledWith(relative, { credentials: "same-origin", cache: "no-store" });
    expect(new Uint8Array(await archive.arrayBuffer())).toEqual(bytes);
  });

  it("rejects protocol-relative or deceptive non-rooted download URLs before fetching", async () => {
    const relative = direct.slice(source.length);
    const request = vi.fn();
    for (const candidate of [
      `//other.example${relative}`,
      `/${String.fromCharCode(92)}other.example${relative}`,
      relative.slice(1),
    ]) {
      expect(isRecordedArchivePreviewUrl(candidate, runId)).toBe(false);
      await expect(loadRecordedArchiveForPreview(candidate, runId, bytes.byteLength, source, request)).rejects.toThrow(
        "not eligible",
      );
    }
    expect(request).not.toHaveBeenCalled();
  });

  it("recognizes only recorded download paths for the exact run", () => {
    expect(isRecordedArchivePreviewUrl(direct, runId)).toBe(true);
    expect(isRecordedArchivePreviewUrl("https://github.com/octo/board/actions/runs/123/artifacts/5", runId)).toBe(
      false,
    );
    expect(isRecordedArchivePreviewUrl(direct, "another-run")).toBe(false);
    expect(isRecordedArchivePreviewUrl(direct.replace("/download?", "/other?"), runId)).toBe(false);
  });

  it("streams an authorized gzip response after the explicit request and bounds it to the recorded length", async () => {
    const request = vi.fn(
      async () =>
        new Response(bytes, {
          status: 200,
          headers: { "content-length": String(bytes.byteLength), "content-type": "application/gzip" },
        }),
    );
    const archive = await loadRecordedArchiveForPreview(direct, runId, bytes.byteLength, source, request);
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(direct, { credentials: "same-origin", cache: "no-store" });
    expect(new Uint8Array(await archive.arrayBuffer())).toEqual(bytes);
  });

  it("does not request arbitrary origins, unrelated runs or impossible expected sizes", async () => {
    const request = vi.fn();
    await expect(
      loadRecordedArchiveForPreview(direct, runId, bytes.byteLength, "https://other.example", request),
    ).rejects.toThrow("not eligible");
    await expect(loadRecordedArchiveForPreview(direct, "other-run", bytes.byteLength, source, request)).rejects.toThrow(
      "not eligible",
    );
    await expect(loadRecordedArchiveForPreview(direct, runId, 0, source, request)).rejects.toThrow("not eligible");
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects an excessive content-length before reading bytes", async () => {
    const request = vi.fn(
      async () =>
        new Response(bytes, {
          headers: { "content-length": "1000000" },
        }),
    );
    await expect(loadRecordedArchiveForPreview(direct, runId, bytes.byteLength, source, request)).rejects.toThrow(
      "exceeds",
    );
  });

  it("rejects streaming bytes larger or smaller than the recorded archive", async () => {
    const tooLarge = vi.fn(async () => new Response(new Uint8Array(10)));
    await expect(loadRecordedArchiveForPreview(direct, runId, bytes.byteLength, source, tooLarge)).rejects.toThrow(
      "exceeds",
    );
    const tooSmall = vi.fn(async () => new Response(new Uint8Array(4)));
    await expect(loadRecordedArchiveForPreview(direct, runId, bytes.byteLength, source, tooSmall)).rejects.toThrow(
      "does not match",
    );
  });

  it("keeps expired or browser-blocked archives unverified for local reinspection", async () => {
    const expired = vi.fn(async () => new Response(null, { status: 410 }));
    await expect(loadRecordedArchiveForPreview(direct, runId, bytes.byteLength, source, expired)).rejects.toThrow(
      "expired or unavailable",
    );
    const corsBlocked = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(loadRecordedArchiveForPreview(direct, runId, bytes.byteLength, source, corsBlocked)).rejects.toThrow(
      "Download it and select the file",
    );
  });
});
