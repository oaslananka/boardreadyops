/**
 * @vitest-environment happy-dom
 */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectUploadWizard } from "../../../apps/web/components/project-upload-wizard.js";

describe("ProjectUploadWizard", () => {
  type TestElement = {
    click(): void;
    textContent: string | null;
    getAttribute(name: string): string | null;
  };
  type TestContainer = {
    querySelector(selector: string): TestElement | null;
    querySelectorAll(selector: string): TestElement[];
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

  it("renders source selection options: Upload Package (Zip), Connect GitHub, Run Local CLI", async () => {
    await act(async () => {
      root.render(createElement(ProjectUploadWizard, { workspaceId: "ws_test_01" }));
    });

    const buttons = container.querySelectorAll(".source-tab-button");
    expect(buttons.length).toBe(3);
    const textContents = Array.from(buttons).map((b) => b.textContent?.trim());
    expect(textContents).toContain("Upload Package (Zip)");
    expect(textContents).toContain("Connect GitHub Repository");
    expect(textContents).toContain("Run Local CLI");
  });

  it("switches to CLI source instructions when CLI tab is clicked", async () => {
    await act(async () => {
      root.render(createElement(ProjectUploadWizard, { workspaceId: "ws_test_01" }));
    });

    const cliTab = Array.from(container.querySelectorAll(".source-tab-button")).find((b) =>
      b.textContent?.includes("Run Local CLI"),
    );
    expect(cliTab).toBeDefined();

    await act(async () => {
      cliTab?.click();
    });

    const codeSnippet = container.querySelector(".cli-instruction-code");
    expect(codeSnippet).not.toBeNull();
    expect(codeSnippet?.textContent).toContain("npx boardreadyops");
  });

  it("switches to GitHub source instructions when GitHub tab is clicked", async () => {
    await act(async () => {
      root.render(createElement(ProjectUploadWizard, { workspaceId: "ws_test_01" }));
    });

    const ghTab = Array.from(container.querySelectorAll(".source-tab-button")).find((b) =>
      b.textContent?.includes("Connect GitHub"),
    );
    expect(ghTab).toBeDefined();

    await act(async () => {
      ghTab?.click();
    });

    const ghLink = container.querySelector(".github-setup-link");
    expect(ghLink).not.toBeNull();
    expect(ghLink?.getAttribute("href")).toBe("/setup");
  });

  it("keeps hosted upload unavailable until ingestion is connected", async () => {
    await act(async () => {
      root.render(createElement(ProjectUploadWizard, { workspaceId: "ws_test_01" }));
    });

    const uploadTab = Array.from(container.querySelectorAll(".source-tab-button")).find((b) =>
      b.textContent?.includes("Upload Package"),
    );
    await act(async () => uploadTab?.click());
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.querySelector('button[type="submit"]')).toBeNull();
    expect(container.querySelector('[role="tabpanel"]')?.textContent).toContain("not available");
  });
});
