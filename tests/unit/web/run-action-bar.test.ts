/**
 * @vitest-environment happy-dom
 */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunActionBar } from "../../../apps/web/components/run-action-bar.js";

function jsonResponse(body: Record<string, unknown>, ok = true): Response {
  return { ok, json: async () => body } as unknown as Response;
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(label));
  if (!(match instanceof HTMLButtonElement)) throw new Error(`button not found: ${label}`);
  return match;
}

async function renderAndClick(root: Root, container: HTMLElement, label: string): Promise<void> {
  await act(async () => {
    root.render(createElement(RunActionBar, { repositoryId: "repo-1", runId: "run-1", hasPullRequest: true }));
  });
  await act(async () => {
    button(container, label).click();
  });
}

describe("run action recovery", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    delete (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it("shows the safe retry category and support reference for an internal queue failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            ok: false,
            error: "The action could not be queued. Please try again.",
            code: "repository_action_queue_failed",
            recovery: "retry",
            requestId: "request-correlation-1",
          },
          false,
        ),
      ),
    );

    await renderAndClick(root, container, "Re-run readiness");

    expect(container.textContent).toContain("Try again.");
    expect(container.textContent).toContain("The action could not be queued.");
    expect(container.textContent).toContain("Reference:");
    expect(container.textContent).toContain("request-correlation-1");
    expect(container.textContent).not.toContain("42703");
  });

  it("shows the GitHub installation remedy when repository access needs attention", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            ok: false,
            error: "Dispatching analysis workflows requires Actions (write) permission.",
            code: "repository_action_permission_required",
            recovery: "github_access",
            requestId: "request-access-1",
            manageUrl: "https://github.com/settings/installations/123",
          },
          false,
        ),
      ),
    );

    await renderAndClick(root, container, "Preview release");

    expect(container.textContent).toContain("GitHub access needs attention.");
    expect(container.textContent).toContain("request-access-1");
    const remedy = [...container.querySelectorAll("a")].find((candidate) =>
      candidate.textContent?.includes("Review the installation on GitHub"),
    );
    expect(remedy?.getAttribute("href")).toBe("https://github.com/settings/installations/123");
  });

  it("categorizes network failures without inventing a server reference", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("offline");
      }),
    );

    await renderAndClick(root, container, "Re-run readiness");

    expect(container.textContent).toContain("Connection problem.");
    expect(container.textContent).toContain("Check your connection");
    expect(container.textContent).not.toContain("Reference:");
  });
});
