/**
 * @vitest-environment happy-dom
 */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectUploadWizard } from "../../../apps/web/components/project-upload-wizard.js";

describe("ProjectUploadWizard", () => {
  let container: HTMLDivElement;
  let root: Root;
  const runtime = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    runtime.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete runtime.IS_REACT_ACT_ENVIRONMENT;
  });

  it("labels unavailable upload before click and keeps supported sources visible", async () => {
    await act(async () => {
      root.render(createElement(ProjectUploadWizard, { workspaceId: "ws_test_01" }));
    });

    const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
    expect(tabs).toHaveLength(3);
    const labels = tabs.map((tab) => tab.textContent?.trim());
    expect(labels).toContain("Upload Package (Zip) — Unavailable");
    expect(labels).toContain("Connect GitHub Repository");
    expect(labels).toContain("Run Local CLI");
  });

  it("switches to CLI source instructions when the CLI tab is clicked", async () => {
    await act(async () => {
      root.render(createElement(ProjectUploadWizard, { workspaceId: "ws_test_01" }));
    });

    const cliTab = Array.from(container.querySelectorAll('[role="tab"]')).find((tab) =>
      tab.textContent?.includes("Run Local CLI"),
    );
    await act(async () => {
      cliTab?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    });

    const panel = container.querySelector('[role="tabpanel"]:not([hidden])');
    expect(panel?.textContent).toContain("npx boardreadyops review");
  });

  it("switches to GitHub source instructions when the GitHub tab is clicked", async () => {
    await act(async () => {
      root.render(createElement(ProjectUploadWizard, { workspaceId: "ws_test_01" }));
    });

    const ghTab = Array.from(container.querySelectorAll('[role="tab"]')).find((tab) =>
      tab.textContent?.includes("Connect GitHub"),
    );
    await act(async () => {
      ghTab?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    });

    const link = container.querySelector('a[href="/setup"]');
    expect(link).not.toBeNull();
    expect(link?.textContent).toBe("Connect GitHub App");
  });

  it("defaults to the supported GitHub path instead of hosted upload", async () => {
    await act(async () => {
      root.render(createElement(ProjectUploadWizard, { workspaceId: "ws_test_01" }));
    });

    expect(container.querySelector('a[href="/setup"]')?.textContent).toBe("Connect GitHub App");
    expect(container.querySelector('[role="tabpanel"]:not([hidden])')?.textContent).toContain(
      "Connect your GitHub organization or personal repository",
    );
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.querySelector('button[type="submit"]')).toBeNull();
  });

  it("explains hosted upload only after the explicitly unavailable tab is selected", async () => {
    await act(async () => {
      root.render(createElement(ProjectUploadWizard, { workspaceId: "ws_test_01" }));
    });

    const uploadTab = Array.from(container.querySelectorAll('[role="tab"]')).find((tab) =>
      tab.textContent?.includes("Upload Package"),
    );
    expect(uploadTab?.textContent).toContain("Unavailable");

    await act(async () => {
      uploadTab?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    });

    expect(container.querySelector('[role="tabpanel"]:not([hidden])')?.textContent).toContain("not available yet");
  });
});
