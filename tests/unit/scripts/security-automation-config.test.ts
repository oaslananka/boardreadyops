import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();

async function repositoryFile(path: string): Promise<string> {
  return await readFile(join(repositoryRoot, path), "utf8");
}

describe("dependency and security automation configuration", () => {
  it("keeps Renovate project-scoped, scheduled, and supply-chain hardened", async () => {
    const renovate = JSON.parse(await repositoryFile("renovate.json")) as Record<string, unknown>;

    expect(renovate.extends).toEqual(
      expect.arrayContaining(["config:best-practices", ":dependencyDashboard", ":semanticCommits"]),
    );
    expect(renovate.enabledManagers).toEqual(
      expect.arrayContaining(["npm", "github-actions", "dockerfile", "docker-compose"]),
    );
    expect(renovate.timezone).toBe("Europe/Istanbul");
    expect(renovate.schedule).toEqual(["after 5am and before 8am every weekday"]);
    expect(renovate.pinDigests).toBe(true);
    expect(renovate.postUpdateOptions).toContain("pnpmDedupe");
    expect(renovate.ignorePaths).toEqual(
      expect.arrayContaining(["**/.next/**", "**/dist/**", "**/coverage/**", "tests/fixtures/**"]),
    );
  });

  it("runs a pinned Renovate release only on schedule or manual dispatch", async () => {
    const workflow = await repositoryFile(".github/workflows/renovate.yml");

    expect(workflow).toContain("schedule:");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("renovatebot/github-action@30643683e37198214c159ca0bff17fbf7e46efba");
    expect(workflow).toContain("renovate-version: 43.272.4");
    expect(workflow).toContain("RENOVATE_REPOSITORIES: '[\"oaslananka/boardreadyops\"]'");
    expect(workflow).toContain("token: $" + "{{ secrets.GH_AUTH_TOKEN }}");
    expect(workflow).not.toContain("pull_request_target");
  });

  it("runs pinned Semgrep rules in the actual Husky pre-commit chain and CI", async () => {
    const preCommit = await repositoryFile(".pre-commit-config.yaml");
    const huskyPreCommit = await repositoryFile(".husky/pre-commit");
    const rules = await repositoryFile(".semgrep.yml");
    const securityWorkflow = await repositoryFile(".github/workflows/security.yml");

    expect(preCommit).toContain("repo: https://github.com/semgrep/semgrep");
    expect(preCommit).toContain("rev: v1.170.0");
    expect(preCommit).toContain("entry: semgrep scan");
    expect(preCommit).toContain("--config=.semgrep.yml");
    expect(huskyPreCommit).toContain("pre-commit run --hook-stage pre-commit");
    expect(rules).toContain("id: boardreadyops-no-node-shell-exec");
    expect(rules).toContain("tests/**");
    expect(securityWorkflow).toContain("semgrep==1.170.0");
    expect(securityWorkflow).toContain("--config .semgrep.yml");
    expect(securityWorkflow).toContain("--config p/github-actions");
    expect(securityWorkflow).toContain("semgrep.sarif");
  });

  it("runs a pinned Snyk CLI in the Husky pre-push chain and trusted CI contexts", async () => {
    const packageJson = JSON.parse(await repositoryFile("package.json")) as {
      scripts?: Record<string, string>;
    };
    const preCommit = await repositoryFile(".pre-commit-config.yaml");
    const huskyPrePush = await repositoryFile(".husky/pre-push");
    const securityWorkflow = await repositoryFile(".github/workflows/security.yml");

    expect(packageJson.scripts?.["security:snyk:oss"]).toContain("snyk@1.1306.1 test --all-projects");
    expect(preCommit).toContain("id: snyk-oss");
    expect(preCommit).toContain("stages: [pre-push]");
    expect(huskyPrePush).toContain("pre-commit run --hook-stage pre-push --all-files");

    expect(securityWorkflow).toContain("snyk/actions/setup@b98d498629f1c8fe1db27a2d329ecd5eaffc1482");
    expect(securityWorkflow).toContain("snyk-version: 1.1306.1");
    expect(securityWorkflow).toContain("secrets.SNYK_TOKEN || secrets.SYNK_PAT_TOKEN");
    expect(securityWorkflow).toContain("snyk test --all-projects");
    expect(securityWorkflow).toContain("--severity-threshold=high");
    expect(securityWorkflow).toContain("snyk.sarif");
  });

  it("keeps SonarQube Cloud in Automatic Analysis mode without a competing CI scanner", async () => {
    const sonar = await repositoryFile(".sonarcloud.properties");
    const workflowNames = [
      "benchmark.yml",
      "binary-build.yml",
      "ci.yml",
      "compatibility-drift.yml",
      "container-build.yml",
      "dependency-review.yml",
      "dist-check.yml",
      "docs.yml",
      "lint-fast.yml",
      "mutation-nightly.yml",
      "provenance.yml",
      "publish-npm.yml",
      "readiness-runner.yml",
      "release-please.yml",
      "renovate.yml",
      "security.yml",
      "self-smoke.yml",
      "self-validation.yml",
      "stale.yml",
      "trivy.yml",
    ];
    const workflows = await Promise.all(workflowNames.map((name) => repositoryFile(`.github/workflows/${name}`)));

    expect(sonar).toContain("Automatic Analysis");
    expect(sonar).toContain("Do not add a CI scanner while Automatic Analysis is enabled");
    expect(workflows.join("\n")).not.toContain("SonarSource/sonarqube-scan-action");
  });
});
