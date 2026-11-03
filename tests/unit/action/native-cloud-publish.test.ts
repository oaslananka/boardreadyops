import { createHash } from "node:crypto";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ingestRunRequestSchema } from "../../../apps/web/app/api/v1/runs/route.js";
import { publishActionRunToCloud } from "../../../src/action/cloud-publish.js";
import type { ActionInputs } from "../../../src/action/inputs.js";
import type { Logger } from "../../../src/core/logger.js";
import type { RunResult } from "../../../src/core/result.js";
import { generateSnapshots } from "../../../src/kicad/snapshots.js";

vi.mock("../../../src/kicad/snapshots.js", () => ({ generateSnapshots: vi.fn() }));

const logger: Logger = {
  level: "silent",
  json: false,
  format: "text",
  sessionId: "test",
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  critical: vi.fn(),
};

const workspace = process.cwd();
const selected = path.join(workspace, "tests/fixtures/projects/safe-basic");
const fakeNative = {
  id: "native-board",
  name: "kicad_native_board_F_Cu.svg",
  kind: "pcb_layer" as const,
  format: "svg" as const,
  sheetOrLayer: "F.Cu",
  width: 1280,
  height: 720,
  content: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  sha256: createHash("sha256").update('<svg xmlns="http://www.w3.org/2000/svg"></svg>').digest("hex"),
  anchors: [],
};
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

function inputs(extra: Partial<ActionInputs> = {}): ActionInputs {
  return {
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
    ...extra,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function expectCloudRequest() {
  const mock = vi.mocked(fetch);
  expect(mock).toHaveBeenCalledTimes(1);
  const call = mock.mock.calls[0];
  if (!call) throw new Error("expected exactly one cloud request");
  const [url, init] = call;
  expect(url).toBe("https://app.boardreadyops.com/api/v1/runs");
  const body = JSON.parse(String(init?.body));
  if (!init?.headers) throw new Error("expected cloud request headers");
  return { body, init: { ...init, headers: init.headers as Record<string, string> } };
}

describe("Action opt-in native artwork publication", () => {
  it("publishes only genuine native snapshots with an exact checkout SHA and scoped bearer-token endpoint", async () => {
    vi.stubEnv("BOARDREADYOPS_TOKEN", "test-token");
    vi.stubEnv("GITHUB_SHA", "b".repeat(40));
    vi.stubEnv("GITHUB_REPOSITORY", "boardreadyops/boardreadyops-e2e-public");
    vi.stubEnv("GITHUB_REF", "refs/pull/10/merge");
    vi.stubEnv("GITHUB_EVENT_NAME", "pull_request");
    vi.mocked(generateSnapshots).mockResolvedValue([
      fakeNative,
      { ...fakeNative, id: "fallback", name: "pcb_F_Cu.svg" },
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            runId: "offline-run",
            reviewUrl: "/reviews/offline-run",
          }),
          { status: 200 },
        ),
      ),
    );

    const published = await publishActionRunToCloud(result, inputs(), workspace, logger);
    const { body, init } = expectCloudRequest();
    expect(published.reviewUrl).toBe("https://app.boardreadyops.com/reviews/offline-run");
    expect(body.repositoryId).toBe("boardreadyops/boardreadyops-e2e-public");
    expect(body.pullRequestNumber).toBe(10);
    expect(body.commitSha).toMatch(/^[0-9a-f]{40}$/u);
    expect(body.commitSha).not.toBe("b".repeat(40));
    expect(body.snapshots).toEqual([fakeNative]);
    expect(body.evidenceDigest).toBe(published.evidencePackId);
    expect(body.evidenceDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(ingestRunRequestSchema.safeParse(body).success).toBe(true);
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer test-token",
    });
    expect(init.headers["Idempotency-Key"]).toContain("-native-");
    expect(generateSnapshots).toHaveBeenCalledWith(
      expect.objectContaining({
        schematicFiles: [path.join(selected, "safe-basic.kicad_sch")],
        pcbFiles: [path.join(selected, "safe-basic.kicad_pcb")],
      }),
    );
  });

  it.each([
    { caseName: "no explicit image consent", extra: { nativeVisuals: false } },
    { caseName: "metadata-only upload", extra: { cloudUpload: "metadata" as const } },
    { caseName: "raw source option", extra: { cloudUpload: "source" as const } },
    { caseName: "safe-mode execution", extra: { executionPolicy: "safe" as const } },
  ])("sends findings-only for $caseName", async ({ extra }) => {
    vi.stubEnv("BOARDREADYOPS_TOKEN", "test-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, runId: "x" }), { status: 200 })),
    );
    await publishActionRunToCloud(result, inputs(extra), workspace, logger);
    const { body, init } = expectCloudRequest();
    expect(body).not.toHaveProperty("snapshots");
    expect(generateSnapshots).not.toHaveBeenCalled();
    expect(init.headers["Idempotency-Key"]).not.toContain("-native-");
  });

  it("cannot upload images without a runs-write bearer token", async () => {
    vi.stubEnv("BOARDREADYOPS_TOKEN", "");
    vi.stubGlobal("fetch", vi.fn());
    const response = await publishActionRunToCloud(result, inputs(), workspace, logger);
    expect(response.evidencePackId).toMatch(/^[0-9a-f]{64}$/u);
    expect(fetch).not.toHaveBeenCalled();
    expect(generateSnapshots).not.toHaveBeenCalled();
  });

  it("rejects source paths outside the chosen project tree without exposing their image bytes", async () => {
    vi.stubEnv("BOARDREADYOPS_TOKEN", "test-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, runId: "x" }), { status: 200 })),
    );
    const original = result.projects[0];
    if (!original) throw new Error("missing test project");
    const outside: RunResult = {
      ...result,
      projects: [{ ...original, boardFiles: ["../../../../etc/passwd"] }],
    };
    await publishActionRunToCloud(outside, inputs(), workspace, logger);
    const { body } = expectCloudRequest();
    expect(body).not.toHaveProperty("snapshots");
    expect(generateSnapshots).not.toHaveBeenCalled();
  });
});
