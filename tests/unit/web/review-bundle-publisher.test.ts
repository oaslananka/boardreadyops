/** @vitest-environment happy-dom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewBundlePublisher } from "../../../apps/web/components/review/review-bundle-publisher.js";

const repo = "oaslananka-iot/RoyalBlue54L-Feather-Hardware";
const head = "a".repeat(40);
const digest = "b".repeat(64);

function bundle() {
  return {
    format: "boardreadyops-review-bundle-v1",
    repository: repo,
    commitSha: head,
    uploadMode: "snapshots",
    sourceArtIncluded: true,
    createdAt: "2026-11-13T17:00:00.000Z",
    idempotencyKey: `publish-${head}-${digest.slice(0, 16)}-${"c".repeat(16)}`,
    payload: {
      repositoryId: repo,
      commitSha: head,
      ref: head,
      triggerKind: "manual",
      evidenceDigest: digest,
      title: "RoyalBlue54L genuine PCB",
      findings: [{ ruleId: "drc.hole_clearance", severity: "error", message: "Real violation" }],
      artifacts: [],
      snapshots: [
        {
          id: "real-copper",
          name: "kicad_native_F_Cu.svg",
          kind: "pcb_layer",
          format: "svg",
          sheetOrLayer: "F.Cu",
          width: 100,
          height: 100,
          sha256: "f".repeat(64),
          anchors: [],
          content: "<svg xmlns='http://www.w3.org/2000/svg'></svg>",
        },
      ],
    },
  };
}

async function selectLocalFile(container: HTMLElement, contents: unknown, size?: number) {
  const picker = container.querySelector<HTMLInputElement>('input[type="file"]');
  expect(picker).not.toBeNull();
  const file = new File([JSON.stringify(contents)], "local-review.json", { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => JSON.stringify(contents) });
  if (size) Object.defineProperty(file, "size", { value: size });
  Object.defineProperty(picker, "files", { configurable: true, value: [file] });
  await act(async () => picker?.dispatchEvent(new Event("change", { bubbles: true })));
}

async function renderedPublisher() {
  const container = document.createElement("div");
  document.body.append(container);
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(container);
  await act(async () => root.render(createElement(ReviewBundlePublisher)));
  return { container, root };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});

describe("browser-native, session-authenticated Review publication", () => {
  it("previews genuine evidence but cannot upload until the user explicitly acknowledges source disclosure", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, reviewUrl: "/reviews/new-real-review", runId: "run-real" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = await renderedPublisher();
    try {
      await selectLocalFile(container, bundle());
      expect(container.textContent).toContain(repo);
      expect(container.textContent).toContain("RoyalBlue54L genuine PCB");
      expect(container.textContent).toContain("1 recorded finding");
      expect(container.textContent).toContain("1 PCB layer");
      expect(fetchMock).not.toHaveBeenCalled();
      const publish = [...container.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === "Publish this Review",
      );
      expect(publish?.disabled).toBe(true);
      const consent = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
      expect(consent).not.toBeNull();
      await act(async () => consent?.click());
      expect(publish?.disabled).toBe(false);
      await act(async () => publish?.click());
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(path).toBe("/api/v1/runs");
      expect(init.method).toBe("POST");
      expect(init.credentials).toBe("same-origin");
      expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
      expect(JSON.stringify(init.headers)).not.toContain("Bearer ");
      const submitted = JSON.parse(String(init.body));
      expect(submitted.repositoryId).toBe(repo);
      expect(submitted.commitSha).toBe(head);
      expect(submitted.snapshots).toHaveLength(1);
      expect(container.querySelector('a[href="/reviews/new-real-review"]')?.textContent).toContain("Open");
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("rejects malformed files and larger-than-limit files without performing network mutations", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = await renderedPublisher();
    try {
      await selectLocalFile(container, { error: "not a review" });
      expect(container.textContent).toContain("valid");
      expect(fetchMock).not.toHaveBeenCalled();
      await selectLocalFile(container, bundle(), 64 * 1024 * 1024 + 1);
      expect(container.textContent).toContain("64 MiB");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("shows repository-permission failures without opening, posting again or approving a Review", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: "Forbidden repository scope" }) });
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = await renderedPublisher();
    try {
      await selectLocalFile(container, {
        ...bundle(),
        sourceArtIncluded: false,
        payload: { ...bundle().payload, snapshots: [] },
      });
      const publish = [...container.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === "Publish this Review",
      );
      expect(publish?.disabled).toBe(false);
      await act(async () => publish?.click());
      expect(container.textContent).toMatch(/repository|permission/i);
      expect(container.querySelector('a[href^="/reviews/"]')).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
