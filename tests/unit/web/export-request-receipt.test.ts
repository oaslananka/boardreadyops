/**
 * @vitest-environment happy-dom
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExportRequestReceipt } from "../../../apps/web/components/settings/export-request-receipt.js";

const issue = { exportId: "f847a9a5-0dfa-48a9-aa78-5a4d9b725561", status: "pending" };
const url = `/api/v1/data-exports/${issue.exportId}?installationId=inst-a`;
let root: Root;
let container: HTMLDivElement;
const oldFetch = globalThis.fetch;
const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");

async function click(label: string): Promise<void> {
  const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes(label));
  if (!button) throw new Error(`Missing button ${label}`);
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
}

describe("Data & Retention export request receipt", () => {
  beforeEach(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(ExportRequestReceipt, { issued: issue, installationId: "inst-a" }));
    });
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    globalThis.fetch = oldFetch;
    vi.restoreAllMocks();
    if (originalCreateObjectURL) Object.defineProperty(URL, "createObjectURL", originalCreateObjectURL);
    else Reflect.deleteProperty(URL, "createObjectURL");
    if (originalRevokeObjectURL) Object.defineProperty(URL, "revokeObjectURL", originalRevokeObjectURL);
    else Reflect.deleteProperty(URL, "revokeObjectURL");
    vi.unstubAllGlobals();
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it("shows scope limitations and all controls without submitting a new export", () => {
    expect(container.textContent).toContain(issue.exportId);
    expect(container.textContent).toContain("does not create a customer archive");
    expect(container.textContent).toContain("15 minutes");
    expect(container.querySelectorAll('button[type="button"]')).toHaveLength(3);
    expect(container.textContent).not.toContain("Full export ready");
  });

  it("refreshes only the recorded request with no-store and session credentials", async () => {
    const fetch = vi.fn(async () => Response.json({ ok: true, export: { status: "running" } }));
    globalThis.fetch = fetch as typeof globalThis.fetch;
    await click("Refresh request status");
    expect(fetch).toHaveBeenCalledWith(url, { cache: "no-store", credentials: "same-origin" });
    expect(container.textContent).toContain("Request status refreshed");
    expect(container.textContent).toContain("not confirmation of a completed customer export");
  });

  it("fails closed for unavailable metadata previews without triggering file download", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 404 }));
    globalThis.fetch = fetch as typeof globalThis.fetch;
    await click("Download metadata preview");
    expect(fetch).toHaveBeenCalledWith(`${url}&download=metadata-manifest`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    expect(container.textContent).toContain("not published, has expired, or has been revoked");
  });

  it("downloads only after the authorized endpoint returns bounded bytes", async () => {
    const bytes = new Blob(['{"kind":"boardreadyops.repository-metadata-export"}'], { type: "application/json" });
    globalThis.fetch = vi.fn(
      async () => new Response(bytes, { status: 200, headers: { "content-type": "application/json" } }),
    ) as typeof globalThis.fetch;
    const createObjectURL = vi.fn(() => "blob:local-only");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    const clickDownload = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await click("Download metadata preview");
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:local-only");
    expect(clickDownload).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("not your full customer data archive");
    const feedback = container.querySelector('[role="status"]');
    expect(feedback).not.toBeNull();
  });

  it("keeps error and malformed status reads from claiming successful delivery", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(Response.json({ ok: true, export: {} }))
      .mockRejectedValueOnce(new Error("offline"));
    globalThis.fetch = fetch as typeof globalThis.fetch;
    await click("Refresh request status");
    expect(container.textContent).toContain("Check your installation access");
    await click("Refresh request status");
    expect(container.textContent).toContain("response was incomplete");
    await click("Refresh request status");
    expect(container.textContent).toContain("Unable to refresh status");
  });

  it("rejects unexpected HTML, empty or oversized metadata instead of initiating download", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("<html>login</html>", { headers: { "content-type": "text/html" } }))
      .mockResolvedValueOnce(new Response("", { headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(
        new Response(new Blob([new Uint8Array(65537)]), { headers: { "content-type": "application/json" } }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockRejectedValueOnce(new Error("offline"));
    globalThis.fetch = fetch as typeof globalThis.fetch;
    await click("Download metadata preview");
    expect(container.textContent).toContain("did not return a metadata JSON");
    await click("Download metadata preview");
    expect(container.textContent).toContain("size was invalid");
    await click("Download metadata preview");
    expect(container.textContent).toContain("size was invalid");
    await click("Download metadata preview");
    expect(container.textContent).toContain("unavailable for your current account");
    await click("Download metadata preview");
    expect(container.textContent).toContain("Unable to download");
  });

  it("does not claim a revoked preview when the server rejects or cannot be reached", async () => {
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockRejectedValueOnce(new Error("offline"));
    globalThis.fetch = fetch as typeof globalThis.fetch;
    await click("Revoke metadata preview");
    expect(container.textContent).toContain("No active metadata preview");
    await click("Revoke metadata preview");
    expect(container.textContent).toContain("Unable to revoke");
    const download = [...container.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("Download metadata preview"),
    );
    expect(download?.disabled).toBe(false);
  });

  it("requires explicit confirmation and uses same-origin requester revocation", async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    const fetch = vi.fn(async () => Response.json({ ok: true, revoked: true }));
    globalThis.fetch = fetch as typeof globalThis.fetch;
    await click("Revoke metadata preview");
    expect(fetch).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await click("Revoke metadata preview");
    expect(fetch).toHaveBeenCalledWith(url, { method: "DELETE", cache: "no-store", credentials: "same-origin" });
    expect(container.textContent).toContain("access revoked");
    expect(
      Array.from(container.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("Download metadata preview"),
      )?.disabled,
    ).toBe(true);
  });
});
