import { Window } from "happy-dom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ArtifactsView,
  AttemptsView,
  FindingsView,
  RunPageFrame,
  SummaryView,
} from "../../../apps/web/components/run-investigation.js";
import type { RunDetail } from "../../../apps/web/lib/run-dashboard.js";

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

function sampleRun(): RunDetail {
  return {
    id: "run-accessible",
    status: "completed",
    decision: "pass",
    commitSha: "0123456789abcdef0123456789abcdef01234567",
    ref: "refs/heads/main",
    pullRequestNumber: 221,
    triggerKind: "pull_request",
    startedAt: "2026-07-30T00:00:00.000Z",
    completedAt: "2026-07-30T00:02:00.000Z",
    durationMs: 120_000,
    boardReadyOpsVersion: "1.22.0",
    kicadVersion: "10.0",
    githubCheckRunId: "123456",
    readinessScore: 96,
    resultContractVersion: 1,
    conclusion: "success",
    metrics: { readinessScore: 96 },
    reportLinks: [],
    lastPublicationAttemptAt: "2026-07-30T00:02:00.000Z",
    githubCheckPublishedAt: "2026-07-30T00:02:01.000Z",
    githubCommentPublishedAt: undefined,
    lastPublicationError: undefined,
    repository: "oaslananka/boardreadyops",
    repositoryPrivate: false,
    trustMode: "safe",
    safeModeReasons: ["private-repository"],
    investigationState: "completed",
    reconciliationCount: 0,
    deadLetterCount: 0,
    lastActivityAt: "2026-07-30T00:02:00.000Z",
    findings: [
      {
        id: "finding-1",
        ruleId: "bom.missing-mpn",
        severity: "high",
        message: "A populated component has no manufacturer part number.",
        path: "hardware/main.kicad_sch",
        kind: "bom",
        waivedAt: undefined,
      },
    ],
    findingsPage: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
    artifacts: [
      {
        id: "artifact-1",
        kind: "report",
        name: "boardreadyops.report.html",
        sha256: "a".repeat(64),
        bytes: 2048,
        role: "primary",
        contentType: "text/html",
        executionAttemptId: undefined,
        uploadedAt: "2026-07-30T00:02:00.000Z",
        downloadUrl: "https://boardreadyops.example/runs/run-accessible/artifacts/artifact-1",
        availability: "available",
        retention: "no-automatic-expiry",
        retentionUntil: undefined,
      },
    ],
    artifactsPage: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
    artifactLifecycle: { deleted: 1, missing: 1, pendingDeletion: 1, failedDeletion: 0 },
    attempts: [],
    transitions: [],
    boards: [
      {
        boardId: "7b000000-0000-4000-8000-0000000000b1",
        project: "hardware/mainboard/mainboard.kicad_pro",
        displayName: "mainboard",
        capturedAt: "2026-07-10T16:05:00.000Z",
        componentCount: 3,
        identifiedComponentCount: 2,
        unidentifiedComponentCount: 1,
        riskyLifecycleCount: 1,
      },
    ],
  };
}

function viewMarkup(view: "artifacts" | "attempts" | "findings" | "summary"): string {
  const run = sampleRun();
  const children =
    view === "summary"
      ? createElement(SummaryView, { run })
      : view === "attempts"
        ? createElement(AttemptsView, { run })
        : view === "findings"
          ? createElement(FindingsView, { run, searchParameters: { findingGroup: "severity" } })
          : createElement(ArtifactsView, { run, searchParameters: {} });
  return renderToStaticMarkup(createElement(RunPageFrame, { run, active: view, children }));
}

async function axeViolations(markup: string, path: string): Promise<string[]> {
  const window = new Window({ url: `https://boardreadyops.example${path}` });
  window.document.write(
    `<!doctype html><html lang="en"><head><title>Run investigation</title></head><body>${markup}</body></html>`,
  );
  const previous = installDomGlobals(window);
  try {
    const axe = (await import("axe-core")).default;
    const result = await axe.run(window.document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
    });
    return result.violations.map((violation) => `${violation.id}: ${violation.help}`);
  } finally {
    restoreDomGlobals(previous);
    await window.close();
  }
}

describe("run investigation accessibility", () => {
  it("links GitHub Actions logs and repository-owned artifacts from the authoritative workflow run", () => {
    const run = sampleRun();
    run.attempts = [
      {
        id: "attempt-1",
        attemptNumber: 1,
        status: "completed",
        createdAt: run.startedAt,
        dispatchRequestedAt: run.startedAt,
        dispatchedAt: run.startedAt,
        startedAt: run.startedAt,
        heartbeatAt: run.completedAt,
        completedAt: run.completedAt,
        retryAfterAt: undefined,
        workflowDispatchId: "456789",
        workflowRunUrl: "https://github.com/oaslananka/boardreadyops/actions/runs/456789",
        failureClass: undefined,
        failureMessage: undefined,
        resultDigest: "b".repeat(64),
      },
    ];

    const summary = renderToStaticMarkup(createElement(SummaryView, { run }));
    const attempts = renderToStaticMarkup(createElement(AttemptsView, { run }));
    const artifacts = renderToStaticMarkup(createElement(ArtifactsView, { run, searchParameters: {} }));

    for (const markup of [summary, attempts, artifacts]) {
      expect(markup).toContain("https://github.com/oaslananka/boardreadyops/actions/runs/456789");
    }
    expect(summary).toContain("Open GitHub Actions run");
    expect(attempts).toContain("Open workflow logs and artifacts");
    expect(artifacts).toContain("Open repository-owned GitHub Actions artifacts");
  });

  it("puts decision and evidence identity ahead of secondary metadata", () => {
    const markup = viewMarkup("summary");
    expect(markup).toContain("Release readiness");
    expect(markup).toContain("Readiness score");
    expect(markup).toContain("Open this run in GitHub");

    // The verdict is the answer somebody came for, so it comes before the evidence that
    // supports it. Asserting the order rather than mere presence is the point of this test's
    // name; the identity header above it only says which run this is.
    expect(markup).toContain("Ready to fabricate");
    expect(markup.indexOf("Ready to fabricate")).toBeLessThan(markup.indexOf("Source and runtime"));
    expect(markup.indexOf("Ready to fabricate")).toBeLessThan(markup.indexOf("Open this run in GitHub"));

    // The header states which run this is; the verdict states the outcome. Repeating the
    // outcome in both is what made the page read as a status dump.
    expect(markup).not.toContain("Decision: Pass");
  });

  it("preserves bounded evidence controls while changing presentation", () => {
    const findings = viewMarkup("findings");
    const artifacts = viewMarkup("artifacts");
    expect(findings).toContain('name="findingSearch"');
    expect(findings).toContain('name="findingSeverity"');
    expect(findings).toContain('name="findingGroup"');
    expect(artifacts).toContain('name="artifactSearch"');
    expect(artifacts).toContain("Download signed copy");
  });

  it("renders stable investigation flow snapshots", () => {
    expect({
      summary: viewMarkup("summary"),
      attempts: viewMarkup("attempts"),
      findings: viewMarkup("findings"),
      artifacts: viewMarkup("artifacts"),
    }).toMatchSnapshot();
  });

  it.each([
    ["summary", "/runs/run-accessible"],
    ["attempts", "/runs/run-accessible/attempts"],
    ["findings", "/runs/run-accessible/findings"],
    ["artifacts", "/runs/run-accessible/artifacts"],
  ] as const)("has no WCAG A/AA axe violations in the %s flow", async (view, path) => {
    await expect(axeViolations(viewMarkup(view), path)).resolves.toEqual([]);
  });
});
