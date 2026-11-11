/**
 * @vitest-environment happy-dom
 */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalModal } from "../../../apps/web/components/review/approval-modal.js";
import { DecisionModal } from "../../../apps/web/components/review/decision-modal.js";
import { DEMO_REVIEWS } from "../../../apps/web/lib/demo-data.js";

describe("authorized review dialogs retain the WAI-ARIA focus contract", () => {
  let root: Root;
  let container: HTMLDivElement;
  let opener: HTMLButtonElement;
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    opener.remove();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });

  async function assertDialogFocusContract(title: string, onClose: ReturnType<typeof vi.fn>) {
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.getAttribute("aria-labelledby")).toBeTruthy();
    const labelId = dialog?.getAttribute("aria-labelledby");
    expect(dialog?.querySelector(`#${labelId}`)?.textContent).toContain(title);
    expect(dialog?.contains(document.activeElement)).toBe(true);
    await act(async () => {
      dialog?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
    expect(document.activeElement).toBe(opener);
    // The afterEach unmount is idempotent.
  }

  it("approval/sign-off modal opens with focus and closes with Escape", async () => {
    const onClose = vi.fn();
    await act(async () => {
      root.render(
        createElement(ApprovalModal, {
          type: "approve",
          evidenceDigest: "ab".repeat(32),
          onClose,
          onConfirm: vi.fn(),
        }),
      );
    });
    await assertDialogFocusContract("Record Engineering Sign-Off", onClose);
  });

  it("finding waiver/decision modal opens with focus and closes with Escape", async () => {
    const onClose = vi.fn();
    const finding = DEMO_REVIEWS[0]?.findings[0];
    if (!finding) throw new Error("Expected review fixture finding");
    await act(async () => {
      root.render(
        createElement(DecisionModal, {
          finding,
          targetDisposition: "accepted_risk",
          onClose,
          onConfirm: vi.fn(),
        }),
      );
    });
    await assertDialogFocusContract("Record Finding Decision", onClose);
  });
});
