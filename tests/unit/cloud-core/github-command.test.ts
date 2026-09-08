import { describe, expect, it } from "vitest";
import {
  evaluateCommandAuthorization,
  executeParsedCommand,
  parseGitHubCommand,
} from "../../../packages/cloud-core/src/github-command.js";

describe("GitHub PR slash command parsing", () => {
  it("ignores regular comments that do not invoke /boardreadyops", () => {
    expect(parseGitHubCommand("Great work on this PCB layout!")).toBeUndefined();
    expect(parseGitHubCommand("We should check /boardreadyops documentation.")).toBeUndefined();
    expect(parseGitHubCommand("")).toBeUndefined();
  });

  it("parses help command", () => {
    const cmd = parseGitHubCommand("/boardreadyops help");
    expect(cmd).toEqual({ kind: "help" });
  });

  it("parses status command", () => {
    const cmd = parseGitHubCommand("/boardreadyops status");
    expect(cmd).toEqual({ kind: "status" });
  });

  it("parses rerun command", () => {
    const cmd = parseGitHubCommand("/boardreadyops rerun");
    expect(cmd).toEqual({ kind: "rerun" });
  });

  it("parses diff command", () => {
    const cmd = parseGitHubCommand("/boardreadyops diff");
    expect(cmd).toEqual({ kind: "diff" });
  });

  it("parses release-preview command", () => {
    const cmd = parseGitHubCommand("/boardreadyops release-preview");
    expect(cmd).toEqual({ kind: "release-preview" });
  });

  it("parses explain command with finding id", () => {
    const cmd = parseGitHubCommand("/boardreadyops explain bom.missing-mpn");
    expect(cmd).toEqual({
      kind: "explain",
      ruleId: "bom.missing-mpn",
    });
  });

  it("parses setup command", () => {
    const cmd = parseGitHubCommand("/boardreadyops setup");
    expect(cmd).toEqual({ kind: "setup" });
  });

  it("parses waive command with rule and quoted reason", () => {
    const cmd = parseGitHubCommand('/boardreadyops waive bom.missing-mpn --reason "Lab prototype only"');
    expect(cmd).toEqual({
      kind: "waive",
      ruleId: "bom.missing-mpn",
      reason: "Lab prototype only",
    });
  });

  it("parses fix command with optional rule id", () => {
    const cmd1 = parseGitHubCommand("/boardreadyops fix");
    expect(cmd1).toEqual({ kind: "fix" });

    const cmd2 = parseGitHubCommand("/boardreadyops fix drc.clearance");
    expect(cmd2).toEqual({
      kind: "fix",
      ruleId: "drc.clearance",
    });
  });

  it("tolerates leading whitespace, bot mentions, and trailing commentary", () => {
    const cmd = parseGitHubCommand("  @boardreadyops /boardreadyops status \n\nThanks!");
    expect(cmd).toEqual({ kind: "status" });

    const bangCmd = parseGitHubCommand("!boardreadyops rerun");
    expect(bangCmd).toEqual({ kind: "rerun" });

    const tabCmd = parseGitHubCommand("@bot\t/boardreadyops diff");
    expect(tabCmd).toEqual({ kind: "diff" });
  });

  it("handles pathological inputs linearly without polynomial backtracking", () => {
    const spaces = " ".repeat(5000);
    const pathological = `@bot${spaces}/boardreadyops status`;
    const start = performance.now();
    const cmd = parseGitHubCommand(pathological);
    const duration = performance.now() - start;
    expect(cmd).toEqual({ kind: "status" });
    expect(duration).toBeLessThan(100);
  });

  it("rejects malformed or injection finding IDs", () => {
    expect(parseGitHubCommand("/boardreadyops explain ../../secret")).toBeUndefined();
    expect(parseGitHubCommand("/boardreadyops explain <script>alert(1)</script>")).toBeUndefined();
  });
});

