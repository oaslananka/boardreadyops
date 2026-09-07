/**
 * @vitest-environment happy-dom
 */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeliverySignoffCard } from "../../../apps/web/components/delivery-signoff-card.js";

vi.mock("../../../apps/web/lib/viewer-authorization.js", () => ({
  viewerAuthorization: vi.fn(async () => ({ session: { login: "octocat", installationIds: [] } })),
}));

// The page reads the request origin so the copied guest link is a URL, not a bare path.
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map([["host", "boardreadyops.test"]])),
}));

const loadWorkspaceDeliveries = vi.hoisted(() => vi.fn());
vi.mock("../../../apps/web/lib/delivery-listing.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadWorkspaceDeliveries,
}));

const { default: DeliveriesListPage } = await import("../../../apps/web/app/deliveries/page.js");

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

/**
 * The page is an async server component now, so it is awaited rather than rendered synchronously.
 * What is worth asserting is the shape of each state: a guest link is a public URL, so "there are
 * none" and "you cannot see any" must never be the same screen.
 */
describe("DeliveriesListPage", () => {
  async function render(): Promise<string> {
    return renderToStaticMarkup(await DeliveriesListPage({ searchParams: Promise.resolve({}) }));
  }

  const workspace = {
    id: "ws_a",
    name: "Acme Hardware",
    slug: "acme",
    planTier: "team" as const,
    createdAt: "2026-09-01T00:00:00.000Z",
    role: "owner" as const,
  };

  it("lists a live link with what it points at", async () => {
    loadWorkspaceDeliveries.mockResolvedValue({
      state: "ok",
      workspaces: [workspace],
      selected: workspace,
      revisions: [{ id: "rev_a", projectName: "Gateway board", revisionLabel: "rev C" }],
      deliveries: [
        {
          id: "del_a",
          revisionId: "rev_a",
          revisionLabel: "rev C",
          projectId: "prj_a",
          projectName: "Gateway board",
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          signedArchiveUrl: "https://storage.example.com/gateway.zip",
          recipientNotes: "Panelised, 2oz copper",
          createdAt: "2026-09-07T00:00:00.000Z",
        },
      ],
    });

    const markup = await render();
    expect(markup).toContain("Release Deliveries");
    expect(markup).toContain("gateway.zip");
    expect(markup).toContain("Panelised, 2oz copper");
    expect(markup).toContain("Live");
  });

  it("marks a link whose window has closed rather than showing it as live", async () => {
    loadWorkspaceDeliveries.mockResolvedValue({
      state: "ok",
      workspaces: [workspace],
      selected: workspace,
      revisions: [],
      deliveries: [
        {
          id: "del_old",
          revisionId: "rev_a",
          revisionLabel: "rev C",
          projectId: "prj_a",
          projectName: "Gateway board",
          expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
          signedArchiveUrl: "https://storage.example.com/old.zip",
          createdAt: "2026-09-01T00:00:00.000Z",
        },
      ],
    });

    const markup = await render();
    expect(markup).toContain("Expired");
  });

  it("says why there is nothing to share instead of offering an empty picker", async () => {
    loadWorkspaceDeliveries.mockResolvedValue({
      state: "ok",
      workspaces: [workspace],
      selected: workspace,
      revisions: [],
      deliveries: [],
    });

    const markup = await render();
    expect(markup).toContain("No revisions to share yet");
    // The form would be a control that cannot succeed, so it is absent rather than disabled.
    expect(markup).not.toContain("Create guest link");
  });

  it("offers no create form to a viewer, who is refused server-side anyway", async () => {
    loadWorkspaceDeliveries.mockResolvedValue({
      state: "ok",
      workspaces: [{ ...workspace, role: "viewer" as const }],
      selected: { ...workspace, role: "viewer" as const },
      revisions: [{ id: "rev_a", projectName: "Gateway board", revisionLabel: "rev C" }],
      deliveries: [],
    });

    const markup = await render();
    expect(markup).not.toContain("Share a package");
  });

  it("distinguishes signed out from empty", async () => {
    loadWorkspaceDeliveries.mockResolvedValue({ state: "signed-out" });
    const markup = await render();

    expect(markup).toContain("Sign in to see your delivery links");
    expect(markup).not.toContain("No guest links yet");
  });

  it("says the deployment has no database rather than implying nothing was shared", async () => {
    loadWorkspaceDeliveries.mockResolvedValue({ state: "not-configured" });
    const markup = await render();

    expect(markup).toContain("Deliveries are not configured");
  });
});
