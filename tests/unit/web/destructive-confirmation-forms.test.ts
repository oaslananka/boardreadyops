/**
 * @vitest-environment happy-dom
 */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectRowActions } from "../../../apps/web/components/projects/teardown-forms.js";
import { ErasureRequestForm } from "../../../apps/web/components/settings/data-lifecycle-forms.js";
import { ToastProvider } from "../../../apps/web/components/ui/toast.js";
import { ok } from "../../../apps/web/lib/action-result.js";

const runtime = globalThis as unknown as {
  document: Document;
  Event: typeof Event;
  HTMLInputElement: typeof HTMLInputElement;
  HTMLSelectElement: typeof HTMLSelectElement;
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

async function setInput(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(runtime.HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new runtime.Event("input", { bubbles: true }));
  });
}

async function setSelect(select: HTMLSelectElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(runtime.HTMLSelectElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(select, value);
    select.dispatchEvent(new runtime.Event("change", { bubbles: true }));
  });
}

function submitIsPrevented(form: HTMLFormElement): boolean {
  const event = new runtime.Event("submit", { bubbles: true, cancelable: true });
  form.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("destructive confirmation forms", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    runtime.IS_REACT_ACT_ENVIRONMENT = true;
    container = runtime.document.createElement("div");
    runtime.document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete runtime.IS_REACT_ACT_ENVIRONMENT;
  });

  it("keeps erasure disabled until the visible scope confirmation matches and blocks implicit submit", async () => {
    const action = vi.fn(async () =>
      ok({ erasureId: "erase-1", status: "requested", dryRun: true }),
    ) as never;

    await act(async () => {
      root.render(
        createElement(
          ToastProvider,
          null,
          createElement(ErasureRequestForm, {
            installationId: "inst-1",
            action,
            defaultScopeLabel: "octo",
          }),
        ),
      );
    });

    const form = container.querySelector("form");
    const confirm = container.querySelector('input[name="confirm"]');
    const scope = container.querySelector('select[name="scope"]');
    const scopeId = container.querySelector('input[name="scopeId"]');
    const submit = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Submit erasure request"),
    );

    if (!(form instanceof HTMLFormElement)) throw new Error("erasure form not found");
    if (!(confirm instanceof HTMLInputElement)) throw new Error("confirmation input not found");
    if (!(scope instanceof HTMLSelectElement)) throw new Error("scope select not found");
    if (!(scopeId instanceof HTMLInputElement)) throw new Error("scope id input not found");
    if (!(submit instanceof HTMLButtonElement)) throw new Error("erasure submit button not found");

    expect(submit.disabled).toBe(true);
    expect(submitIsPrevented(form)).toBe(true);
    expect(action).not.toHaveBeenCalled();
    expect(container.textContent).toContain('The request stays disabled until you type "octo" exactly.');

    await setInput(confirm, "octo");
    expect(submit.disabled).toBe(false);

    await setSelect(scope, "repository");
    expect(submit.disabled).toBe(true);
    expect(container.textContent).toContain("Enter a scope id above before confirming");
    expect(submitIsPrevented(form)).toBe(true);
    expect(action).not.toHaveBeenCalled();

    await setInput(scopeId, "repo-123");
    expect(container.textContent).toContain('type "repo-123" exactly');
    expect(submit.disabled).toBe(true);

    await setInput(confirm, "repo-123");
    expect(submit.disabled).toBe(false);
    expect(container.textContent).toContain("Confirmation matches.");
  });

  it("blocks project deletion form submission until the typed project name matches exactly", async () => {
    const deleteAction = vi.fn(async () => ok({ deleted: true })) as never;
    const renameAction = vi.fn(async () => ok({ renamed: true })) as never;

    await act(async () => {
      root.render(
        createElement(
          ToastProvider,
          null,
          createElement(ProjectRowActions, {
            projectId: "project-1",
            projectName: "Gateway board",
            revisions: 3,
            deliveries: 1,
            canRename: false,
            canDelete: true,
            renameAction,
            deleteAction,
          }),
        ),
      );
    });

    const trigger = [...container.querySelectorAll("button")].find((button) => button.textContent === "Delete");
    if (!(trigger instanceof HTMLButtonElement)) throw new Error("delete trigger not found");

    await act(async () => {
      trigger.click();
    });

    const form = container.querySelector("form");
    const confirm = container.querySelector('input[name="confirmName"]');
    const submit = [...container.querySelectorAll("button")].find((button) => button.textContent === "Delete project");

    if (!(form instanceof HTMLFormElement)) throw new Error("delete form not found");
    if (!(confirm instanceof HTMLInputElement)) throw new Error("delete confirmation input not found");
    if (!(submit instanceof HTMLButtonElement)) throw new Error("delete submit button not found");

    expect(submit.disabled).toBe(true);
    expect(submitIsPrevented(form)).toBe(true);
    expect(deleteAction).not.toHaveBeenCalled();
    expect(container.textContent).toContain("pressing Enter cannot bypass this confirmation");

    await setInput(confirm, "Gateway");
    expect(submit.disabled).toBe(true);
    expect(submitIsPrevented(form)).toBe(true);
    expect(deleteAction).not.toHaveBeenCalled();

    await setInput(confirm, "Gateway board");
    expect(submit.disabled).toBe(false);
    expect(container.textContent).toContain("Confirmation matches.");
  });
});
