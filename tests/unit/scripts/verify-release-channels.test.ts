import { describe, expect, it } from "vitest";

import { evaluatePublicReleaseSnapshot } from "../../../scripts/verify-release-channels.mjs";

const version = "1.30.1";
const releaseCommit = "884f5fa31f8fd701693c533747c69eb7d13f5464";
const indexDigest = "sha256:4df163600bd03126f072a5870db33f72db9991bf932fe275b5858e54f73fc650";

const binaryDigests = {
  "boardreadyops-linux-x64": "c1515abbdafab8e46e63feb65e3c9899babf51e256a4e8ed128046539bd1b520",
  "boardreadyops-linux-arm64": "a546c1a4339b32f26000c916471fb8f5dfc007c47ff4c88116a28356f213eca8",
  "boardreadyops-macos-x64": "411b083dd6c2ab675404cdd8e5f62d1c1371b4b3e5825c8409ed0464514c4034",
  "boardreadyops-macos-arm64": "6f9d1d9f3cc04c4380f7ccfb8ccecd58bf9ea8c4b473f2b78b39308ef9c1ba7f",
  "boardreadyops-win-x64.exe": "36ec06910e51b4b0557eedb14740b470327523ec3614fd8f55f4a60d9744d61b",
};

function healthySnapshot(overrides: Record<string, unknown> = {}) {
  return {
    version,
    expectedNodeEngines: "^22.14.0 || ^24.0.0",
    npm: {
      version,
      latest: version,
      engines: "^22.14.0 || ^24.0.0",
    },
    release: {
      tag: `v${version}`,
      draft: false,
      prerelease: false,
      commit: releaseCommit,
      assets: [
        ...Object.entries(binaryDigests).map(([name, digest]) => ({ name, digest: `sha256:${digest}` })),
        {
          name: "SHA256SUMS",
          digest: "sha256:90be0ca72010506a3b895db251130ff0708eed120fb2f6a969a55018ebae1ee8",
        },
        {
          name: "sbom.cyclonedx.json",
          digest: "sha256:4850654f935fccfed965ef47f4b0d66433e5be69d5b0f682542d4011bee834ea",
        },
      ],
    },
    floatingV1Commit: releaseCommit,
    checksumEntries: binaryDigests,
    downloadedAssetDigests: {
      SHA256SUMS: "90be0ca72010506a3b895db251130ff0708eed120fb2f6a969a55018ebae1ee8",
      "sbom.cyclonedx.json": "4850654f935fccfed965ef47f4b0d66433e5be69d5b0f682542d4011bee834ea",
    },
    ghcr: {
      exact: { digest: indexDigest, platforms: ["linux/amd64", "linux/arm64"] },
      major: { digest: indexDigest, platforms: ["linux/amd64", "linux/arm64"] },
      latest: { digest: indexDigest, platforms: ["linux/amd64", "linux/arm64"] },
    },
    actionPins: [
      { path: "README.md", sha: releaseCommit, version },
      { path: "docs/action.md", sha: releaseCommit, version },
      { path: "docs/github-action.md", sha: releaseCommit, version },
      { path: "docs/integrations/kibot.md", sha: releaseCommit, version },
      { path: "docs/sbom.md", sha: releaseCommit, version },
      { path: "docs/review-app.md", sha: releaseCommit, version },
    ],
    actionMetadataMatchesRelease: true,
    formula: {
      version,
      digests: Object.values(binaryDigests).filter((_, index) => index < 4),
    },
    ...overrides,
  };
}

describe("public release channel snapshot", () => {
  it("accepts aligned npm, release, assets, aliases, Action pins, and formula state", () => {
    expect(evaluatePublicReleaseSnapshot(healthySnapshot())).toEqual([]);
  });

  it("rejects stale floating aliases and immutable Action pins", () => {
    const snapshot = healthySnapshot({
      floatingV1Commit: "1111111111111111111111111111111111111111",
      ghcr: {
        exact: { digest: indexDigest, platforms: ["linux/amd64", "linux/arm64"] },
        major: { digest: "sha256:deadbeef", platforms: ["linux/amd64", "linux/arm64"] },
        latest: { digest: indexDigest, platforms: ["linux/amd64", "linux/arm64"] },
      },
      actionPins: [{ path: "README.md", sha: "2222222222222222222222222222222222222222", version: "1.7.2" }],
    });

    expect(evaluatePublicReleaseSnapshot(snapshot).map((failure) => failure.name)).toEqual(
      expect.arrayContaining([
        "floating v1 tag matches the exact release commit",
        "GHCR stable aliases resolve to the exact release index",
        "recommended immutable Action pins match the reviewed release commit",
      ]),
    );
  });

  it("rejects release asset and checksum drift", () => {
    const snapshot = healthySnapshot({
      checksumEntries: { ...binaryDigests, "boardreadyops-linux-x64": "0".repeat(64) },
      downloadedAssetDigests: {
        SHA256SUMS: "0".repeat(64),
        "sbom.cyclonedx.json": "4850654f935fccfed965ef47f4b0d66433e5be69d5b0f682542d4011bee834ea",
      },
    });

    expect(evaluatePublicReleaseSnapshot(snapshot).map((failure) => failure.name)).toEqual(
      expect.arrayContaining([
        "release binary checksums match GitHub asset digests",
        "downloaded checksum and SBOM files match GitHub asset digests",
      ]),
    );
  });
});
