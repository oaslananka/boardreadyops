/**
 * @vitest-environment happy-dom
 */

import {
  repositorySetupPresets,
  repositorySetupPresetVersion,
  repositorySetupWorkflowContractVersion,
  repositorySetupWorkflowPath,
} from "@boardreadyops/cloud-core/repository-setup";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RepositorySetupInteractive,
  type SetupTargetRepository,
} from "../../../apps/web/components/repository-setup-interactive.js";

type TestContainer = HTMLElement;

const baseProps = {
  presets: repositorySetupPresets,
  initialPresetId: "prototype",
  presetVersion: repositorySetupPresetVersion,
  workflowPath: repositorySetupWorkflowPath,
  workflowContractVersion: repositorySetupWorkflowContractVersion,
  workflowSource: "https://github.test/oaslananka/boardreadyops/readiness-runner.yml",
};

const readyForProbe: SetupTargetRepository = {
  id: "repo-1",
  fullName: "octo/board-one",
  accountLogin: "octo",
  setupRevision: 1,
  setupPreset: "prototype",
  setupWorkflowStatus: "unknown",
  setupConfigStatus: "unknown",
};

function jsonResponse(body: Record<string, unknown>, ok = true): Response {
  return { ok, json: async () => body } as unknown as Response;
}

function button(container: TestContainer, label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(label));
  if (!(match instanceof HTMLButtonElement)) throw new Error(`button not found: ${label}`);
  return match;
}

describe("repository setup readiness controls", () => {
  let container: TestContainer;
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

  it("disables readiness validation when the viewer is signed out", async () => {
    await act(async () => {
      root.render(createElement(RepositorySetupInteractive, { ...baseProps, signedIn: false, repositories: [] }));
    });

    expect(button(container, "Validate readiness").disabled).toBe(true);
    expect(container.textContent).toContain("Sign in with GitHub to validate");
  });

  it("disables readiness validation until a setup revision exists", async () => {
    const repository = { ...readyForProbe, setupRevision: undefined };
    await act(async () => {
      root.render(
        createElement(RepositorySetupInteractive, { ...baseProps, signedIn: true, repositories: [repository] }),
      );
    });

    expect(button(container, "Validate readiness").disabled).toBe(true);
    expect(container.textContent).toContain("Open the setup pull request first");
  });

  it("shows replayed probe state and the GitHub Actions run", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          ok: true,
          outcome: "replayed",
          status: "dispatched",
          workflowRunId: "987",
          workflowRunUrl: "https://github.test/octo/board-one/actions/runs/987",
        }),
      ),
    );

    await act(async () => {
      root.render(
        createElement(RepositorySetupInteractive, { ...baseProps, signedIn: true, repositories: [readyForProbe] }),
      );
    });
    await act(async () => {
      button(container, "Validate readiness").click();
    });

    expect(container.textContent).toContain("Readiness probe dispatched.");
    const link = [...container.querySelectorAll("a")].find((candidate) =>
      candidate.textContent?.includes("View workflow run"),
    );
    expect(link?.getAttribute("href")).toBe("https://github.test/octo/board-one/actions/runs/987");
  });

  it("surfaces the installation remedy when GitHub permissions block validation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            ok: false,
            error: "Dispatching analysis workflows requires Actions (write) permission.",
            manageUrl: "https://github.com/settings/installations/123",
          },
          false,
        ),
      ),
    );

    await act(async () => {
      root.render(
        createElement(RepositorySetupInteractive, { ...baseProps, signedIn: true, repositories: [readyForProbe] }),
      );
    });
    await act(async () => {
      button(container, "Validate readiness").click();
    });

    expect(container.textContent).toContain("Actions (write) permission");
    const remedy = [...container.querySelectorAll("a")].find((candidate) =>
      candidate.textContent?.includes("Review the installation on GitHub"),
    );
    expect(remedy?.getAttribute("href")).toBe("https://github.com/settings/installations/123");
  });

  it("clears action results when the selected repository changes", async () => {
    const repositories: SetupTargetRepository[] = [
      readyForProbe,
      { ...readyForProbe, id: "repo-2", fullName: "octo/board-two", setupRevision: 2 },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const payload = JSON.parse(String(init?.body ?? "{}")) as { action?: string };
        if (payload.action === "setup") {
          return jsonResponse({
            ok: true,
            outcome: "created",
            pullRequestNumber: 12,
            pullRequestUrl: "https://github.test/octo/board-one/pull/12",
            setupRevision: 3,
          });
        }
        return jsonResponse({ ok: false, error: "First repository probe failed." }, false);
      }),
    );

    await act(async () => {
      root.render(createElement(RepositorySetupInteractive, { ...baseProps, signedIn: true, repositories }));
    });
    await act(async () => {
      button(container, "Open setup pull request").click();
    });
    await act(async () => {
      button(container, "Validate readiness").click();
    });
    expect(container.textContent).toContain("Setup pull request #12");
    expect(container.textContent).toContain("First repository probe failed.");

    const select = container.querySelector("select");
    if (!(select instanceof HTMLSelectElement)) throw new Error("repository selector not found");
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(select, "repo-2");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(container.textContent).toContain("octo/board-two");
    expect(container.textContent).not.toContain("Setup pull request #12");
    expect(container.textContent).not.toContain("First repository probe failed.");
  });
});
