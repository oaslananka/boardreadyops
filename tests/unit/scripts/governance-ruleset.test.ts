import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { reconcileBranchProtection } from "../../../scripts/branch-protection.mjs";

const root = path.resolve(import.meta.dirname, "../../..");

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
      name: string;
      target: string;
      enforcement: string;
      conditions: { ref_name: { include: string[]; exclude: string[] } };
      rules: Array<PullRequestRule | StatusChecksRule | { type: string }>;
      bypass_actors: Array<{ actor_id: number; actor_type: string; bypass_mode: string }>;
    };
    const pullRequest = ruleset.rules.find((rule): rule is PullRequestRule => rule.type === "pull_request");

    expect(ruleset).toMatchObject({
      name: "main-standard",
      target: "branch",
      enforcement: "active",
      conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
    });
    expect(pullRequest?.parameters).toMatchObject({
      allowed_merge_methods: ["squash"],
      dismiss_stale_reviews_on_push: true,
      require_code_owner_review: false,
      require_last_push_approval: false,
      require_extra_approval_for_unattributed_changes: true,
      required_approving_review_count: 0,
      required_review_thread_resolution: true,
    });
    expect(ruleset.bypass_actors).toEqual([{ actor_id: 285490571, actor_type: "User", bypass_mode: "pull_request" }]);
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
      "ci / unit-matrix-gate",
      "ci / build",
      "ci / verify-dist",
      "ci / coverage-gate",
      "SonarCloud Code Analysis",
      "security / gate",
    ]);
  });

  async function fixture() {
    const desired = JSON.parse(await repositoryFile(".github/rulesets/main.json"));
    const live = structuredClone(desired);
    const repository = {
      full_name: "oaslananka/boardreadyops",
      owner: { login: "oaslananka", id: 285490571, type: "User" },
      archived: false,
      default_branch: "main",
    };
    const rows = [
      {
        id: 19863729,
        name: "main-standard",
        target: "branch",
        source_type: "Repository",
        source: repository.full_name,
      },
      { id: 24511899, name: "release-tags", target: "tag", source_type: "Repository", source: repository.full_name },
    ];
    const calls: Array<{ endpoint: string; body?: unknown }> = [];
    let current = live;
    const api = (endpoint: string, body?: unknown): unknown => {
      calls.push(body === undefined ? { endpoint } : { endpoint, body });
      if (endpoint === "repos/oaslananka/boardreadyops") return repository;
      if (endpoint === "repos/oaslananka/boardreadyops/rulesets?includes_parents=false&per_page=100") return [rows];
      if (endpoint === "repos/oaslananka/boardreadyops/rulesets/19863729") {
        if (body !== undefined) current = structuredClone(body);
        return { ...current, id: 19863729, source_type: "Repository", source: repository.full_name };
      }
      throw new Error(`Unexpected API endpoint: ${endpoint}`);
    };
    return { desired, live, repository, rows, calls, api };
  }

  it("checks matching protection without writes, even with apply requested", async () => {
    const f = await fixture();
    expect(reconcileBranchProtection(f.desired, f.api, false)).toBe("aligned");
    expect(reconcileBranchProtection(f.desired, f.api, true)).toBe("aligned");
    expect(f.calls.every((call) => call.body === undefined)).toBe(true);
  });

  it("reports stale-review drift read-only, then allows only the known strengthening in place", async () => {
    const f = await fixture();
    f.live.rules.find(
      (rule: { type: string }) => rule.type === "pull_request",
    ).parameters.dismiss_stale_reviews_on_push = false;
    expect(reconcileBranchProtection(f.desired, f.api, false)).toBe("stale-review-drift");
    expect(f.calls.every((call) => call.body === undefined)).toBe(true);
    expect(reconcileBranchProtection(f.desired, f.api, true)).toBe("updated");
    const writes = f.calls.filter((call) => call.body !== undefined);
    expect(writes).toEqual([{ endpoint: "repos/oaslananka/boardreadyops/rulesets/19863729", body: f.desired }]);
    expect(f.calls.at(-1)?.body).toBeUndefined();
  });

  it.each(["missing", "duplicate", "legacy", "foreign", "stronger", "hidden-bypass", "wrong-owner"] as const)(
    "fails closed on %s protection without writes",
    async (kind) => {
      const f = await fixture();
      const branchRule = f.rows[0];
      if (!branchRule) throw new Error("Missing fixture branch rule");
      if (kind === "missing") f.rows.shift();
      if (kind === "duplicate") f.rows.push({ ...branchRule, id: 123 });
      if (kind === "legacy") branchRule.name = "main";
      if (kind === "foreign") branchRule.source = "someone/other";
      if (kind === "stronger") f.live.rules.push({ type: "required_signatures" });
      if (kind === "hidden-bypass") delete f.live.bypass_actors;
      if (kind === "wrong-owner") f.repository.owner.id = 1;
      expect(() => reconcileBranchProtection(f.desired, f.api, true)).toThrow();
      expect(f.calls.every((call) => call.body === undefined)).toBe(true);
    },
  );

  it("refuses an update when a stronger rule appears during the final inspection", async () => {
    const f = await fixture();
    f.live.rules.find(
      (rule: { type: string }) => rule.type === "pull_request",
    ).parameters.dismiss_stale_reviews_on_push = false;
    let reads = 0;
    const api = (endpoint: string, body?: unknown): unknown => {
      if (endpoint.endsWith("/19863729") && body === undefined && ++reads === 2) {
        f.live.rules.push({ type: "required_signatures" });
      }
      return f.api(endpoint, body);
    };
    expect(() => reconcileBranchProtection(f.desired, api, true)).toThrow("Ruleset changed");
    expect(f.calls.every((call) => call.body === undefined)).toBe(true);
  });

  it("does not retry a write when the updated ruleset cannot be verified", async () => {
    const f = await fixture();
    f.live.rules.find(
      (rule: { type: string }) => rule.type === "pull_request",
    ).parameters.dismiss_stale_reviews_on_push = false;
    const api = (endpoint: string, body?: unknown): unknown => {
      if (body !== undefined) {
        f.calls.push({ endpoint, body });
        return f.live; // Simulate a successful response without the expected persisted change.
      }
      return f.api(endpoint);
    };
    expect(() => reconcileBranchProtection(f.desired, api, true)).toThrow("could not be verified");
    expect(f.calls.filter((call) => call.body !== undefined)).toHaveLength(1);
  });

  it("documents every required merge context in the governance, CI, and release policies", async () => {
    const ruleset = JSON.parse(await repositoryFile(".github/rulesets/main.json")) as {
      rules: Array<StatusChecksRule | { type: string }>;
    };
    const checks = ruleset.rules.find((rule): rule is StatusChecksRule => rule.type === "required_status_checks");
    expect(checks?.parameters.required_status_checks).toHaveLength(10);
    for (const file of [
      "docs/governance.md",
      "docs/development/ci-policy.md",
      "docs/development/release-assurance.md",
    ]) {
      const document = await repositoryFile(file);
      for (const check of checks?.parameters.required_status_checks ?? []) {
        expect(document, `${file}: ${check.context}`).toContain(`\`${check.context}\``);
      }
    }
  });

  it("keeps GitHub rules authoritative while Mergify only merges explicitly queued PRs", async () => {
    const mergifySource = await repositoryFile(".mergify.yml");
    const mergify = (await import("js-yaml")).load(mergifySource) as {
      merge_queue?: { mode: string; max_parallel_checks: number };
      queue_rules?: Array<{
        name: string;
        merge_method?: string;
        batch_size?: number;
        checks_timeout?: string;
        queue_conditions?: string[];
      }>;
      merge_protections_settings?: Record<string, unknown>;
      scopes?: unknown;
    };
    const ruleset = JSON.parse(await repositoryFile(".github/rulesets/main.json")) as {
      rules: Array<{ type: string }>;
      bypass_actors: Array<{ actor_id: number; actor_type: string; bypass_mode: string }>;
    };

    expect(mergify.merge_queue).toEqual({ mode: "serial", max_parallel_checks: 1 });
    expect(mergify.scopes).toBeUndefined();
    expect(mergify.merge_protections_settings).toBeUndefined();
    expect(mergify.queue_rules).toEqual([
      {
        name: "main",
        merge_method: "squash",
        batch_size: 1,
        checks_timeout: "30 min",
        queue_conditions: ["base = main", "-draft", "check-success = @github-actions/ci / unit-matrix-gate"],
      },
    ]);
    expect(mergifySource).not.toContain("auto_merge_conditions");
    expect(ruleset.rules.some((rule) => rule.type === "pull_request")).toBe(true);
    expect(ruleset.rules.some((rule) => rule.type === "required_status_checks")).toBe(true);
    expect(ruleset.bypass_actors.some((actor) => actor.actor_type === "Integration")).toBe(false);
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

  it("documents the solo-maintainer GitHub-native merge and PR-only emergency bypass policy", async () => {
    const governance = await repositoryFile("GOVERNANCE.md");
    const detailedGovernance = await repositoryFile("docs/governance.md");
    const setup = await repositoryFile("scripts/setup-branch-protection.sh");

    for (const document of [governance, detailedGovernance]) {
      const normalized = document.replace(/\s+/g, " ");
      expect(normalized).toContain("zero required human approvals");
      expect(normalized).not.toContain("signed commits");
      expect(normalized).toContain("explicit maintainer merge decision");
      expect(normalized).toContain("manual-review");
      expect(normalized).toContain("do-not-merge");
      expect(normalized).not.toContain("automatically enter the Mergify queue");
      expect(normalized).toContain("PR-only emergency bypass");
      expect(normalized).toContain("retrospective review");
    }
    expect(detailedGovernance.replace(/\s+/g, " ")).toContain("CODEOWNERS review is not required");
    expect(setup).toContain("branch-protection.mjs");
    expect(setup).not.toContain(`branches/\${branch}/protection`);
  });
});
