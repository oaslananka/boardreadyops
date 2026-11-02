import { createHash } from "node:crypto";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ingestRunRequestSchema } from "../../apps/web/app/api/v1/runs/route.js";
import { publishActionRunToCloud } from "../../src/action/cloud-publish.js";
import type { ActionInputs } from "../../src/action/inputs.js";
import type { Logger } from "../../src/core/logger.js";
import type { RunResult } from "../../src/core/result.js";
import { detectKicadCli } from "../../src/kicad/cli.js";

const workspace = process.cwd();
const selected = path.join(workspace, "tests/fixtures/projects/safe-basic");

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  critical: vi.fn(),
} as unknown as Logger;

const result: RunResult = {
  schemaVersion: 1,
  tool: { name: "boardreadyops", version: "1.34.0" },
  summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0, maxSeverity: "info", failed: false },
  findings: [],
  projects: [
    {
      projectFile: "safe-basic.kicad_pro",
      root: ".",
      schematicFiles: ["safe-basic.kicad_sch"],
      boardFiles: ["safe-basic.kicad_pcb"],
      jobsetFiles: [],
    },
  ],
  fabrication: { bom: [], outputs: [] },
  generatedAt: "2026-11-02T00:00:00Z",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Actual KiCad-to-Review Action payload", () => {
  it("renders verified native source artwork and prepares a bounded offline Cloud request", async (context) => {
    const cli = await detectKicadCli();
    if (!process.env.CI) {
      context.skip(!cli.found, "native KiCad CLI not available locally");
      context.skip(!/^10\./u.test(cli.version ?? ""), "KiCad 10 is required for this fixture");
    }
    expect(cli.found).toBe(true);
    expect(cli.version).toMatch(/^10\./u);

    const inputs: ActionInputs = {
      outputs: {},
      githubToken: "",
      uploadSarif: false,
      uploadArtifacts: false,
      commentPr: false,
      commentFormat: "report",
      artifactName: "boardreadyops",
      logLevel: "info",
      logFormat: "text",
      path: selected,
      cloudUpload: "snapshots",
      nativeVisuals: true,
      executionPolicy: "standard",
      kicadCli: cli.path,
    };

    // Fake the *sole* network boundary. Never send source-derived artwork to
    // a live service, even if developer credentials are present on this host.
    const requests: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options: RequestInit) => {
        requests.push({ url, body: JSON.parse(String(options.body)) });
        return new Response(
          JSON.stringify({ ok: true, runId: "fixture-offline", reviewUrl: "/reviews/fixture-offline" }),
          { status: 200 },
        );
      }),
    );
    vi.stubEnv("BOARDREADYOPS_TOKEN", "offline-test-placeholder");
    vi.stubEnv("GITHUB_REPOSITORY", "oaslananka/boardreadyops");
    vi.stubEnv("GITHUB_SHA", "a".repeat(40)); // The wrong dispatch SHA must not be published.
    vi.stubEnv("GITHUB_REF", "refs/heads/fixture-only");

    const published = await publishActionRunToCloud(result, inputs, workspace, logger);
    expect(published.reviewUrl).toBe("https://app.boardreadyops.com/reviews/fixture-offline");
    expect(requests).toHaveLength(1);

    const request = requests[0];
    if (!request) throw new Error("Missing in-memory Cloud request");
    expect(request.url).toBe("https://app.boardreadyops.com/api/v1/runs");
    const parsed = ingestRunRequestSchema.safeParse(request.body);
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error("Native Review request contract violated");

    const payload = parsed.data;
    expect(payload.commitSha).toMatch(/^[0-9a-f]{40}$/u);
    expect(payload.commitSha).not.toBe("a".repeat(40));
    expect(payload.snapshots?.length).toBeGreaterThanOrEqual(3);
    const snapshots = payload.snapshots ?? [];
    expect(snapshots.some((snapshot) => snapshot.kind === "schematic")).toBe(true);
    expect(
      snapshots.some((snapshot) => snapshot.kind === "pcb_layer" && snapshot.sheetOrLayer.endsWith(" / F.Cu")),
    ).toBe(true);
    expect(
      snapshots.some((snapshot) => snapshot.kind === "pcb_layer" && snapshot.sheetOrLayer.endsWith(" / B.Cu")),
    ).toBe(true);
    for (const snapshot of snapshots) {
      expect(snapshot.name).toMatch(/^kicad_native_/u);
      expect(snapshot.format).toBe("svg");
      if (!snapshot.content) throw new Error("Missing native SVG content");
      expect(snapshot.content.length).toBeGreaterThan(200);
      expect(snapshot.sha256).toBe(createHash("sha256").update(snapshot.content).digest("hex"));
    }
    expect(payload.evidenceDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(payload.evidenceDigest).toBe(published.evidencePackId);
  }, 60_000);
});
