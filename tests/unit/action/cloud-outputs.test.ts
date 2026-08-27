import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { publishActionRunToCloud } from "../../../src/action/cloud-publish.js";
import { setActionOutputs } from "../../../src/action/outputs.js";
import { createLogger } from "../../../src/core/logger.js";
import type { RunResult } from "../../../src/core/result.js";

const mockLogger = createLogger({ level: "info", format: "text" });

const dummyResult: RunResult = {
  schemaVersion: 1,
  tool: {
    name: "boardreadyops",
    version: "1.34.0",
  },
  summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0, maxSeverity: "info", failed: false },
  findings: [],
  projects: [],
  fabrication: { bom: [], outputs: [] },
  generatedAt: new Date().toISOString(),
};

describe("Action cloud outputs and publishing", () => {
  it("emits cloud review outputs through setActionOutputs", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "boardready-test-output-"));
    const outputFile = path.join(tempDir, "output.txt");
    await fs.writeFile(outputFile, "");
    process.env.GITHUB_OUTPUT = outputFile;

    try {
      setActionOutputs(dummyResult, {
        sarif: "sarif.json",
        reviewUrl: "https://app.boardreadyops.com/reviews/rev-123",
        cloudRunId: "run-456",
        evidencePackId: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      });

      const contents = await fs.readFile(outputFile, "utf8");
      expect(contents).toContain("review-url<<");
      expect(contents).toContain("https://app.boardreadyops.com/reviews/rev-123");
      expect(contents).toContain("cloud-run-id<<");
      expect(contents).toContain("run-456");
      expect(contents).toContain("evidence-pack-id<<");
      expect(contents).toContain("abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890");
    } finally {
      delete process.env.GITHUB_OUTPUT;
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("skips cloud publishing when no token and no cloudUpload requested", async () => {
    const oldToken = process.env.BOARDREADYOPS_TOKEN;
    delete process.env.BOARDREADYOPS_TOKEN;

    try {
      const res = await publishActionRunToCloud(
        dummyResult,
        {
          outputs: {},
          uploadSarif: false,
          uploadArtifacts: false,
          commentPr: false,
          commentFormat: "report",
          artifactName: "a",
          logLevel: "info",
          logFormat: "text",
        },
        process.cwd(),
        mockLogger,
      );

      expect(res).toEqual({});
    } finally {
      if (oldToken) process.env.BOARDREADYOPS_TOKEN = oldToken;
    }
  });
});
