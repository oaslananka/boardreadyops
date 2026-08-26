import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as yaml from "js-yaml";
import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();

async function repositoryFile(path: string): Promise<string> {
  return await readFile(join(repositoryRoot, path), "utf8");
}

describe("dependency and security automation configuration", () => {
  it("verifies NOTICE compliance without mutating the CI checkout", async () => {
    const workflow = await repositoryFile(".github/workflows/ci.yml");
    const packageJson = JSON.parse(await repositoryFile("package.json")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.security).toContain("notice:check");
    expect(workflow).not.toContain("- run: pnpm run notice\n");
    expect(workflow).toContain("- run: pnpm run security");
    expect(workflow).toContain(
      "- name: Assert compliance checks did not mutate the checkout\n        run: git diff --exit-code",
    );
  });
  it("emits one stable aggregate security gate for every pull request", async () => {
    const workflow = await repositoryFile(".github/workflows/security.yml");
    const ruleset = JSON.parse(await repositoryFile(".github/rulesets/main.json")) as {
      rules: Array<{
        type: string;
        parameters?: { required_status_checks?: Array<{ context: string }> };
      }>;
    };
    const required =
      ruleset.rules
        .find((rule) => rule.type === "required_status_checks")
        ?.parameters?.required_status_checks?.map(({ context }) => context) ?? [];

    expect(workflow).toContain("name: security / gate");
    expect(workflow).toContain("node scripts/security-gate.mjs");
    expect(workflow).toContain("pnpm install --frozen-lockfile --ignore-scripts");
    expect(workflow).not.toContain("pnpm install --frozen-lockfile\n");
    expect(workflow).toContain("if: always()");
    expect(workflow).toContain("upload-sarif: false");
    expect(workflow).toMatch(/osv-pull-request:[\s\S]*security-events: write/u);
    expect(workflow).toContain("github.event.pull_request.head.repo.full_name == github.repository");
    expect(workflow).not.toMatch(/pull_request:\n\s+paths-ignore:/u);
    expect(required).toContain("security / gate");
    expect(required).not.toContain("ci / security");
    expect(required).not.toContain("dependency-review");
  });

  it("bounds Actions evidence while durable binaries stay in GitHub Releases", async () => {
    const binary = await repositoryFile(".github/workflows/binary-build.yml");
    const binaryPublisher = await repositoryFile("scripts/publish-binary-release-assets.mjs");
    const ci = await repositoryFile(".github/workflows/ci.yml");
    const benchmark = await repositoryFile(".github/workflows/benchmark.yml");
    const mutation = await repositoryFile(".github/workflows/mutation-nightly.yml");
    const security = await repositoryFile(".github/workflows/security.yml");
    const selfValidation = await repositoryFile(".github/workflows/self-validation.yml");

    expect(binary.match(/retention-days: 1/gu) ?? []).toHaveLength(2);
    expect(binary).toContain("name: Checkout current release publisher");
    expect(binary).toContain("path: .release-publisher");
    expect(binary).toContain("node .release-publisher/scripts/publish-binary-release-assets.mjs");
    expect(binaryPublisher).toMatch(/"release",\s*"upload"/u);
    expect(binaryPublisher).toMatch(/"release",\s*"create"/u);
    expect(binaryPublisher).toContain('"--clobber"');
    expect(ci).toContain("Upload bounded coverage evidence");
    expect(ci).toContain(
      "if: $" + "{{ failure() || (github.event_name == 'push' && github.ref == 'refs/heads/main') }}",
    );
    expect(ci.match(/retention-days: 7/gu) ?? []).toHaveLength(3);
    expect(benchmark).toContain("retention-days: 7");
    expect(mutation).toContain("retention-days: 7");
    expect(security.match(/retention-days: 7/gu) ?? []).toHaveLength(2);
    expect(selfValidation).toContain("retention-days: 7");
    expect(selfValidation).not.toContain("retention-days: 30");
  });

  it("keeps Renovate project-scoped, scheduled, and supply-chain hardened", async () => {
    const renovate = JSON.parse(await repositoryFile("renovate.json")) as Record<string, unknown>;
    const packageJson = JSON.parse(await repositoryFile("package.json")) as {
      scripts?: Record<string, string>;
    };
    const webPackageJson = JSON.parse(await repositoryFile("apps/web/package.json")) as {
      dependencies?: Record<string, string>;
    };
    const renovateWorkflow = yaml.load(await repositoryFile(".github/workflows/renovate.yml")) as {
      jobs?: { renovate?: { env?: Record<string, string> } };
    };

    expect(webPackageJson.dependencies?.["@octokit/auth-app"]).toBe("8.2.0");
    expect(webPackageJson.dependencies?.["@octokit/auth-app"]).not.toBe("latest");
    expect(renovate.extends).toEqual(
      expect.arrayContaining(["config:best-practices", ":dependencyDashboard", ":semanticCommits"]),
    );
    expect(renovate.enabledManagers).toEqual(
      expect.arrayContaining(["npm", "github-actions", "dockerfile", "docker-compose"]),
    );
    expect(renovate.timezone).toBe("Europe/Istanbul");
    expect(renovate.schedule).toEqual(["after 5am and before 8am every weekday"]);
    expect(renovate.minimumReleaseAge).toBe("7 days");
    expect(await repositoryFile("renovate.json")).not.toContain("3 days");
    expect(renovate.pinDigests).toBe(true);
    expect(renovate.postUpdateOptions).toContain("pnpmDedupe");
    expect(packageJson.scripts?.["deps:install-renovate"]).toBeUndefined();
    expect(packageJson.scripts?.["renovate:post-upgrade"]).toBe("node scripts/renovate-post-upgrade.mjs");
    expect(renovateWorkflow.jobs?.renovate?.env?.CI).toBe("true");
    expect(renovate.postUpgradeTasks).toEqual({
      commands: ["corepack pnpm run renovate:post-upgrade"],
      fileFilters: ["NOTICE", "dist/**"],
      executionMode: "branch",
    });
    expect(renovate.ignorePaths).toEqual(
      expect.arrayContaining(["**/.next/**", "**/dist/**", "**/coverage/**", "tests/fixtures/**"]),
    );
  });

  it("validates Renovate with an immutable network-isolated container", async () => {
    const packageJson = JSON.parse(await repositoryFile("package.json")) as {
      scripts?: Record<string, string>;
    };
    const validator = await repositoryFile("scripts/validate-renovate-config.mjs").catch(() => "");
    const workflow = await repositoryFile(".github/workflows/renovate.yml");

    expect(workflow.match(/- scripts\/validate-renovate-config\.mjs/gu) ?? []).toHaveLength(2);
    expect(packageJson.scripts?.["renovate:validate"]).toBe("node scripts/validate-renovate-config.mjs");
    expect(packageJson.scripts?.["renovate:validate"]).not.toContain("dlx");
    expect(validator).toContain(
      "renovate/renovate@sha256:62a5af4b26c18336b0ff5bc69f2e956337b6696e493b0de57a0d71c9d637da20",
    );
    expect(validator).toContain('"--network=none"');
    expect(validator).toContain("readonly");
    expect(validator).toContain('"--entrypoint"');
    expect(validator).toContain('"renovate-config-validator"');
    expect(validator).toContain('spawn("/usr/bin/docker"');
  });

  it("enforces package-manager release quarantine and dependency trust policies", async () => {
    const npmrc = await repositoryFile(".npmrc");
    const workspace = yaml.load(await repositoryFile("pnpm-workspace.yaml")) as {
      minimumReleaseAge?: number;
      trustPolicy?: string;
      blockExoticSubdeps?: boolean;
      minimumReleaseAgeExclude?: string[];
      trustPolicyExclude?: string[];
      overrides?: Record<string, string>;
    };
    const renovate = JSON.parse(await repositoryFile("renovate.json")) as {
      packageRules?: Array<{ minimumReleaseAge?: string | false }>;
      vulnerabilityAlerts?: {
        enabled?: boolean;
        labels?: string[];
        minimumReleaseAge?: string | null;
        schedule?: string[];
        prCreation?: string;
        automerge?: boolean;
        vulnerabilityFixStrategy?: string;
      };
    };

    expect(npmrc).toMatch(/^min-release-age=7$/mu);
    expect(workspace.minimumReleaseAge).toBe(10_080);
    expect(workspace.trustPolicy).toBe("no-downgrade");
    expect(workspace.blockExoticSubdeps).toBe(true);
    expect(workspace.minimumReleaseAgeExclude).toEqual(
      expect.arrayContaining([
        "@hono/node-server@2.0.12",
        "fast-uri@3.1.5",
        "hono@4.12.34",
        "ip-address@10.3.1",
        "renovate@43.272.4",
        "@renovatebot/osv-offline-db@3.0.9",
        "@renovatebot/osv-offline@3.0.9",
        "brace-expansion@5.0.9",
        "deepmerge-ts@8.0.0",
        "js-yaml@5.2.2 || 4.3.1",
        "nanoid@3.3.17 || 3.3.18",
        "undici@8.9.0",
        "valibot@1.4.2",
      ]),
    );
    expect(workspace.minimumReleaseAgeExclude).not.toEqual(
      expect.arrayContaining([
        "@hono/node-server@2.0.10",
        "brace-expansion@5.0.8",
        "fast-uri@3.1.4",
        "hono@4.12.27",
        "ip-address@10.2.0",
        "postcss@8.5.18",
        "undici@8.5.0",
      ]),
    );
    expect(workspace.trustPolicyExclude).toEqual(["@yarnpkg/libzip@3.2.2", "semver@6.3.1"]);
    expect(workspace.overrides).toMatchObject({
      "archiver>readdir-glob": "3.0.0",
      "@prisma/config>deepmerge-ts": "8.0.0",
      "@hono/node-server@<2.0.12": "2.0.12",
      "brace-expansion@>=5 <5.0.9": "5.0.9",
      "fast-uri@>=3 <3.1.5": "3.1.5",
      "hono@<4.12.34": "4.12.34",
      "ip-address@<10.3.1": "10.3.1",
      "nanoid@<3.3.17": "3.3.18",
      "postcss@<8.5.23": "8.5.26",
      "undici@<8.9.0": "8.9.0",
      valibot: "1.4.2",
    });
    expect(workspace.overrides).not.toHaveProperty("@hono/node-server");
    expect(workspace.overrides).not.toHaveProperty("postcss");
    expect(workspace.overrides).not.toHaveProperty("undici@<6.23.0");
    expect(workspace.overrides).not.toHaveProperty("undici@<6.24.0");
    expect(workspace.overrides).not.toHaveProperty("brace-expansion@>=2 <2.1.2");
    expect(renovate.vulnerabilityAlerts).toMatchObject({
      enabled: true,
      minimumReleaseAge: null,
      schedule: [],
      prCreation: "immediate",
      automerge: false,
      vulnerabilityFixStrategy: "lowest",
    });
    expect(renovate.vulnerabilityAlerts?.labels).toEqual(
      expect.arrayContaining(["security", "dependencies", "manual-review"]),
    );
    expect(renovate.packageRules).not.toHaveLength(0);
    for (const rule of renovate.packageRules ?? []) {
      expect(rule.minimumReleaseAge).toBe("7 days");
    }
  });

  it("runs the cloud image as non-root and documents the GitHub action exception", async () => {
    const webDockerfile = await repositoryFile("apps/web/Dockerfile");
    const actionDockerfile = await repositoryFile("apps/container/Dockerfile");

    expect(webDockerfile).toContain("USER node");
    expect(webDockerfile).toContain("COPY --chown=node:node --from=build");
    expect(webDockerfile).toContain("COPY apps/web/docker-entrypoint.sh /usr/local/bin/boardreadyops-entrypoint");
    expect(webDockerfile).not.toContain(
      "COPY --chown=node:node apps/web/docker-entrypoint.sh /usr/local/bin/boardreadyops-entrypoint",
    );
    expect(actionDockerfile).not.toContain("\nUSER ");
    expect(actionDockerfile).toContain(
      "# nosemgrep: dockerfile.security.missing-user-entrypoint.missing-user-entrypoint",
    );
    expect(actionDockerfile).toContain("GitHub Docker actions require the default root user");
  });

  it("runs a pinned Renovate release only on schedule or manual dispatch", async () => {
    const workflow = await repositoryFile(".github/workflows/renovate.yml");

    expect(workflow).toContain("schedule:");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("renovatebot/github-action@3064367f740a1a91cca218698a63902689cce200");
    expect(workflow).toContain("renovate-version: 43.272.4");
    expect(workflow).toContain("pnpm run renovate:validate");
    expect(workflow).not.toContain("npx ");
    expect(workflow).toContain("RENOVATE_REPOSITORIES: '[\"oaslananka/boardreadyops\"]'");
    expect(workflow).toContain("RENOVATE_ALLOWED_COMMANDS: '[\"^corepack pnpm run renovate:post-upgrade$\"]'");
    expect(workflow).toMatch(/pull_request:[\s\S]*- package\.json/u);
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

  it("pins actionlint and zizmor consistently in local hooks and CI", async () => {
    const preCommit = await repositoryFile(".pre-commit-config.yaml");
    const ciWorkflow = await repositoryFile(".github/workflows/ci.yml");
    const securityDocs = await repositoryFile("docs/security-automation.md");

    expect(preCommit).toContain("repo: https://github.com/rhysd/actionlint");
    expect(preCommit).toContain("rev: v1.7.12");
    expect(preCommit).toContain("id: actionlint");
    expect(preCommit).toContain("repo: https://github.com/zizmorcore/zizmor-pre-commit");
    expect(preCommit).toContain("rev: v1.27.0");
    expect(preCommit).toContain("--min-severity=medium");

    expect(ciWorkflow.match(/uvx --no-build --from pre-commit==4\.6\.0/gu) ?? []).toHaveLength(2);
    expect(ciWorkflow).toContain("pre-commit run actionlint --all-files");
    expect(ciWorkflow).toContain("pre-commit run zizmor --all-files");
    expect(ciWorkflow).not.toContain("zizmor==1.25.2");
    expect(securityDocs).toContain("actionlint v1.7.12");
    expect(securityDocs).toContain("zizmor v1.27.0");
    expect(securityDocs).not.toContain("intentionally pre-push");
  });

  it("uses OSV-Scanner as the tokenless dependency vulnerability gate", async () => {
    const packageJson = JSON.parse(await repositoryFile("package.json")) as {
      devDependencies?: Record<string, string>;
    };
    const preCommit = await repositoryFile(".pre-commit-config.yaml");
    const huskyPrePush = await repositoryFile(".husky/pre-push");
    const securityWorkflow = await repositoryFile(".github/workflows/security.yml");
    const osvWorkflow = await repositoryFile(".github/workflows/osv.yml");
    const securityDocs = await repositoryFile("docs/security-automation.md");
    const workspace = await repositoryFile("pnpm-workspace.yaml");

    expect(packageJson.devDependencies?.["js-yaml"]).toBe("5.2.3");
    expect(workspace).not.toContain("brace-expansion@>=2 <2.1.2: 2.1.2");
    expect(workspace).toContain("'archiver>readdir-glob': 3.0.0");
    expect(workspace).toContain("'brace-expansion@>=5 <5.0.9': 5.0.9");
    expect(workspace).toContain("'fast-uri@>=3 <3.1.5': 3.1.5");
    expect(workspace).toContain("js-yaml@>=4 <4.3.0: 4.3.1");
    expect(workspace).toContain("linkify-it@>=5 <5.0.2: 5.0.2");
    expect(workspace).toContain("ws@>=8 <8.21.1: 8.21.3");

    expect(preCommit).toContain("repo: https://github.com/google/osv-scanner");
    expect(preCommit).toContain("rev: v2.5.1");
    expect(preCommit).toContain("id: osv-scanner");
    expect(preCommit).toContain("stages: [manual]");
    expect(huskyPrePush).toContain("pre-commit run --hook-stage pre-push --all-files");

    expect(securityWorkflow).not.toContain("security-events: write\n    env:");
    expect(securityWorkflow).toContain(
      "google/osv-scanner-action/.github/workflows/osv-scanner-reusable-pr.yml@6e4298ebc4db23e847df9b2e2de2939d6f066c67",
    );
    expect(securityWorkflow).toContain(
      "google/osv-scanner-action/.github/workflows/osv-scanner-reusable.yml@6e4298ebc4db23e847df9b2e2de2939d6f066c67",
    );
    expect(securityWorkflow).toContain("github.event_name == 'push' || github.event_name == 'workflow_dispatch'");
    expect(osvWorkflow).not.toContain("pull_request:");
    expect(osvWorkflow).not.toContain("push:");
    expect(osvWorkflow).toContain("schedule:");
    expect(osvWorkflow).toContain("workflow_dispatch:");
    expect(osvWorkflow).toContain("security-events: write");
    expect(osvWorkflow).not.toContain("osv-scanner-reusable-pr.yml");
    expect(osvWorkflow).toContain(
      "google/osv-scanner-action/.github/workflows/osv-scanner-reusable.yml@6e4298ebc4db23e847df9b2e2de2939d6f066c67",
    );
    expect(osvWorkflow).toContain("fail-on-vuln: true");
    expect(osvWorkflow).not.toContain("secrets.");

    expect(securityDocs).toContain("OSV-Scanner v2.5.1");
    expect(securityDocs).toContain("No account, API token, or hosted scan quota is required");
    expect(securityDocs).toContain("does not run on pull requests or pushes");
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
      "osv.yml",
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
