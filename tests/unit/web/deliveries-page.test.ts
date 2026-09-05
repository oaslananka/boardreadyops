/**
 * @vitest-environment happy-dom
 */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import DeliveriesListPage from "../../../apps/web/app/deliveries/page.js";
import { DeliverySignoffCard } from "../../../apps/web/components/delivery-signoff-card.js";

describe("DeliverySignoffCard", () => {
  type TestElement = {
    textContent: string | null;
    getAttribute(name: string): string | null;
  };
  type TestContainer = {
    querySelector(selector: string): TestElement | null;
    remove(): void;
  };
  type TestRuntime = {
    document: { body: { append(child: unknown): void }; createElement(tag: string): unknown };
  };

  let container: TestContainer;
  let root: Root;
  const runtime = globalThis as unknown as TestRuntime & { IS_REACT_ACT_ENVIRONMENT?: boolean };

  beforeEach(() => {
    container = runtime.document.createElement("div") as TestContainer;
    runtime.document.body.append(container);
    root = createRoot(container as unknown as Parameters<typeof createRoot>[0]);
    runtime.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete runtime.IS_REACT_ACT_ENVIRONMENT;
  });

  it("renders cryptographic revision digest SHA-256 and readiness verdict", async () => {
    await act(async () => {
      root.render(
        createElement(DeliverySignoffCard, {
          revisionId: "rev_20260905_a1",
          bundleSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          readinessVerdict: "pass",
          readinessScore: 95,
          waiverCount: 1,
          signedArchiveUrl: "https://storage.boardreadyops.com/bundles/release-v2.zip",
          signedBy: "Jane Doe (Lead Hardware Engineer)",
          signedAt: "2026-09-05T01:00:00Z",
          expiresAt: "2026-10-05T01:00:00Z",
        }),
      );
    });

    const text = container.querySelector(".delivery-signoff-card")?.textContent;
    expect(text).toContain("rev_20260905_a1");
    expect(text).toContain("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(text).toContain("PASS");
    expect(text).toContain("1 active waiver");
    expect(text).toContain("Jane Doe (Lead Hardware Engineer)");
  });

  it("does not certify a delivery without review and sign-off evidence", async () => {
    await act(async () => {
      root.render(
        createElement(DeliverySignoffCard, {
          revisionId: "rev_unverified",
          signedArchiveUrl: "https://example.com/package.zip",
          expiresAt: "2026-10-05T01:00:00Z",
        }),
      );
    });
    const text = container.querySelector(".delivery-signoff-card")?.textContent;
    expect(text).toContain("UNVERIFIED");
    expect(text).toContain("Sign-off not recorded");
    expect(text).toContain("Waivers not evaluated");
    expect(text).not.toContain("Verified Manufacturing Package");
    expect(text).not.toContain("Engineering Auto-Verified");
    expect(text).not.toContain("Sealed Package");
  });

  it("provides a sender-supplied package link without certifying its contents", async () => {
    await act(async () => {
      root.render(
        createElement(DeliverySignoffCard, {
          revisionId: "rev_20260905_a1",
          bundleSha256: "abc123sha256",
          signedArchiveUrl: "https://storage.boardreadyops.com/bundles/release-v2.zip",
          expiresAt: "2026-10-05T01:00:00Z",
        }),
      );
    });

    const downloadLink = container.querySelector(".download-bundle-button");
    expect(downloadLink).not.toBeNull();
    expect(downloadLink?.getAttribute("href")).toBe("https://storage.boardreadyops.com/bundles/release-v2.zip");
    expect(downloadLink?.getAttribute("download")).toBeDefined();
  });
});

describe("DeliveriesListPage", () => {
  it("renders Deliveries overview page", () => {
    const markup = renderToStaticMarkup(createElement(DeliveriesListPage));
    expect(markup).toContain("Release Deliveries");
    expect(markup).toContain("Fabrication Handoff");
  });
});
