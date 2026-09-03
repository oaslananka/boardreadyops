import { Window } from "happy-dom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DeadLetterListItem } from "../../../apps/web/app/ops/dead-letters/dead-letter-view-model.js";
import { DeadLettersPanel } from "../../../apps/web/app/ops/dead-letters/dead-letters-panel.js";
import DeadLettersPage from "../../../apps/web/app/ops/dead-letters/page.js";

const domGlobalKeys = ["window", "document", "Node", "Element", "Document", "HTMLElement", "SVGElement"] as const;
type DomGlobalKey = (typeof domGlobalKeys)[number];
type DomGlobalSnapshot = Record<DomGlobalKey, unknown>;

function installDomGlobals(window: Window): DomGlobalSnapshot {
  const globalObject = globalThis as unknown as Record<string, unknown>;
  const previous = Object.fromEntries(domGlobalKeys.map((key) => [key, globalObject[key]])) as DomGlobalSnapshot;
  Object.assign(globalObject, {
    window,
    document: window.document,
    Node: window.Node,
    Element: window.Element,
    Document: window.Document,
    HTMLElement: window.HTMLElement,
    SVGElement: window.SVGElement,
  });
  return previous;
}

function restoreDomGlobals(previous: DomGlobalSnapshot): void {
  const globalObject = globalThis as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) Reflect.deleteProperty(globalObject, key);
    else Reflect.set(globalObject, key, value);
  }
}

async function axeViolations(markup: string, path: string): Promise<string[]> {
  const window = new Window({ url: `https://boardreadyops.example${path}` });
  window.document.write(`<!doctype html><html lang="en"><head><title>Test</title></head><body>${markup}</body></html>`);
  const previous = installDomGlobals(window);
  try {
    const axe = (await import("axe-core")).default;
    const result = await axe.run(window.document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } });
    return result.violations.map((violation) => `${violation.id}: ${violation.help}`);
  } finally {
    restoreDomGlobals(previous);
    await window.close();
  }
}

const replayableItem: DeadLetterListItem = {
  itemType: "job",
  itemId: "job_stuck_1",
  installationId: "ins_acme",
  repositoryFullName: "acme/power-distribution",
  releaseRunId: "run_42",
  reasonCode: "delivery_timeout",
  errorClass: "NetworkError",
  attemptCount: 5,
  failedAt: "2026-09-03T01:02:03.000Z",
  replaySafe: true,
};

const blockedItem: DeadLetterListItem = {
  itemType: "outbox",
  itemId: "outbox_stuck_1",
  installationId: "ins_acme",
  reasonCode: "max_attempts_exceeded",
  attemptCount: 10,
  failedAt: "2026-09-02T00:00:00.000Z",
  replaySafe: false,
};

function noop() {
  /* not exercised in static-markup assertions */
}

describe("DeadLettersPage", () => {
  it("renders breadcrumbs, heading, and the connect form", () => {
    const markup = renderToStaticMarkup(createElement(DeadLettersPage));
    expect(markup).toContain("Dead-Letter Queue");
    expect(markup).toContain("Ops");
    expect(markup).toContain("Installation ID");
    expect(markup).toContain("Operator bearer token");
  });
});

describe("DeadLettersPanel states", () => {
  it("prompts for credentials while idle", () => {
    const markup = renderToStaticMarkup(
      createElement(DeadLettersPanel, {
        state: "idle",
        items: [],
        hasMore: false,
        onLoadMore: noop,
        onReplay: noop,
        replayState: {},
      }),
    );
    expect(markup).toContain("Enter an installation and operator token");
  });

  it("shows a loading indicator", () => {
    const markup = renderToStaticMarkup(
      createElement(DeadLettersPanel, {
        state: "loading",
        items: [],
        hasMore: false,
        onLoadMore: noop,
        onReplay: noop,
        replayState: {},
      }),
    );
    expect(markup).toContain("Loading dead letters");
  });

  it("phrases the empty result as good news", () => {
    const markup = renderToStaticMarkup(
      createElement(DeadLettersPanel, {
        state: "loaded",
        items: [],
        hasMore: false,
        onLoadMore: noop,
        onReplay: noop,
        replayState: {},
      }),
    );
    expect(markup).toContain("No dead letters");
    expect(markup).toContain("Nothing is stuck");
  });

  it("surfaces the server error message", () => {
    const markup = renderToStaticMarkup(
      createElement(DeadLettersPanel, {
        state: "error",
        error: "operator authentication is required",
        items: [],
        hasMore: false,
        onLoadMore: noop,
        onReplay: noop,
        replayState: {},
      }),
    );
    expect(markup).toContain("Could not load dead letters");
    expect(markup).toContain("operator authentication is required");
  });

  it("renders the populated table with job id, run id, installation, reason, attempts, and failed-at columns", () => {
    const markup = renderToStaticMarkup(
      createElement(DeadLettersPanel, {
        state: "loaded",
        items: [replayableItem, blockedItem],
        hasMore: true,
        onLoadMore: noop,
        onReplay: noop,
        replayState: {},
      }),
    );
    expect(markup).toContain("job_stuck_1");
    expect(markup).toContain("run_42");
    expect(markup).toContain("acme/power-distribution");
    expect(markup).toContain("delivery_timeout (NetworkError)");
    expect(markup).toContain("2026-09-03 01:02");
    expect(markup).toContain("Load older dead letters");
  });

  it("offers Replay only for replay-safe items and blocks the rest", () => {
    const markup = renderToStaticMarkup(
      createElement(DeadLettersPanel, {
        state: "loaded",
        items: [replayableItem, blockedItem],
        hasMore: false,
        onLoadMore: noop,
        onReplay: noop,
        replayState: {},
      }),
    );
    expect(markup).toContain(">Replay<");
    expect(markup).toContain("Not replayable");
  });
});

describe("DeadLettersPage accessibility", () => {
  it("has no WCAG A/AA violations on the connect form", async () => {
    const html = renderToStaticMarkup(createElement(DeadLettersPage));
    const violations = await axeViolations(html, "/ops/dead-letters");
    expect(violations).toEqual([]);
  });

  it("has no WCAG A/AA violations on the populated dead-letter table", async () => {
    const html = renderToStaticMarkup(
      createElement(DeadLettersPanel, {
        state: "loaded",
        items: [replayableItem, blockedItem],
        hasMore: true,
        onLoadMore: noop,
        onReplay: noop,
        replayState: {},
      }),
    );
    const violations = await axeViolations(html, "/ops/dead-letters");
    expect(violations).toEqual([]);
  });
});
