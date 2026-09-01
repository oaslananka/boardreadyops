import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../..");
const execFileAsync = promisify(execFile);

async function repositoryFile(file: string): Promise<string> {
  return readFile(path.join(root, file), "utf8");
}

type PullRequestRule = {
  type: "pull_request";
  parameters: {
    allowed_merge_methods?: string[];
    dismiss_stale_reviews_on_push: boolean;
    require_code_owner_review: boolean;
    require_last_push_approval: boolean;
    require_extra_approval_for_unattributed_changes: boolean;
    required_approving_review_count: number;
    required_review_thread_resolution: boolean;
  };
};

type StatusChecksRule = {
  type: "required_status_checks";
  parameters: {
    required_status_checks: Array<{ context: string }>;
    strict_required_status_checks_policy: boolean;
  };
};

describe("main branch governance ruleset", () => {
  it("supports solo-maintainer merges while requiring resolved conversations", async () => {
    const ruleset = JSON.parse(await repositoryFile(".github/rulesets/main.json")) as {
      rules: Array<PullRequestRule | StatusChecksRule | { type: string }>;
      bypass_actors: Array<{ actor_id: number; actor_type: string; bypass_mode: string }>;
    };
    const pullRequest = ruleset.rules.find((rule): rule is PullRequestRule => rule.type === "pull_request");

    expect(pullRequest?.parameters).toMatchObject({
      allowed_merge_methods: ["squash"],
      dismiss_stale_reviews_on_push: true,
      require_code_owner_review: false,
      require_last_push_approval: false,
      require_extra_approval_for_unattributed_changes: true,
      required_approving_review_count: 0,
      required_review_thread_resolution: true,
    });
    expect(ruleset.bypass_actors).toEqual([
      { actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "pull_request" },
      { actor_id: 10562, actor_type: "Integration", bypass_mode: "exempt" },
    ]);
  });

  it("keeps the committed stable merge gates aligned with the live baseline", async () => {
    const ruleset = JSON.parse(await repositoryFile(".github/rulesets/main.json")) as {
      rules: Array<PullRequestRule | StatusChecksRule | { type: string }>;
    };
    const statusChecks = ruleset.rules.find((rule): rule is StatusChecksRule => rule.type === "required_status_checks");

    expect(ruleset.rules.some((rule) => rule.type === "required_signatures")).toBe(false);
    expect(statusChecks?.parameters.strict_required_status_checks_policy).toBe(true);
    expect(statusChecks?.parameters.required_status_checks.map(({ context }) => context)).toEqual([
      "ci / risk-profile",
      "ci / lint",
      "ci / typecheck",
      "ci / test-unit",
      "ci / build",
      "ci / verify-dist",
      "ci / coverage-gate",
      "security / gate",
    ]);
  });

  it.skipIf(process.platform === "win32")(
    "updates the repository ruleset instead of legacy classic protection",
    async () => {
      const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-ruleset-sync-"));
      const fakeGh = path.join(temporaryRoot, "gh");
      const commandLog = path.join(temporaryRoot, "commands.log");

      await writeFile(
        fakeGh,
        [
          "#!/usr/bin/env bash",
          `printf "%s\n" "$*" >>"\${GH_COMMAND_LOG}"`,
          'if [[ "$*" == *"repos/oaslananka/boardreadyops/rulesets --jq"* ]]; then',
          "  printf '18628144\n'",
          "fi",
        ].join("\n"),
        { mode: 0o755 },
      );

      try {
        await execFileAsync("bash", [path.join(root, "scripts/setup-branch-protection.sh")], {
          cwd: root,
          env: {
            ...process.env,
            GH_COMMAND_LOG: commandLog,
            PATH: `${temporaryRoot}${path.delimiter}${process.env.PATH ?? ""}`,
          },
        });
        const commands = await readFile(commandLog, "utf8");

        expect(commands).toContain("api --method PUT repos/oaslananka/boardreadyops/rulesets/18628144 --input");
        expect(commands).toContain("api --method PATCH repos/oaslananka/boardreadyops");
        expect(commands).not.toContain("branches/main/protection");
      } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
      }
    },
  );

  it("keeps Mergify queue enforcement delegated to the GitHub ruleset", async () => {
    const mergify = await repositoryFile(".mergify.yml");
    const ruleset = JSON.parse(await repositoryFile(".github/rulesets/main.json")) as {
      bypass_actors: Array<{ actor_id: number; actor_type: string; bypass_mode: string }>;
    };

    expect(mergify).toContain("branch_protection_injection_mode: queue");
    expect(mergify).not.toMatch(/check-success\s*=/u);
    expect(ruleset.bypass_actors).toContainEqual({ actor_id: 10562, actor_type: "Integration", bypass_mode: "exempt" });
  });

  it("keeps the public contribution path GitHub-native and security reports private", async () => {
    const contributing = await repositoryFile("CONTRIBUTING.md");
    const detailedGovernance = await repositoryFile("docs/governance.md");
    const maintainerGovernance = await repositoryFile("GOVERNANCE.md");
    const pullRequestTemplate = await repositoryFile(".github/pull_request_template.md");
    const issueTemplateConfig = await repositoryFile(".github/ISSUE_TEMPLATE/config.yml");
    const security = await repositoryFile("SECURITY.md");

    for (const document of [contributing, detailedGovernance]) {
      const normalized = document.replace(/\s+/g, " ");
      expect(normalized).toContain("GitHub Issues");
      expect(normalized).toContain("GitHub Pull Requests");
      expect(normalized).not.toMatch(/\bLinear\b/);
      expect(normalized).not.toContain("codex/BOARD-");
    }

    expect(pullRequestTemplate).toContain("Related GitHub issue or rationale");
    expect(pullRequestTemplate).not.toMatch(/\bLinear\b/);
    expect(maintainerGovernance.replace(/\s+/g, " ")).toContain("optional maintainer metadata");
    expect(maintainerGovernance).not.toContain("One Linear issue per pull request");

    const advisoryUrl = "https://github.com/oaslananka/boardreadyops/security/advisories/new";
    expect(issueTemplateConfig).toContain(advisoryUrl);
    expect(security).toContain(advisoryUrl);
  });

  it("documents the solo-maintainer review and PR-only emergency bypass policy", async () => {
    const governance = await repositoryFile("GOVERNANCE.md");
    const detailedGovernance = await repositoryFile("docs/governance.md");
    const setup = await repositoryFile("scripts/setup-branch-protection.sh");

    for (const document of [governance, detailedGovernance]) {
      const normalized = document.replace(/\s+/g, " ");
      expect(normalized).toContain("zero required human approvals");
      expect(normalized).not.toContain("signed commits");
      expect(normalized).toContain("Mergify");
      expect(normalized).toContain("PR-only emergency bypass");
      expect(normalized).toContain("retrospective review");
    }
    expect(detailedGovernance.replace(/\s+/g, " ")).toContain("CODEOWNERS review is not required");
    expect(setup).toContain(`repos/\${repo}/rulesets`);
    expect(setup).not.toContain(`branches/\${branch}/protection`);
  });
});
