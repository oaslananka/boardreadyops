import { describe, expect, it } from "vitest";

import {
  defaultDeployOptions,
  dockerTagFromRevision,
  readDeployOptions,
  runtimeContainerArgs,
} from "../../../scripts/deploy-cloud.mjs";

describe("deploy-cloud", () => {
  it("normalizes revisions into Docker-safe tags", () => {
    expect(dockerTagFromRevision("feature/cloud deploy@123")).toBe("feature-cloud-deploy-123");
    expect(dockerTagFromRevision("---")).toBe("unknown");
  });

  it("reads immutable deployment overrides", () => {
    expect(
      readDeployOptions({
        BOARDREADYOPS_CLOUD_IMAGE_REPOSITORY: "example/cloud",
        BOARDREADYOPS_CLOUD_RUNTIME_ENV_FILE: "/run/secrets/cloud.env",
        BOARDREADYOPS_CLOUD_RUNNER_RESULT_KEY_FILE: "/run/secrets/runner-key",
        BOARDREADYOPS_CLOUD_ARTIFACT_SIGNING_KEY_FILE: "/run/secrets/artifact-key",
        BOARDREADYOPS_CLOUD_RELEASE_REPOSITORIES_FILE: "/run/policies/repositories",
        BOARDREADYOPS_CLOUD_REQUIRE_GITHUB_OIDC: "true",
        BOARDREADYOPS_CLOUD_REVISION: "abc123",
        BOARDREADYOPS_CLOUD_DRY_RUN: "true",
        BOARDREADYOPS_CLOUD_HEALTH_ATTEMPTS: "9",
      }),
    ).toMatchObject({
      imageRepository: "example/cloud",
      runtimeEnvFile: "/run/secrets/cloud.env",
      runnerResultKeyFile: "/run/secrets/runner-key",
      artifactSigningKeyFile: "/run/secrets/artifact-key",
      releaseRepositoriesFile: "/run/policies/repositories",
      requireGithubOidc: true,
      revision: "abc123",
      dryRun: true,
      healthAttempts: 9,
    });
  });

  it("builds runtime containers with read-only secrets, OIDC-only callbacks, health mounts, and provenance", () => {
    const options = {
      ...defaultDeployOptions,
      runtimeEnvFile: "/opt/cloud/runtime-env",
      runnerResultKeyFile: "/opt/cloud/runner-key",
      artifactSigningKeyFile: "/opt/cloud/artifact-key",
      releaseRepositoriesFile: "/opt/cloud/repositories",
      requireGithubOidc: true,
      artifactVolume: "cloud_artifacts",
      network: "cloud-network",
    };

    expect(
      runtimeContainerArgs({
        name: "bro-web",
        image: "boardreadyops-web-runtime:abc123",
        publish: "127.0.0.1:3003:3000",
        networkAlias: "web",
        restart: "unless-stopped",
        revision: "abc123",
        options,
      }),
    ).toEqual([
      "run",
      "-d",
      "--name",
      "bro-web",
      "--restart",
      "unless-stopped",
      "--network",
      "cloud-network",
      "--network-alias",
      "web",
      "--mount",
      "type=bind,src=/opt/cloud/runtime-env,dst=/run/app-env,readonly",
      "--mount",
      "type=bind,src=/opt/cloud/runner-key,dst=/run/keys/a,readonly",
      "--env",
      "BOARDREADYOPS_RUNNER_RESULT_KEY_FILE=/run/keys/a",
      "--env",
      "BOARDREADYOPS_REQUIRE_RUNNER_SIGNATURE=1",
      "--mount",
      "type=bind,src=/opt/cloud/artifact-key,dst=/run/keys/b,readonly",
      "--env",
      "ARTIFACT_DOWNLOAD_SIGNING_KEY_FILE=/run/keys/b",
      "--mount",
      "type=bind,src=/opt/cloud/repositories,dst=/run/policies/repositories,readonly",
      "--env",
      "BOARDREADYOPS_RELEASE_REPOSITORIES_FILE=/run/policies/repositories",
      "--env",
      "BOARDREADYOPS_REQUIRE_GITHUB_OIDC=1",
      "--mount",
      "type=volume,src=cloud_artifacts,dst=/data/artifacts",
      "-p",
      "127.0.0.1:3003:3000",
      "--label",
      "com.boardreadyops.deployment.revision=abc123",
      "boardreadyops-web-runtime:abc123",
    ]);
  });
});