describe("GitHub PR command authorization", () => {
  it("allows read-only commands for any author association", () => {
    for (const assoc of ["OWNER", "MEMBER", "COLLABORATOR", "CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", "NONE"]) {
      const auth = evaluateCommandAuthorization({ kind: "help" }, assoc);
      expect(auth.authorized).toBe(true);

      const statusAuth = evaluateCommandAuthorization({ kind: "status" }, assoc);
      expect(statusAuth.authorized).toBe(true);

      const explainAuth = evaluateCommandAuthorization({ kind: "explain", ruleId: "bom.missing-mpn" }, assoc);
      expect(explainAuth.authorized).toBe(true);
    }
  });

  it("allows mutating commands only for repository collaborators, members, and owners", () => {
    for (const assoc of ["OWNER", "MEMBER", "COLLABORATOR"]) {
      expect(evaluateCommandAuthorization({ kind: "rerun" }, assoc).authorized).toBe(true);
      expect(evaluateCommandAuthorization({ kind: "setup" }, assoc).authorized).toBe(true);
      expect(evaluateCommandAuthorization({ kind: "waive", ruleId: "r1" }, assoc).authorized).toBe(true);
      expect(evaluateCommandAuthorization({ kind: "fix" }, assoc).authorized).toBe(true);
      expect(evaluateCommandAuthorization({ kind: "release-preview" }, assoc).authorized).toBe(true);
    }

    for (const assoc of ["CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", "NONE", "UNKNOWN"]) {
      const auth = evaluateCommandAuthorization({ kind: "setup" }, assoc);
      expect(auth.authorized).toBe(false);
      expect(auth.reason).toContain("write permissions");
      expect(evaluateCommandAuthorization({ kind: "release-preview" }, assoc).authorized).toBe(false);
    }
  });
});

describe("GitHub PR command execution planning", () => {
  const baseContext = {
    repository: {
      id: 1,
      owner: "octo-org",
      name: "hardware-board",
      fullName: "octo-org/hardware-board",
      private: false,
      defaultBranch: "main",
    },
    installation: { id: 123 },
    pullRequestNumber: 42,
    headCommitSha: "0123456789abcdef0123456789abcdef01234567",
    headRef: "feature/board-rev-b",
    author: "engineer1",
  };

  it("generates markdown response for help command", () => {
    const plan = executeParsedCommand({ kind: "help" }, baseContext);
    expect(plan.kind).toBe("comment");
    if (plan.kind === "comment") {
      expect(plan.body).toContain("/boardreadyops status");
      expect(plan.body).toContain("/boardreadyops rerun");
      expect(plan.body).toContain("/boardreadyops setup");
      expect(plan.body).toContain("/boardreadyops waive");
    }
  });

  it("generates markdown response for explain command", () => {
    const plan = executeParsedCommand({ kind: "explain", ruleId: "bom.missing-mpn" }, baseContext);
    expect(plan.kind).toBe("comment");
    if (plan.kind === "comment") {
      expect(plan.body).toContain("bom.missing-mpn");
      expect(plan.body).toContain("Manufacturer Part Number");
    }
  });

  it("generates release_run.enqueue action for rerun command", () => {
    const plan = executeParsedCommand({ kind: "rerun" }, baseContext);
    expect(plan.kind).toBe("action");
    if (plan.kind === "action" && plan.action.type === "release_run.enqueue") {
      expect(plan.action.type).toBe("release_run.enqueue");
      expect(plan.action.pullRequestNumber).toBe(42);
    }
  });

  it("generates setup_pr.create action for setup command", () => {
    const plan = executeParsedCommand({ kind: "setup" }, baseContext);
    expect(plan.kind).toBe("action");
    if (plan.kind === "action" && plan.action.type === "setup_pr.create") {
      expect(plan.action.type).toBe("setup_pr.create");
      expect(plan.action.requestedBy).toBe("engineer1");
    }
  });

  it("generates waiver_pr.request action for waive command", () => {
    const plan = executeParsedCommand({ kind: "waive", ruleId: "bom.missing-mpn", reason: "Proto run" }, baseContext);
    expect(plan.kind).toBe("action");
    if (plan.kind === "action" && plan.action.type === "waiver_pr.request") {
      expect(plan.action.type).toBe("waiver_pr.request");
      expect(plan.action.ruleId).toBe("bom.missing-mpn");
      expect(plan.action.reason).toBe("Proto run");
    }
  });

  it("generates exact-context release.prepare action for release-preview command", () => {
    const plan = executeParsedCommand(
      { kind: "release-preview" },
      {
        ...baseContext,
        baseCommitSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        pullRequestDraft: false,
        pullRequestFromFork: false,
      },
    );
    expect(plan.kind).toBe("action");
    if (plan.kind === "action" && plan.action.type === "release.prepare") {
      expect(plan.action).toMatchObject({
        pullRequestNumber: 42,
        ref: "feature/board-rev-b",
        commitSha: "0123456789abcdef0123456789abcdef01234567",
        baseCommitSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        pullRequestDraft: false,
        pullRequestFromFork: false,
        requestedBy: "engineer1",
      });
    }
  });
});
