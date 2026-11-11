/**
 * @vitest-environment happy-dom
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExportRequestForm } from "../../../apps/web/components/settings/data-lifecycle-forms.js";

vi.mock("../../../apps/web/components/ui/action-form.js", () => ({
  ActionForm: ({
    children,
    onSuccess,
  }: {
    children: (props: { pending: boolean; state: { status: "idle" } }) => ReactNode;
    onSuccess?: (data: { exportId: string; status: string }) => void;
  }) =>
    createElement(
      "form",
      {},
      createElement(
        "button",
        {
          type: "button",
          "data-testid": "simulate-recorded-export",
          onClick: () => onSuccess?.({ exportId: "export-for-installation-A", status: "requested" }),
        },
        "Simulate successful export request",
      ),
      children({ pending: false, state: { status: "idle" } }),
    ),
}));

vi.mock("../../../apps/web/components/settings/export-request-receipt.js", () => ({
  ExportRequestReceipt: ({ issued }: { issued: { exportId: string } }) =>
    createElement("output", { "data-testid": "export-receipt" }, issued.exportId),
}));

afterEach(() => {
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});

describe("installation-scoped data lifecycle forms", () => {
  it("does not carry installation A's export receipt into installation B after selection changes", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const noOpAction = vi.fn() as unknown as Parameters<typeof ExportRequestForm>[0]["action"];
    try {
      await act(async () =>
        root.render(
          createElement(ExportRequestForm, {
            key: "installation-A",
            installationId: "installation-A",
            action: noOpAction,
          }),
        ),
      );
      await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-testid="simulate-recorded-export"]')?.click();
      });
      expect(container.querySelector('[data-testid="export-receipt"]')?.textContent).toBe("export-for-installation-A");

      await act(async () =>
        root.render(
          createElement(ExportRequestForm, {
            key: "installation-B",
            installationId: "installation-B",
            action: noOpAction,
          }),
        ),
      );
      expect(container.querySelector('[data-testid="export-receipt"]')).toBeNull();
      expect(container.querySelector<HTMLInputElement>('input[name="installationId"]')?.value).toBe("installation-B");
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
