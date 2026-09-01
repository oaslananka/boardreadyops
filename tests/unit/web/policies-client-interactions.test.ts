/**
 * @vitest-environment happy-dom
 */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PoliciesClient from "../../../apps/web/app/policies/policies-client.js";

type TestElement = {
  click(): void;
  value?: string;
  textContent: string | null;
  dispatchEvent(event: unknown): void;
};

type TestContainer = {
  querySelector(selector: string): TestElement | null;
  querySelectorAll(selector: string): TestElement[];
  remove(): void;
  textContent: string | null;
};

type TestRuntime = {
  document: { body: { append(child: unknown): void }; createElement(tag: string): unknown };
  HTMLInputElement: { prototype: object };
  Event: new (type: string, init?: { bubbles?: boolean }) => unknown;
};

const samplePolicy = {
  id: "pol_1",
  scope: "organization" as const,
  scopeId: null,
  name: "High-Voltage Sign-Off Policy",
  description: null,
  requiredChecklist: [],
  requiredRoles: [],
  severityGate: null,
  requireEvidencePack: false,
  requireExternalReview: false,
};

describe("PoliciesClient interactions (delete confirmation, cancel draft reset)", () => {
  let container: TestContainer;
  let root: Root;
  const runtime = globalThis as unknown as TestRuntime & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith("/api/v1/policies") && !url.includes("/policies/")) {
        return {
          ok: true,
          json: async () => ({ ok: true, policies: [samplePolicy] }),
        };
      }
      if (url.includes("/api/v1/policies/pol_1")) {
        return { ok: true, json: async () => ({ ok: true }) };
      }
      return { ok: true, json: async () => ({ ok: true, policies: [] }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    container = runtime.document.createElement("div") as TestContainer;
    runtime.document.body.append(container);
    root = createRoot(container as unknown as Parameters<typeof createRoot>[0]);
    runtime.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete runtime.IS_REACT_ACT_ENVIRONMENT;
    vi.unstubAllGlobals();
  });

  it("shows a confirmation dialog instead of deleting immediately, and Cancel does not call the API", async () => {
    await act(async () => {
      root.render(createElement(PoliciesClient));
    });
    await act(async () => {
      await Promise.resolve();
    });

    const deleteButton = container.querySelector("button.button-delete");
    if (!deleteButton) throw new Error("delete button not found");

    await act(async () => {
      deleteButton.click();
    });

    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("pol_1"), expect.anything());

    const cancelButton = Array.from(container.querySelectorAll(".modal-footer button")).find(
      (btn) => btn.textContent === "Cancel",
    );
    if (!cancelButton) throw new Error("cancel button not found");

    await act(async () => {
      cancelButton.click();
    });

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("pol_1"), expect.anything());
  });

  it("calls DELETE only after confirming in the dialog", async () => {
    await act(async () => {
      root.render(createElement(PoliciesClient));
    });
    await act(async () => {
      await Promise.resolve();
    });

    const deleteButton = container.querySelector("button.button-delete");
    if (!deleteButton) throw new Error("delete button not found");

    await act(async () => {
      deleteButton.click();
    });

    const confirmButton = Array.from(container.querySelectorAll(".modal-footer button")).find(
      (btn) => btn.textContent === "Delete Policy",
    );
    if (!confirmButton) throw new Error("confirm delete button not found");

    await act(async () => {
      confirmButton.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/policies/pol_1", { method: "DELETE" });
  });

  it("clears the builder draft when Cancel is clicked, so reopening shows an empty form", async () => {
    await act(async () => {
      root.render(createElement(PoliciesClient));
    });
    await act(async () => {
      await Promise.resolve();
    });

    const openButton = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent === "+ New Governance Policy",
    );
    if (!openButton) throw new Error("open builder button not found");
    await act(async () => {
      openButton.click();
    });

    const nameInput = container.querySelector("#policy-name");
    if (!nameInput) throw new Error("policy name input not found");
    const nativeSetter = Object.getOwnPropertyDescriptor(runtime.HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      nativeSetter?.call(nameInput, "SHOULD_CLEAR_ON_CANCEL");
      nameInput.dispatchEvent(new runtime.Event("input", { bubbles: true }));
    });
    expect((container.querySelector("#policy-name") as unknown as { value: string }).value).toBe(
      "SHOULD_CLEAR_ON_CANCEL",
    );

    const cancelButton = Array.from(container.querySelectorAll(".policy-builder-footer button")).find(
      (btn) => btn.textContent === "Cancel",
    );
    if (!cancelButton) throw new Error("builder cancel button not found");
    await act(async () => {
      cancelButton.click();
    });

    const reopenButton = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent === "+ New Governance Policy",
    );
    if (!reopenButton) throw new Error("reopen builder button not found");
    await act(async () => {
      reopenButton.click();
    });

    expect((container.querySelector("#policy-name") as unknown as { value: string }).value).toBe("");
  });

  it("does not claim multi-tenant hierarchy or active gates for a single advisory-only policy", async () => {
    await act(async () => {
      root.render(createElement(PoliciesClient));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Organization-Only");
    expect(container.textContent).toContain("Advisory Only");
    expect(container.textContent).not.toContain("Multi-Tenant Hierarchical");
    expect(container.textContent).not.toContain("Pre-Fabrication Gates Active");
  });
});
