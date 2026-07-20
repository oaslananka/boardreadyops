import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function readText(path: string): string {
  const absolutePath = resolve(repositoryRoot, path);
  return existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : "";
}

const packageJson = JSON.parse(readText("package.json")) as {
  scripts?: Record<string, string>;
};
const renovate = JSON.parse(readText("renovate.json")) as {
  dependencyDashboard?: boolean;
  enabledManagers?: string[];
  packageRules?: Array<Record<string, unknown>>;
  platformAutomerge?: boolean;
  schedule?: string[];
  timezone?: string;
};

const SEMGREP_VERSION = "1.170.0";
const SNYK_VERSION = "1.1306.1";
const RENOVATE_VERSION = "43.272.4";

function renovateRule(description: string): Record<string, unknown> | undefined {
  return renovate.packageRules?.find((rule) => rule.description === description);
}

describe("dependency and local security automation policy", () => {
  it("keeps Renovate as the single routine dependency updater", () => {
    expect(readText(".github/dependabot.yml")).toBe("");
    expect(renovate).toMatchObject({
      timezone: "Europe/Istanbul",
      dependencyDashboard: true,
      enabledManagers: ["npm", "github-actions", "dockerfile", "docker-compose"],
      platformAutomerge: false,
      schedule: ["after 2am and before 6am on monday"],
    });
  });

  it("defines BoardReadyOps-specific stability and manual-review rules", () => {
    expect(renovateRule("Never automerge unstable zero-major dependencies.")).toMatchObject({
      matchCurrentVersion: "/^0\\./",
      automerge: false,
      addLabels: ["manual-review"],
    });
    expect(renovateRule("Coordinate TypeScript and type tooling updates.")).toMatchObject({
      groupName: "TypeScript and type tooling",
    });
    expect(renovateRule("Coordinate Next.js and React runtime updates with manual review.")).toMatchObject({
      groupName: "Next.js and React",
      automerge: false,
      addLabels: ["manual-review"],
    });
    expect(renovateRule("Coordinate Prisma and PostgreSQL tooling updates with manual review.")).toMatchObject({
      groupName: "Prisma and PostgreSQL tooling",
      automerge: false,
      addLabels: ["manual-review"],
    });
    expect(readText("renovate.json")).toContain("minimumReleaseAge");
  });

  it("pins and exposes local security commands", () => {
    expect(packageJson.scripts?.["security:semgrep"]).toBe(
      "semgrep scan --config .semgrep.yml --error --metrics=off .",
    );
    expect(packageJson.scripts?.["security:semgrep:test"]).toBe("semgrep --test --config .semgrep.yml tests/semgrep");
    expect(packageJson.scripts?.["security:snyk:oss"]).toBe(
      `pnpm dlx snyk@${SNYK_VERSION} test --all-projects --severity-threshold=high`,
    );
    expect(packageJson.scripts?.["renovate:validate"]).toBe(
      `pnpm dlx --package=renovate@${RENOVATE_VERSION} renovate-config-validator renovate.json`,
    );
  });

  it("installs staged Semgrep and pre-push Snyk hooks", () => {
    const config = readText(".pre-commit-config.yaml");
    expect(config).toContain("default_install_hook_types:");
    expect(config).toContain("- pre-commit");
    expect(config).toContain("- pre-push");
    expect(config).toContain(`rev: v${SEMGREP_VERSION}`);
    expect(config).toContain("--config=.semgrep.yml");
    expect(config).toContain("id: snyk-oss");
    expect(config).toContain("entry: pnpm security:snyk:oss");
    expect(config).toContain("stages: [pre-push]");
  });

  it("runs Renovate and Semgrep validation in CI", () => {
    const workflow = readText(".github/workflows/static-security-analysis.yml");
    expect(workflow).toContain(`renovate@${RENOVATE_VERSION}`);
    expect(workflow).toContain(`semgrep==${SEMGREP_VERSION}`);
    expect(workflow).toContain("semgrep --validate --config .semgrep.yml");
    expect(workflow).toContain("semgrep --test --config .semgrep.yml tests/semgrep");
    expect(workflow).toContain("github/codeql-action/upload-sarif@");
  });

  it("documents Snyk authentication and Sonar Connected Mode", () => {
    const guide = readText("docs/development/security-tooling.md");
    expect(guide).toContain("snyk auth");
    expect(guide).toContain("SKIP=snyk-oss");
    expect(guide).toContain("SonarQube for IDE");
    expect(guide).toContain("Connected Mode");
  });
});
