import type { ReleaseRunFinding } from "@boardreadyops/contracts";
import { describe, expect, it } from "vitest";
import { normalizeGitHubAppWebhook } from "../../../packages/cloud-core/src/lifecycle.js";
import {
  findingsToCheckRunAnnotations,
  findingToCheckRunAnnotation,
} from "../../../packages/cloud-core/src/lifecycle-executor.js";

describe("Check Run Actions & File Annotations", () => {
  describe("findingToCheckRunAnnotation bounds and safety", () => {
    it("maps line-addressable text and config files to annotations", () => {
      const finding: ReleaseRunFinding = {
        ruleId: "config.valid-preset",
        severity: "error",
        message: "Invalid mode specified in configuration",
        path: "boardreadyops.yml",
        startLine: 2,
        endLine: 2,
      };
      const annotation = findingToCheckRunAnnotation(finding);
      expect(annotation).toBeDefined();
      expect(annotation?.path).toBe("boardreadyops.yml");
      expect(annotation?.startLine).toBe(2);
      expect(annotation?.endLine).toBe(2);
      expect(annotation?.annotationLevel).toBe("failure");
    });

    it("rejects non-line-addressable CAD binary files", () => {
      const stepFinding: ReleaseRunFinding = {
        ruleId: "mfg.3d-model",
        severity: "info",
        message: "Missing STEP model",
        path: "models/c1.step",
        startLine: 1,
      };
      expect(findingToCheckRunAnnotation(stepFinding)).toBeUndefined();

      const zipFinding: ReleaseRunFinding = {
        ruleId: "mfg.gerber-archive",
        severity: "error",
        message: "Corrupted archive",
        path: "outputs/gerbers.zip",
        startLine: 1,
      };
      expect(findingToCheckRunAnnotation(zipFinding)).toBeUndefined();

      const pdfFinding: ReleaseRunFinding = {
        ruleId: "doc.datasheet",
        severity: "low",
        message: "Outdated datasheet",
        path: "docs/datasheet.pdf",
        startLine: 1,
      };
      expect(findingToCheckRunAnnotation(pdfFinding)).toBeUndefined();
    });

    it("handles invalid or malformed line data safely", () => {
      const zeroLine: ReleaseRunFinding = {
        ruleId: "bom.missing-mpn",
        severity: "high",
        message: "Missing MPN",
        path: "bom.csv",
        startLine: 0,
      };
      expect(findingToCheckRunAnnotation(zeroLine)).toBeUndefined();

      const negativeLine: ReleaseRunFinding = {
        ruleId: "bom.missing-mpn",
        severity: "high",
        message: "Missing MPN",
        path: "bom.csv",
        startLine: -5,
      };
      expect(findingToCheckRunAnnotation(negativeLine)).toBeUndefined();

      const reversedRange: ReleaseRunFinding = {
        ruleId: "bom.missing-mpn",
        severity: "high",
        message: "Missing MPN",
        path: "bom.csv",
        startLine: 10,
        endLine: 5,
      };
      const annotation = findingToCheckRunAnnotation(reversedRange);
      expect(annotation).toBeDefined();
      expect(annotation?.startLine).toBe(10);
      expect(annotation?.endLine).toBe(10); // normalized to startLine
    });
  });

  describe("findingsToCheckRunAnnotations deduplication and capping", () => {
    it("deduplicates identical findings", () => {
      const findings: ReleaseRunFinding[] = [
        {
          ruleId: "bom.missing-mpn",
          severity: "high",
          message: "Duplicate row",
          path: "bom.csv",
          startLine: 5,
          endLine: 5,
        },
        {
          ruleId: "bom.missing-mpn",
          severity: "high",
          message: "Duplicate row",
          path: "bom.csv",
          startLine: 5,
          endLine: 5,
        },
      ];
      const annotations = findingsToCheckRunAnnotations(findings);
      expect(annotations).toHaveLength(1);
    });

    it("caps annotations at GitHub limit of 500", () => {
      const findings: ReleaseRunFinding[] = Array.from({ length: 600 }, (_, i) => ({
        ruleId: `rule.${i}`,
        severity: "medium",
        message: `Issue at row ${i + 1}`,
        path: "bom.csv",
        startLine: i + 1,
        endLine: i + 1,
      }));
      const annotations = findingsToCheckRunAnnotations(findings);
      expect(annotations.length).toBeLessThanOrEqual(500);
    });
  });

  describe("Check Run webhook normalization", () => {
    const basePayload = {
      installation: { id: 12345 },
      repository: {
        id: 999,
        name: "board",
        full_name: "octo/board",
        owner: { login: "octo" },
        private: false,
        default_branch: "main",
      },
      check_run: {
        id: 8888,
        head_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        check_suite: {
          pull_requests: [
            {
              number: 10,
              head: {
                ref: "feature/usb-c",
                sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                repo: { full_name: "octo/board", fork: false },
              },
              base: {
                ref: "main",
                sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              },
            },
          ],
        },
      },
    };

    it("normalizes check_run rerequested into release_run.enqueue", () => {
      const result = normalizeGitHubAppWebhook({
        event: "check_run",
        delivery: "del_1",
        payload: {
          ...basePayload,
          action: "rerequested",
        },
      });

      expect(result.accepted).toBe(true);
      expect(result.actions).toHaveLength(1);
      const action = result.actions[0];
      expect(action?.type).toBe("release_run.enqueue");
      if (action && action.type === "release_run.enqueue") {
        expect(action.pullRequestNumber).toBe(10);
        expect(action.commitSha).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        expect(action.baseCommitSha).toBe("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
      }
    });

    it("normalizes requested_action rerun_checks into release_run.enqueue", () => {
      const result = normalizeGitHubAppWebhook({
        event: "check_run",
        delivery: "del_2",
        payload: {
          ...basePayload,
          action: "requested_action",
          requested_action: { identifier: "rerun_checks" },
        },
      });

      expect(result.accepted).toBe(true);
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0]?.type).toBe("release_run.enqueue");
    });

    it("normalizes requested_action create_setup_pr into setup_pr.create action", () => {
      const result = normalizeGitHubAppWebhook({
        event: "check_run",
        delivery: "del_3",
        payload: {
          ...basePayload,
          action: "requested_action",
          requested_action: { identifier: "create_setup_pr" },
          sender: { login: "octocat" },
        },
      });

      expect(result.accepted).toBe(true);
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0]).toMatchObject({ type: "setup_pr.create", requestedBy: "octocat" });
    });
  });
});
