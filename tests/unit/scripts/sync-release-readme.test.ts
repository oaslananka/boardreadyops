import { describe, expect, it } from "vitest";

import { syncReleaseReadme } from "../../../scripts/sync-release-readme.mjs";

const readme = `
The current public npm package is \`boardreadyops@1.7.2\`. It is verified on
Node.js 22.14+ and 24, includes the current CLI bundle, schemas, docs, Action
metadata, and matches the public \`v1.7.2\` tag archive.
Binary release assets should be verified against \`v1.7.2\`, which publishes the
current release assets.

- uses: oaslananka/boardreadyops@005afb83bd04f50a8da33bbffc441818910951f6 # v1.7.2
`;

describe("sync-release-readme", () => {
  it("updates public release channel references without changing immutable Action pins", () => {
    const result = syncReleaseReadme(readme, "1.8.0");

    expect(result).toContain("boardreadyops@1.8.0");
    expect(result).toContain("public `v1.8.0` tag archive");
    expect(result).toContain("verified against `v1.8.0`");
    expect(result).toContain("oaslananka/boardreadyops@005afb83bd04f50a8da33bbffc441818910951f6 # v1.7.2");
  });

  it("fails closed when a required README release marker is missing", () => {
    expect(() => syncReleaseReadme("# BoardReadyOps\n", "1.8.0")).toThrow("README release marker not found");
  });

  it("rejects malformed release versions", () => {
    expect(() => syncReleaseReadme(readme, "latest")).toThrow("invalid release version");
  });
});
