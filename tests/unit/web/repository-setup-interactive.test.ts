/**
 * @vitest-environment happy-dom
 */

import { githubAppPermissionProfile, missingDeclaredPermissions } from "@boardreadyops/cloud-core/github-capabilities";
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

  it("explains rollout-gated first runs per selected repository without claiming a setup probe is a result", async () => {
    const repositories: SetupTargetRepository[] = [
      {
        ...readyForProbe,
        id: "repo-blocked",
        fullName: "alpha/board-a",
        readinessRunBlockedReason: "Cloud readiness runs are not enabled for this repository yet.",
      },
      { ...readyForProbe, id: "repo-enabled", fullName: "beta/board-b" },
    ];
    await act(async () => {
      root.render(createElement(RepositorySetupInteractive, { ...baseProps, signedIn: true, repositories }));
    });
    expect(container.textContent).toContain("After validation: run a real hardware check");
    expect(container.textContent).toContain("It does not produce hardware findings");
    expect(container.textContent).toContain("Cloud readiness runs are not enabled for this repository yet.");
    expect(container.textContent).not.toContain("open a pull request changing your hardware project");
    const selector = container.querySelector<HTMLSelectElement>("select");
    if (!selector) throw new Error("repository selector not found");
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(selector, "repo-enabled");
      selector.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.textContent).not.toContain("Cloud readiness runs are not enabled for this repository yet.");
    expect(container.textContent).toContain("open a pull request changing your");
    expect(container.textContent).toContain("an empty or queued result is not a first useful finding");
  });

  it("switches setup, probe and live permissions with the selected GitHub installation", async () => {
    const fullPermissions = Object.fromEntries(githubAppPermissionProfile.map((p) => [p.key, p.level]));
    const blockedPermissions = { ...fullPermissions, actions: "read", pull_requests: "read" };
    const blocked = {
      ...readyForProbe,
      id: "repo-first",
      fullName: "first-org/board",
      setupBlockedReason: "First installation cannot open setup pull requests.",
      readinessBlockedReason: "First installation cannot dispatch Actions.",
      installationGrants: {
        permissions: blockedPermissions,
        missing: missingDeclaredPermissions(blockedPermissions),
        manageUrl: "https://github.com/settings/installations/101",
      },
    };
    const allowed = {
      ...readyForProbe,
      id: "repo-second",
      fullName: "second-org/board",
      installationGrants: {
        permissions: fullPermissions,
        missing: missingDeclaredPermissions(fullPermissions),
        manageUrl: "https://github.com/settings/installations/202",
      },
    };
    await act(async () => {
      root.render(
        createElement(RepositorySetupInteractive, { ...baseProps, signedIn: true, repositories: [blocked, allowed] }),
      );
    });
    expect(button(container, "Open setup pull request").disabled).toBe(true);
    expect(button(container, "Validate readiness").disabled).toBe(true);
    expect(container.textContent).toContain("First installation cannot open setup pull requests.");
    expect(container.textContent).toContain("First installation cannot dispatch Actions.");
    expect(container.textContent).toContain("This installation is missing a required permission");
    expect(container.querySelector('a[href="https://github.com/settings/installations/101"]')).not.toBeNull();

    const select = container.querySelector("select");
    if (!(select instanceof HTMLSelectElement)) throw new Error("repository selector not found");
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(select, "repo-second");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(button(container, "Open setup pull request").disabled).toBe(false);
    expect(button(container, "Validate readiness").disabled).toBe(false);
    expect(container.textContent).not.toContain("First installation cannot");
    expect(container.textContent).toContain("second-org/board");
    expect(container.textContent).toContain("Every declared permission is granted");
    expect(container.querySelector('a[href="https://github.com/settings/installations/101"]')).toBeNull();

    await act(async () => {
      setter?.call(select, "repo-first");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(button(container, "Open setup pull request").disabled).toBe(true);
    expect(button(container, "Validate readiness").disabled).toBe(true);
    expect(container.textContent).toContain("First installation cannot open setup pull requests.");
    expect(container.querySelector('a[href="https://github.com/settings/installations/101"]')).not.toBeNull();
  });

  it("disables readiness validation when the viewer is signed out", async () => {
    await act(async () => {
      root.render(createElement(RepositorySetupInteractive, { ...baseProps, signedIn: false, repositories: [] }));
    });

    expect(button(container, "Validate readiness").disabled).toBe(true);
    expect(container.textContent).toContain("Sign in with GitHub to validate");
  });

  it("does not describe manually copied setup files as a registered setup revision", async () => {
    await act(async () => {
      root.render(createElement(RepositorySetupInteractive, { ...baseProps, signedIn: false, repositories: [] }));
    });

    expect(container.textContent).toContain("does not register a BoardReadyOps setup revision");
    expect(container.textContent).toContain("does not verify readiness");
    expect(container.textContent).not.toContain("the result is identical");
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

  it("does not allow validation or advertise a verified setup for revision zero", async () => {
    const repository = {
      ...readyForProbe,
      setupRevision: 0,
      setupWorkflowStatus: "ready",
      setupConfigStatus: "ready",
    };
    await act(async () => {
      root.render(
        createElement(RepositorySetupInteractive, {
          ...baseProps,
          signedIn: true,
          repositories: [repository],
        }),
      );
    });
    expect(container.textContent).toContain("Setup not started");
    expect(container.textContent).toContain("No persisted setup revision exists");
    expect(container.textContent).toContain("Not created");
    expect(container.textContent).not.toContain("Setup revision#0");
    expect(button(container, "Validate readiness").disabled).toBe(true);
    expect(container.textContent).toContain("Open the setup pull request first");
  });

  it("never claims setup verified without its observed Git commit", async () => {
    const repository = {
      ...readyForProbe,
      setupWorkflowStatus: "ready",
      setupConfigStatus: "ready",
      setupRevision: 2,
      setupObservedSha: undefined,
    };
    await act(async () => {
      root.render(
        createElement(RepositorySetupInteractive, { ...baseProps, signedIn: true, repositories: [repository] }),
      );
    });
    expect(container.textContent).toContain("Setup needs attention");
    expect(container.textContent).toContain("verified Git commit");
    expect(container.textContent).toContain("Not verified");
    expect(container.textContent).not.toContain("Repository setup verified");
    expect(button(container, "Validate readiness").disabled).toBe(false);
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

  it("treats a verified repository as ready without a new setup PR", async () => {
    const verified = {
      ...readyForProbe,
      setupWorkflowStatus: "ready",
      setupConfigStatus: "ready",
      setupObservedSha: "abcdef1234567890abcdef1234567890abcdef12",
    };
    await act(async () => {
      root.render(
        createElement(RepositorySetupInteractive, { ...baseProps, signedIn: true, repositories: [verified] }),
      );
    });

    expect(container.textContent).toContain("Repository setup verified");
    const scopedLink = [...container.querySelectorAll("a")].find((link) =>
      link.textContent?.includes("View this repository's readiness runs"),
    );
    expect(scopedLink?.getAttribute("href")).toBe("/repositories/repo-1");

    expect(container.textContent).toContain("No new setup pull request is needed");
    expect([...container.querySelectorAll("a")].some((link) => link.getAttribute("href") === "/runs")).toBe(true);
    expect(() => button(container, "Open setup pull request")).toThrow("button not found");
    const advanced = container.querySelector("details");
    expect(advanced?.open).toBe(false);
    expect(advanced?.querySelector("summary")?.textContent).toContain("Change verified setup");
  });

  it("preserves an explicit reviewed update path for verified setup", async () => {
    const verified = {
      ...readyForProbe,
      setupWorkflowStatus: "ready",
      setupConfigStatus: "ready",
      setupObservedSha: "a".repeat(40),
    };
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({
        ok: true,
        outcome: "created",
        pullRequestNumber: 21,
        pullRequestUrl: "https://github.test/octo/board-one/pull/21",
        setupRevision: 2,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        createElement(RepositorySetupInteractive, { ...baseProps, signedIn: true, repositories: [verified] }),
      );
    });
    const advanced = container.querySelector("details");
    if (!(advanced instanceof HTMLDetailsElement)) throw new Error("change setup details not found");
    expect(fetchMock).not.toHaveBeenCalled();
    advanced.open = true;
    await act(async () => {
      button(container, "Open configuration update PR").click();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const updateRequest = fetchMock.mock.calls[0];
    if (!updateRequest) throw new Error("missing configuration update request");
    expect(JSON.parse(updateRequest[1]?.body as string)).toMatchObject({
      action: "setup",
      updateExistingSetup: true,
    });
    expect(container.textContent).toContain("Setup pull request #21");
  });
});
