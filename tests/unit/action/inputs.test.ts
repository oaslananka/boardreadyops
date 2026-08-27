import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { detectActionGate, readActionInputs } from "../../../src/action/inputs.js";

describe("action gate detection", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["pull_request", "refs/pull/7/merge", "pull_request"],
    ["pull_request_target", "refs/heads/main", "pull_request"],
    ["push", "refs/heads/main", "main"],
    ["push", "refs/tags/v1.0.0", "release"],
    ["workflow_dispatch", "refs/heads/feature", "main"],
  ])("detects %s on %s as %s", (event, ref, gate) => {
    expect(detectActionGate(event, ref)).toBe(gate);
  });

  it("uses auto-detected gates when the Action input is empty", () => {
    vi.stubEnv("INPUT_GATE", "");
    vi.stubEnv("GITHUB_EVENT_NAME", "push");
    vi.stubEnv("GITHUB_REF", "refs/tags/v1.0.0");

    expect(readActionInputs(path.resolve("."))).toMatchObject({ gate: "release", gateAutoDetected: true });
  });

  it("parses explicit Action inputs", () => {
    const workspace = path.resolve(".");
    vi.stubEnv("INPUT_PATH", "hardware");
    vi.stubEnv("INPUT_PROJECT", "hardware/board.kicad_pro");
    vi.stubEnv("INPUT_CONFIG", "config/custom.yml");
    vi.stubEnv("INPUT_MODE", "enforce");
    vi.stubEnv("INPUT_REQUIRE-KICAD", "yes");
    vi.stubEnv("INPUT_SAFE-MODE", "true");
    vi.stubEnv("INPUT_KICAD-CLI", "kicad-cli");
    vi.stubEnv("INPUT_BOM", "bom/production.csv");
    vi.stubEnv("INPUT_PINMAP", "pinmaps/header.csv");
    vi.stubEnv("INPUT_VARIANT", "production");
    vi.stubEnv("INPUT_GATE", "release");
    vi.stubEnv("INPUT_FAIL-ON", "medium");
    vi.stubEnv("INPUT_ANNOTATIONS", "no");
    vi.stubEnv("INPUT_SARIF", "reports/findings.sarif.json");
    vi.stubEnv("INPUT_JSON", "reports/findings.json");
    vi.stubEnv("INPUT_MARKDOWN", "reports/findings.md");
    vi.stubEnv("INPUT_HBOM", "reports/hbom.json");
    vi.stubEnv("INPUT_UPLOAD-SARIF", "0");
    vi.stubEnv("INPUT_UPLOAD-ARTIFACTS", "1");
    vi.stubEnv("INPUT_COMMENT-PR", "false");
    vi.stubEnv("INPUT_ARTIFACT-NAME", "boardreadyops-release");
    vi.stubEnv("INPUT_LOG-LEVEL", "debug");
    vi.stubEnv("INPUT_LOG-FORMAT", "json");
    vi.stubEnv("INPUT_LOG-FILE", "logs/boardreadyops.jsonl");
    vi.stubEnv("INPUT_LOG-FILE-MAX-BYTES", "8192");
    vi.stubEnv("INPUT_LOG-FILE-RETENTION", "2");

    expect(readActionInputs(workspace)).toMatchObject({
      path: path.join(workspace, "hardware"),
      project: path.join(workspace, "hardware/board.kicad_pro"),
      config: path.join(workspace, "config/custom.yml"),
      mode: "enforce",
      requireKicad: true,
      executionPolicy: "safe",
      kicadCli: "kicad-cli",
      bom: path.join(workspace, "bom/production.csv"),
      pinmap: path.join(workspace, "pinmaps/header.csv"),
      variant: "production",
      gate: "release",
      gateAutoDetected: false,
      failOn: "medium",
      annotations: false,
      outputs: {
        sarif: path.join(workspace, "reports/findings.sarif.json"),
        json: path.join(workspace, "reports/findings.json"),
        markdown: path.join(workspace, "reports/findings.md"),
        hbom: path.join(workspace, "reports/hbom.json"),
      },
      uploadSarif: false,
      uploadArtifacts: true,
      commentPr: false,
      artifactName: "boardreadyops-release",
      logLevel: "debug",
      logFormat: "json",
      logFile: path.join(workspace, "logs/boardreadyops.jsonl"),
      logFileMaxBytes: 8192,
      logFileRetention: 2,
    });
  });

  it("rejects invalid parser values", () => {
    vi.stubEnv("INPUT_MODE", "report");
    expect(() => readActionInputs(path.resolve("."))).toThrow("Input mode must be warn or enforce.");

    vi.unstubAllEnvs();
    vi.stubEnv("INPUT_FAIL-ON", "blocker");
    expect(() => readActionInputs(path.resolve("."))).toThrow(
      "Input fail-on must be critical, high, medium, low, or never.",
    );

    vi.unstubAllEnvs();
    vi.stubEnv("INPUT_REQUIRE-KICAD", "sometimes");
    expect(() => readActionInputs(path.resolve("."))).toThrow("Input require-kicad must be true or false.");

    vi.unstubAllEnvs();
    vi.stubEnv("INPUT_LOG-LEVEL", "trace");
    expect(() => readActionInputs(path.resolve("."))).toThrow(
      "Input log-level must be debug, info, warn, error, critical, or silent.",
    );

    vi.unstubAllEnvs();
    vi.stubEnv("INPUT_LOG-FORMAT", "xml");
    expect(() => readActionInputs(path.resolve("."))).toThrow("Input log-format must be text or json.");

    vi.unstubAllEnvs();
    vi.stubEnv("INPUT_LOG-FILE-MAX-BYTES", "0");
    expect(() => readActionInputs(path.resolve("."))).toThrow("Input log-file-max-bytes must be a positive integer.");

    vi.unstubAllEnvs();
    vi.stubEnv("INPUT_LOG-FILE-RETENTION", "-1");
    expect(() => readActionInputs(path.resolve("."))).toThrow(
      "Input log-file-retention must be a non-negative integer.",
    );
  });

  it("rejects unsafe workspace paths, artifact names, and invalid cloud upload modes", () => {
    vi.stubEnv("INPUT_PATH", "../outside");
    expect(() => readActionInputs(path.resolve("."))).toThrow("Input path must stay inside GITHUB_WORKSPACE");

    vi.unstubAllEnvs();
    vi.stubEnv("INPUT_ARTIFACT-NAME", "bad/name");
    expect(() => readActionInputs(path.resolve("."))).toThrow("artifact-name must be a non-empty artifact name.");

    vi.unstubAllEnvs();
    vi.stubEnv("INPUT_CLOUD-UPLOAD", "invalid-mode");
    expect(() => readActionInputs(path.resolve("."))).toThrow(
      "Input cloud-upload must be metadata, snapshots, or source.",
    );
  });

  it("parses valid cloud-upload input", () => {
    vi.stubEnv("INPUT_CLOUD-UPLOAD", "snapshots");
    vi.stubEnv("INPUT_CLOUD-SERVER", "https://custom.boardreadyops.com");
    expect(readActionInputs(path.resolve("."))).toMatchObject({
      cloudUpload: "snapshots",
      cloudServer: "https://custom.boardreadyops.com",
    });
  });
});
