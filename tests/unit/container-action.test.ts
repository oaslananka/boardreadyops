import { readFile } from "node:fs/promises";
import * as yaml from "js-yaml";
import { describe, expect, it } from "vitest";

type ActionMetadata = {
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  runs?: Record<string, unknown>;
};

type PackageManifest = {
  engines?: {
    node?: string;
  };
};

describe("container action release surfaces", () => {
  it("keeps the Docker action contract aligned with the Node action", async () => {
    const [nodeAction, containerAction] = await Promise.all([
      loadActionMetadata("action.yml"),
      loadActionMetadata("apps/container/action.yml"),
    ]);

    expect(containerAction.inputs).toEqual(nodeAction.inputs);
    expect(containerAction.outputs).toEqual(nodeAction.outputs);
    expect(containerAction.runs).toMatchObject({
      using: "docker",
      image: `docker://ghcr.io/\${{ github.repository_owner }}/boardreadyops-full:v1`,
      entrypoint: "/usr/local/bin/boardreadyops-action",
    });
    // Container action no longer uses positional args - GitHub Actions sets INPUT_* env vars automatically
    expect(containerAction.runs?.args).toBeUndefined();
  });

  it("uses GitHub Actions INPUT_* env vars directly (no positional arg mapping)", async () => {
    const entrypoint = await readFile("apps/container/action-entrypoint.sh", "utf8");

    // Should directly execute the action without mapping positional args to env vars
    expect(entrypoint).toContain("exec node /usr/local/lib/node_modules/boardreadyops/dist/action/index.cjs");
    // Should NOT contain the old positional arg mapping
    expect(entrypoint).not.toContain(`INPUT_PATH=\${1-}`);
    expect(entrypoint).not.toContain(`INPUT_PROJECT=\${2-}`);
  });

  it("builds a GitHub-compatible Ubuntu image with an unprivileged account", async () => {
    const dockerfile = await readFile("apps/container/Dockerfile", "utf8");

    expect(dockerfile).toContain("FROM ubuntu:26.04@sha256:");
    expect(dockerfile).toContain("ARG NODE_VERSION=24.18.0");
    expect(dockerfile).not.toContain("ARG PNPM_VERSION");
    expect(dockerfile).toContain("ARG KICAD_PPA_SERIES=10.0");
    expect(dockerfile).toContain(`ppa:kicad/kicad-\${KICAD_PPA_SERIES}-releases`);
    expect(dockerfile).toContain(
      `NPM_CONFIG_UPDATE_NOTIFIER=false npm install --global --no-audit --no-fund "boardreadyops@\${BOARDREADYOPS_VERSION}"`,
    );
    expect(dockerfile).not.toContain("corepack ");
    expect(dockerfile).not.toContain("pnpm add --global");
    expect(dockerfile).toContain("/root/.npm");
    expect(dockerfile).toContain("/usr/local/lib/node_modules/npm");
    expect(dockerfile).toContain("useradd --create-home --shell /bin/bash --uid 10001 boardreadyops");
    expect(dockerfile).not.toContain("\nUSER ");
    expect(dockerfile).toContain('ENTRYPOINT ["boardreadyops"]');
  });

  it("ships an explicit KiCad GPL notice in the container image and docs", async () => {
    const [dockerfile, docs] = await Promise.all([
      readFile("apps/container/Dockerfile", "utf8"),
      readFile("docs/github-action.md", "utf8"),
    ]);

    expect(dockerfile).toContain("/usr/share/doc/boardreadyops/LICENSE-KICAD");
    expect(dockerfile).toContain("/usr/share/common-licenses/GPL-3");
    expect(docs).toContain("Container image redistributes KiCad under GPL terms.");
  });

  it("keeps the container Node pin inside the package engine range", async () => {
    const [dockerfile, workflow, packageJson] = await Promise.all([
      readFile("apps/container/Dockerfile", "utf8"),
      readFile(".github/workflows/container-build.yml", "utf8"),
      readPackageManifest(),
    ]);

    const dockerNodeMajor = Number(requireMatch(dockerfile, /^ARG NODE_VERSION=(\d+)\./m));
    const workflowNodeMajor = Number(requireMatch(workflow, /^\s+NODE_VERSION: "(\d+)\./m));
    const engineRange = packageJson.engines?.node ?? "";

    expect(engineRange).toBe("^22.14.0 || ^24.0.0");
    expect(workflowNodeMajor).toBe(dockerNodeMajor);
    expect(engineAllowsMajor(engineRange, dockerNodeMajor)).toBe(true);
    expect(engineAllowsMajor(engineRange, 24)).toBe(true);
    expect(engineAllowsMajor(engineRange, 26)).toBe(false);
  });

  it("smoke tests container images across the compatibility matrix", async () => {
    const workflow = (await loadActionMetadata(".github/workflows/container-build.yml")) as {
      jobs?: {
        smoke?: {
          strategy?: {
            matrix?: {
              include?: Array<Record<string, string>>;
            };
          };
        };
      };
    };

    expect(workflow.jobs?.smoke?.strategy?.matrix?.include).toEqual([
      {
        "kicad-version": "10.0",
        "kicad-ppa-series": "10.0",
        "node-version": "24.18.0",
      },
    ]);
  });

  it("publishes signed multi-arch GHCR images with scan and SBOM coverage", async () => {
    const workflow = await readFile(".github/workflows/container-build.yml", "utf8");

    expect(workflow).toContain(`ghcr.io/\${{ github.repository_owner }}/boardreadyops-full`);
    expect(workflow).toContain("linux/amd64,linux/arm64");
    expect(workflow).toContain("sbom: true");
    expect(workflow).toContain("cosign sign");
    expect(workflow).toContain("aquasecurity/trivy-action@");
  });

  it("uses the package publisher token for the unlinked historical GHCR package", async () => {
    const workflow = await readFile(".github/workflows/container-build.yml", "utf8");

    expect(workflow).toContain("name: Log in to GHCR with the package publisher token");
    expect(workflow).toContain(`username: ${actionExpression("github.repository_owner")}`);
    expect(workflow).toContain(`password: ${actionExpression("secrets.GH_AUTH_TOKEN")}`);
    expect(workflow).not.toContain(`password: ${actionExpression("secrets.GITHUB_TOKEN")}`);
  });

  it("allows explicit manual GHCR publish for an already-published package version", async () => {
    const workflow = await readFile(".github/workflows/container-build.yml", "utf8");

    expect(workflow).toContain("publish:");
    expect(workflow).toContain("type: boolean");
    expect(workflow).toContain(`github.event_name == 'workflow_dispatch' && inputs.publish`);
    expect(workflow).toContain("workflow_dispatch publish requires a version input");
    expect(workflow).toContain(`tag="v${shellVariable("version")}"`);
    expect(workflow).toContain(
      `org.opencontainers.image.version=${actionExpression("steps.image-tags.outputs.image-tag")}`,
    );
  });

  it("waits for npm package availability before publishing the container", async () => {
    const workflow = await readFile(".github/workflows/container-build.yml", "utf8");

    expect(workflow).toContain("Wait for npm package availability");
    expect(workflow).toContain(`npm view "boardreadyops@${shellVariable("PACKAGE_VERSION")}" version`);
  });

  it("uses the published package version for pull request smoke builds", async () => {
    const workflow = await readFile(".github/workflows/container-build.yml", "utf8");

    expect(workflow).not.toContain("npm pack --pack-destination apps/container");
    expect(workflow).not.toContain("file:boardreadyops-");
    expect(workflow).toContain(`BOARDREADYOPS_VERSION=\${{ steps.package.outputs.version }}`);
  });

  it("waits for npm package availability before release smoke builds", async () => {
    const workflow = await readFile(".github/workflows/container-build.yml", "utf8");

    const waitIndex = workflow.indexOf("Wait for npm package availability");
    const smokeBuildIndex = workflow.indexOf("Build local smoke image");

    expect(waitIndex).toBeGreaterThan(-1);
    expect(waitIndex).toBeLessThan(smokeBuildIndex);
  });

  it("only publishes stable moving aliases for stable release tags", async () => {
    const workflow = await readFile(".github/workflows/container-build.yml", "utf8");

    expect(workflow).toContain("Resolve image tags");
    expect(workflow).toContain(`if [[ "${shellVariable("version")}" != *-* ]]; then`);
    expect(workflow).toContain(`echo "${shellVariable("IMAGE_NAME")}:v${shellVariable("major")}"`);
    expect(workflow).toContain(`echo "${shellVariable("IMAGE_NAME")}:latest"`);
    expect(workflow).toContain(`tags: ${actionExpression("steps.image-tags.outputs.tags")}`);
  });
});

async function loadActionMetadata(file: string): Promise<ActionMetadata> {
  return yaml.load(await readFile(file, "utf8")) as ActionMetadata;
}

async function readPackageManifest(): Promise<PackageManifest> {
  return JSON.parse(await readFile("package.json", "utf8")) as PackageManifest;
}

function requireMatch(value: string, pattern: RegExp): string {
  const match = value.match(pattern);
  expect(match).not.toBeNull();
  return match?.[1] ?? "";
}

function engineAllowsMajor(range: string, major: number): boolean {
  return new RegExp(`\\^${major}\\.0\\.0(?:\\s|$)`).test(range);
}

function shellVariable(name: string): string {
  return `\${${name}}`;
}

function actionExpression(expression: string): string {
  return `\${{ ${expression} }}`;
}
