/**
 * @vitest-environment happy-dom
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActionForm } from "../../../apps/web/components/ui/action-form.js";
import { ToastProvider } from "../../../apps/web/components/ui/toast.js";
import { type ActionResult, ok } from "../../../apps/web/lib/action-result.js";

const runtime = globalThis as unknown as { document: Document; IS_REACT_ACT_ENVIRONMENT?: boolean };

describe("ActionForm", () => {
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

  async function render(action: (previous: ActionResult<string>, formData: FormData) => Promise<ActionResult<string>>) {
    await act(async () => {
      root.render(
        createElement(
          ToastProvider,
          null,
          createElement(ActionForm<string>, { action, successMessage: "Saved." }, ({ pending }) =>
            createElement("button", { type: "submit" }, pending ? "Saving..." : "Save"),
          ),
        ),
      );
    });
  }

  it("starts idle, so nothing is announced before the first submit", async () => {
    await render(async () => ok("done"));
    expect(container.querySelector("output")?.textContent).toBe("");
  });

  it("renders a live region and the caller's controls inside one form", async () => {
    await render(async () => ok("done"));
    const form = container.querySelector("form");
    expect(form?.querySelector('output[aria-live="polite"]')).not.toBeNull();
    expect(form?.querySelector('button[type="submit"]')?.textContent).toBe("Save");
  });
});
