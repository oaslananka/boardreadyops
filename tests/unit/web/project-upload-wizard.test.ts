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

    const link = container.querySelector('a[href^="/api/auth/github/login"]');
    expect(link).not.toBeNull();
    expect(link?.textContent).toBe("Sign in with GitHub");
    expect(container.querySelector('a[href="/reviews"]')).toBeNull();
  });

  it("defaults to the supported GitHub path instead of hosted upload", async () => {
    await act(async () => {
      root.render(createElement(ProjectUploadWizard, { workspaceId: "ws_test_01" }));
    });

    expect(container.querySelector('a[href^="/api/auth/github/login"]')?.textContent).toBe("Sign in with GitHub");
    expect(container.querySelector('[role="tabpanel"]:not([hidden])')?.textContent).toContain(
      "Sign in with GitHub to choose a repository",
    );
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.querySelector('button[type="submit"]')).toBeNull();
  });

  it("takes a connected viewer straight to an authorized repository setup, without another install prompt", async () => {
    await act(async () => {
      root.render(
        createElement(ProjectUploadWizard, {
          signedIn: true,
          repositories: [
            { id: "permitted-repo", fullName: "owner/board-alpha", hasSetupRevision: false },
            { id: "other-repo", fullName: "other/board-beta", hasSetupRevision: true },
          ],
        }),
      );
    });

    expect(container.textContent).toContain("Choose a repository");
    expect(container.textContent).toContain("owner/board-alpha");
    expect(container.textContent).toContain("other/board-beta");
    expect(container.querySelector('a[href="/setup?repositoryId=permitted-repo"]')).not.toBeNull();
    expect(container.querySelector('a[href="/setup?repositoryId=other-repo"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Connect GitHub App");
    expect(container.querySelector('a[href="/reviews"]')).toBeNull();
  });

  it("does not expose stale repository choices when live GitHub access is unavailable", async () => {
    await act(async () => {
      root.render(
        createElement(ProjectUploadWizard, {
          signedIn: true,
          accessUnavailable: true,
          repositories: [{ id: "stale-repo", fullName: "private/stale-repo", hasSetupRevision: false }],
        }),
      );
    });
    expect(container.textContent).toContain("could not verify");
    expect(container.textContent).not.toContain("private/stale-repo");
    expect(container.querySelector('a[href^="/setup?repositoryId="]')).toBeNull();
  });

  it("gives signed-out and no-installation users the correct single next action", async () => {
    await act(async () => {
      root.render(createElement(ProjectUploadWizard));
    });
    expect(container.querySelector('a[href^="/api/auth/github/login"]')?.textContent).toContain("Sign in");

    await act(async () => {
      root.render(createElement(ProjectUploadWizard, { signedIn: true, repositories: [] }));
    });
    expect(container.textContent).toContain("No authorized repositories");
    expect(container.querySelector('a[href="/setup"]')?.textContent).toContain("Check GitHub App access");
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
