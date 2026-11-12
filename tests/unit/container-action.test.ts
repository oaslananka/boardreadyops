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

  it("builds a GitHub-compatible Fedora image with an unprivileged account", async () => {
    const dockerfile = await readFile("apps/container/Dockerfile", "utf8");

    expect(dockerfile).toContain("# renovate: datasource=docker depName=fedora currentValue=45");
    expect(dockerfile).toMatch(/^FROM fedora@sha256:[a-f0-9]{64}$/mu);
    expect(dockerfile).not.toMatch(/^FROM [^\n]+:[^\s]+@sha256:/mu);
    expect(dockerfile).toContain("ARG NODE_VERSION=24.22.1");
    expect(dockerfile).not.toContain("ARG KICAD_PPA_SERIES");
    expect(dockerfile).toContain("dnf -y install --setopt=install_weak_deps=False kicad");
    expect(dockerfile).toContain("ARG BOARDREADYOPS_VERSION");
    expect(dockerfile).not.toContain("ARG BOARDREADYOPS_VERSION=latest");
    expect(dockerfile).toContain("BOARDREADYOPS_VERSION must be an exact semantic version");
    expect(dockerfile).not.toContain("ARG PNPM_VERSION");
    expect(dockerfile).toContain("NPM_CONFIG_UPDATE_NOTIFIER=false npm install");
    expect(dockerfile).toContain("--global --ignore-scripts --no-audit --no-fund");
    expect(dockerfile).toContain(`"boardreadyops@\${BOARDREADYOPS_VERSION}"`);
    expect(dockerfile).not.toContain("corepack ");
    expect(dockerfile).not.toContain("pnpm add --global");
    expect(dockerfile).toContain("/root/.npm");
    expect(dockerfile).toContain("/usr/local/lib/node_modules/npm");
    expect(dockerfile).toContain("useradd --create-home --shell /bin/bash --uid 10001 boardreadyops");
    expect(dockerfile).not.toContain("\nUSER ");
    expect(dockerfile).toContain("# nosemgrep: dockerfile.security.missing-user-entrypoint.missing-user-entrypoint");
    expect(dockerfile).toContain("GitHub Docker actions require the default root user");
    expect(dockerfile).toContain('ENTRYPOINT ["boardreadyops"]');
  });

  it("ships an explicit KiCad GPL notice in the container image and docs", async () => {
    const [dockerfile, docs] = await Promise.all([
      readFile("apps/container/Dockerfile", "utf8"),
      readFile("docs/github-action.md", "utf8"),
    ]);

    expect(dockerfile).toContain("/usr/share/doc/boardreadyops/LICENSE-KICAD");
    expect(dockerfile).toContain("/usr/share/licenses/kicad/LICENSE");
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

    expect(engineRange).toBe("^24.0.0");
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
        "node-version": "24.22.1",
        runner: "ubuntu-24.04",
        arch: "amd64",
      },
      {
        "kicad-version": "10.0",
        "node-version": "24.22.1",
        runner: "ubuntu-24.04-arm",
        arch: "arm64",
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
    expect(workflow).toContain("needs: [package-ready, smoke]");
    expect(workflow).toContain("workflow_dispatch publish requires a version input");
    expect(workflow).toContain(`tag="v${shellVariable("version")}"`);
    expect(workflow).toContain(
      `org.opencontainers.image.version=${actionExpression("steps.image-tags.outputs.image-tag")}`,
    );
  });

  it("waits once for exact public npm bytes before starting expensive matrix builds", async () => {
    const metadata = (await loadActionMetadata(".github/workflows/container-build.yml")) as {
      jobs: {
        "package-ready": {
          "runs-on": string;
          "timeout-minutes": number;
          outputs: Record<string, string>;
          steps: Array<{ name?: string; run?: string }>;
        };
        smoke: { needs: string; steps: Array<{ name?: string; run?: string }> };
        publish: { needs: string[]; steps: Array<{ name?: string; run?: string }> };
      };
    };

    const ready = metadata.jobs["package-ready"];
    const resolve = ready.steps.find((step) => step.name === "Resolve package version")?.run ?? "";
    const wait = ready.steps.find((step) => step.name === "Wait for npm package availability")?.run ?? "";

    expect(ready["runs-on"]).toBe("ubuntu-24.04");
    expect(ready["timeout-minutes"]).toBe(18);
    expect(ready.outputs.version).toBe(actionExpression("steps.package.outputs.version"));
    expect(resolve).toContain("GITHUB_EVENT_NAME");
    expect(resolve).toContain("pull_request");
    expect(resolve).toContain("npm view boardreadyops dist-tags.latest --json");
    expect(resolve).toContain('select(type == "string")');
    expect(resolve).toContain("npm latest dist-tag must resolve to a stable semantic version");
    expect(resolve.indexOf("pull_request")).toBeLessThan(resolve.indexOf("elif ["));
    expect(resolve).toContain("GITHUB_REF_NAME#v");
    expect(resolve).toContain("Container smoke needs an exact semver npm package version");
    expect(resolve).toContain("Manual package version does not match selected Git tag");

    // The first-party package is exempt from dependency-age pinning only for this exact probe.
    // A failed availability check is never converted to a successful container build.
    expect(wait).toContain("PACKAGE_VERSION");
    expect(wait).toContain("for attempt in {1..84}");
    expect(wait).toContain("npm pack --prefer-online --fetch-retries=0 --fetch-timeout=15000 --min-release-age=0");
    expect(wait).toContain(`"boardreadyops@${shellVariable("PACKAGE_VERSION")}"`);
    expect(wait).toContain("tarball is still unavailable");
    expect(wait).toContain("exit 1");

    expect(metadata.jobs.smoke.needs).toBe("package-ready");
    expect(metadata.jobs.publish.needs).toEqual(["package-ready", "smoke"]);
    expect(metadata.jobs.smoke.steps.some((step) => step.name === "Wait for npm package availability")).toBe(false);
    expect(metadata.jobs.publish.steps.some((step) => step.name === "Wait for npm package availability")).toBe(false);
  });

  it("shares the single verified package version across smoke arches and GHCR publishing", async () => {
    const workflow = await readFile(".github/workflows/container-build.yml", "utf8");
    const version = actionExpression("needs.package-ready.outputs.version");

    expect(workflow.match(/Wait for npm package availability/g)).toHaveLength(1);
    expect(workflow.match(/npm pack --prefer-online --fetch-retries=0 --fetch-timeout=15000/g)).toHaveLength(1);
    expect(workflow).not.toContain("npm pack --pack-destination apps/container");
    expect(workflow).not.toContain("file:boardreadyops-");
    expect(workflow.split(`BOARDREADYOPS_VERSION=${version}`)).toHaveLength(3);
    expect(workflow).toContain(`PACKAGE_VERSION: ${version}`);
    expect(workflow).toContain(`version="${shellVariable("PACKAGE_VERSION")}"`);
    expect(workflow).not.toContain("continue-on-error");
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
