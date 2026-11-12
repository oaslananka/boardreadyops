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

  it("shows only repository selection until a user chooses a GitHub repo", async () => {
    const repositories = [
      { ...readyForProbe, id: "repo-first", fullName: "first/board" },
      { ...readyForProbe, id: "repo-second", fullName: "second/board" },
    ];
    await act(async () => {
      root.render(createElement(RepositorySetupInteractive, { ...baseProps, repositories, signedIn: true }));
    });
    const picker = container.querySelector<HTMLSelectElement>("#one-click-setup-repository");
    expect(picker?.value).toBe("");
    expect(container.querySelectorAll("select")).toHaveLength(1);
    expect(container.querySelector("#policy-preset")).toBeNull();
    expect(container.querySelector("#proposed-files")).toBeNull();
    expect(container.querySelector("#automated-setup")).toBeNull();
    expect(container.textContent).toContain("Which repository has your board?");
  });

  it("keeps the setup pull request action ahead of collapsed technical configuration", async () => {
    await act(async () => {
      root.render(
        createElement(RepositorySetupInteractive, {
          ...baseProps,
          signedIn: true,
          repositories: [readyForProbe],
        }),
      );
    });
    const picker = container.querySelector("#one-click-setup-repository");
    const action = container.querySelector("#automated-setup");
    const policy = container.querySelector("#policy-preset");
    const advanced = container.querySelector<HTMLDetailsElement>('details[aria-label="Advanced setup configuration"]');
    expect(picker).not.toBeNull();
    expect(action).not.toBeNull();
    expect(policy).not.toBeNull();
    expect(advanced?.open).toBe(false);
    expect(advanced?.contains(policy ?? null)).toBe(true);
    expect(Boolean(action?.compareDocumentPosition(policy ?? null) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(container.textContent).toContain("Recommended starting policy");
  });

  it("shows only one obvious action before GitHub sign-in or App installation", async () => {
    await act(async () => {
      root.render(createElement(RepositorySetupInteractive, { ...baseProps, signedIn: false, repositories: [] }));
    });
    expect(container.querySelectorAll('a[href="/api/auth/github/login"]')).toHaveLength(1);
    expect(container.querySelector("#policy-preset")).toBeNull();
    expect(container.querySelector("#automated-setup")).toBeNull();
    expect(container.querySelectorAll("button").length).toBe(0);

    await act(async () => {
      root.render(createElement(RepositorySetupInteractive, { ...baseProps, signedIn: true, repositories: [] }));
    });
    expect(
      container.querySelectorAll('a[href="https://github.com/apps/boardreadyops/installations/new"]'),
    ).toHaveLength(1);
    expect(container.querySelector("select")).toBeNull();
    expect(container.querySelector("#policy-preset")).toBeNull();
    expect(container.querySelector("#automated-setup")).toBeNull();
  });

  it("does not treat a transient GitHub grant verification failure as an empty installation", async () => {
    await act(async () => {
      root.render(
        createElement(RepositorySetupInteractive, {
          ...baseProps,
          signedIn: true,
          hasInstallation: true,
          accessUnavailable: true,
          repositories: [],
        }),
      );
    });
    expect(container.textContent).toContain("GitHub repository access unavailable");
    expect(container.querySelector('a[href="/setup"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Connect your first GitHub repository");
  });

  it("directs an already-installed user to their GitHub selected-repositories settings, not a new installation", async () => {
    await act(async () => {
      root.render(
        createElement(RepositorySetupInteractive, {
          ...baseProps,
          signedIn: true,
          hasInstallation: true,
          repositories: [],
        }),
      );
    });
    expect(container.textContent).toContain("Select repositories on GitHub");
    expect(container.querySelector('a[href="https://github.com/settings/installations"]')).not.toBeNull();
    expect(container.querySelector('a[href="https://github.com/apps/boardreadyops/installations/new"]')).toBeNull();
  });

  it("opens a deep link on the intended authorized repository rather than the first installation entry", async () => {
    const repositories = [
      { ...readyForProbe, id: "repo-first", fullName: "first/board" },
      { ...readyForProbe, id: "repo-second", fullName: "second/board" },
    ];
    await act(async () => {
      root.render(
        createElement(RepositorySetupInteractive, {
          ...baseProps,
          repositories,
          signedIn: true,
          initialRepositoryId: "repo-second",
        }),
      );
    });
    expect(container.querySelector("select")?.value).toBe("repo-second");
    expect(container.textContent).toContain("second/board");
    expect(button(container, "Open setup pull request").disabled).toBe(false);
  });

  it("requires an explicit repository target when several installations are available", async () => {
    const repositories = [
      { ...readyForProbe, id: "repo-first", fullName: "first/board" },
      { ...readyForProbe, id: "repo-second", fullName: "second/board" },
    ];
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => {
      root.render(createElement(RepositorySetupInteractive, { ...baseProps, repositories, signedIn: true }));
    });
    const selector = container.querySelector("select");
    if (!(selector instanceof HTMLSelectElement)) throw new Error("repository selector not found");
    expect(selector.value).toBe("");
    expect(container.querySelector("#automated-setup")).toBeNull();
    expect(container.querySelector("#readiness")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(selector, "repo-second");
      selector.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(selector.value).toBe("repo-second");
    expect(container.textContent).toContain("second/board");
    expect(button(container, "Open setup pull request").disabled).toBe(false);
    expect(button(container, "Validate readiness").disabled).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("selects the only authorized repository without making that customer click twice", async () => {
    await act(async () => {
      root.render(
        createElement(RepositorySetupInteractive, { ...baseProps, repositories: [readyForProbe], signedIn: true }),
      );
    });
    expect(container.querySelector("select")?.value).toBe("repo-1");
    expect(button(container, "Open setup pull request").disabled).toBe(false);
  });

  it("does not silently select another repository for an unauthorized or stale deep link", async () => {
    await act(async () => {
      root.render(
        createElement(RepositorySetupInteractive, {
          ...baseProps,
          repositories: [readyForProbe],
          signedIn: true,
          initialRepositoryId: "other-installation-repository",
        }),
      );
    });
    expect(container.querySelector("select")?.value).toBe("");
    expect(container.textContent).toContain("Choose an authorized repository");
    expect(container.querySelector("#automated-setup")).toBeNull();
    expect(container.querySelector("#readiness")).toBeNull();
  });

  it("explains rollout-gated first runs per selected repository without claiming a setup probe is a result", async () => {
    const repositories: SetupTargetRepository[] = [
      {
        ...readyForProbe,
        id: "repo-blocked",
        fullName: "alpha/board-a",
        readinessRunBlockedReason: "Cloud readiness runs are not enabled for this repository yet.",
        latestRunId: "run-a",
      },
      { ...readyForProbe, id: "repo-enabled", fullName: "beta/board-b" },
    ];
    await act(async () => {
      root.render(
        createElement(RepositorySetupInteractive, {
          ...baseProps,
          signedIn: true,
          repositories,
          initialRepositoryId: "repo-blocked",
        }),
      );
    });
    expect(container.textContent).toContain("After validation: run a real hardware check");
    expect(container.textContent).toContain("It does not produce hardware findings");
    expect(container.textContent).toContain("Cloud readiness runs are not enabled for this repository yet.");
    const progress = container.querySelector("[data-setup-state]");
    expect(progress?.textContent).toContain("Hosted hardware runs are not available yet");
    expect(progress?.textContent).toContain("A local check cannot create an OIDC-signed hosted run");
    expect(progress?.querySelector('a[href*="/docs/quickstart.md"]')?.textContent).toContain(
      "Run a local hardware check",
    );
    expect(progress?.querySelector('a[href="#policy-preset"]')?.textContent).toContain("Prepare repository setup");
    expect(container.textContent).not.toContain("open a pull request changing your hardware project");
    expect(container.querySelector('a[href="/runs/run-a"]')?.textContent).toContain("Inspect latest recorded run");
    expect(container.querySelector('a[href*="/docs/quickstart.md"]')?.textContent).toContain("Run a local first check");
    expect(container.textContent).toContain("does not enable hosted runs, create");
    const selector = container.querySelector<HTMLSelectElement>("select");
    if (!selector) throw new Error("repository selector not found");
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(selector, "repo-enabled");
      selector.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.textContent).not.toContain("Cloud readiness runs are not enabled for this repository yet.");
    const unblockedProgress = container.querySelector("[data-setup-state]");
    expect(unblockedProgress?.textContent).not.toContain("Hosted hardware runs are not available yet");
    expect(unblockedProgress?.querySelector('a[href*="/docs/quickstart.md"]')).toBeNull();
    expect(unblockedProgress?.querySelector('a[href="#policy-preset"]')?.textContent).toContain(
      "Review policy and next setup step",
    );
    expect(container.querySelector('a[href="/runs/run-a"]')).toBeNull();
    expect(container.querySelector('a[href*="/docs/quickstart.md"]')).toBeNull();
    expect(container.textContent).toContain("open a pull request changing your");
    expect(container.textContent).toContain("an empty or queued result is not a first useful finding");
  });

  it("prioritizes a useful local check over empty hosted runs when setup is verified but rollout is blocked", async () => {
    const verified = {
      ...readyForProbe,
      setupWorkflowStatus: "ready",
      setupConfigStatus: "ready",
      setupObservedSha: "a".repeat(40),
      readinessRunBlockedReason: "Cloud readiness runs are not enabled yet.",
    };
    await act(async () => {
      root.render(
        createElement(RepositorySetupInteractive, { ...baseProps, signedIn: true, repositories: [verified] }),
      );
    });
    const progress = container.querySelector('[data-setup-state="ready"]');
    expect(progress?.textContent).toContain("Repository setup verified");
    expect(progress?.querySelector('a[href*="/docs/quickstart.md"]')?.textContent).toContain(
      "Run a local hardware check",
    );
    expect(progress?.querySelector('a[href="#readiness"]')?.textContent).toContain("Review verified setup");
    expect(progress?.querySelector('a[href="/repositories/repo-1"]')).toBeNull();
    expect(container.textContent).toContain("Cloud readiness runs are not enabled yet.");

    await act(async () => {
      root.render(
        createElement(RepositorySetupInteractive, {
          ...baseProps,
          signedIn: true,
          repositories: [{ ...verified, readinessRunBlockedReason: undefined }],
        }),
      );
    });
    const enabledProgress = container.querySelector('[data-setup-state="ready"]');
    expect(enabledProgress?.textContent).not.toContain("Hosted hardware runs are not available yet");
    expect(enabledProgress?.querySelector('a[href="/repositories/repo-1"]')?.textContent).toContain(
      "View this repository's readiness runs",
    );
  });

  it("provides an honest local-first alternative without inventing a run for a blocked new repository", async () => {
    const repo = {
      ...readyForProbe,
      id: "new-repo",
      fullName: "octo/new-board",
      readinessRunBlockedReason: "Hosted runs are unavailable for this repository.",
    };
    await act(async () => {
      root.render(createElement(RepositorySetupInteractive, { ...baseProps, signedIn: true, repositories: [repo] }));
    });
    expect(container.textContent).toContain("No earlier run is recorded for this repository yet.");
    expect(container.querySelector('a[href^="/runs/"]')).toBeNull();
    expect(container.textContent).toContain("A local check can identify issues");
    expect(container.textContent).toContain("or approve fabrication");
    expect(container.querySelector('a[href*="/docs/quickstart.md"]')).not.toBeNull();
  });

  it("keeps previous-run links scoped to the selected authorized repository", async () => {
    const first = {
      ...readyForProbe,
      id: "repo-first",
      fullName: "first/pcb",
      latestRunId: "first-run",
      readinessRunBlockedReason: "Hosted runs unavailable.",
    };
    const second = {
      ...readyForProbe,
      id: "repo-second",
      fullName: "second/pcb",
      latestRunId: "second-run",
      readinessRunBlockedReason: "Hosted runs unavailable.",
    };
    await act(async () => {
      root.render(
        createElement(RepositorySetupInteractive, {
          ...baseProps,
          signedIn: true,
          repositories: [first, second],
          initialRepositoryId: "repo-second",
        }),
      );
    });
    expect(container.querySelector('a[href="/runs/second-run"]')).not.toBeNull();
    expect(container.querySelector('a[href="/runs/first-run"]')).toBeNull();

    const select = container.querySelector("select");
    if (!(select instanceof HTMLSelectElement)) throw new Error("repository selector not found");
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(select, "repo-first");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.querySelector('a[href="/runs/first-run"]')).not.toBeNull();
    expect(container.querySelector('a[href="/runs/second-run"]')).toBeNull();
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
        createElement(RepositorySetupInteractive, {
          ...baseProps,
          signedIn: true,
          repositories: [blocked, allowed],
          initialRepositoryId: "repo-first",
        }),
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

    expect(container.querySelector("#readiness")).toBeNull();
    expect(container.textContent).toContain("Sign in with GitHub");
  });

  it("does not describe manually copied setup files as a registered setup revision", async () => {
    await act(async () => {
      root.render(createElement(RepositorySetupInteractive, { ...baseProps, signedIn: false, repositories: [] }));
    });

    expect(container.textContent).toContain("No files change just by signing in.");
    expect(container.textContent).not.toContain("Setup is already verified");
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
      root.render(
        createElement(RepositorySetupInteractive, {
          ...baseProps,
          signedIn: true,
          repositories,
          initialRepositoryId: "repo-1",
        }),
      );
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
