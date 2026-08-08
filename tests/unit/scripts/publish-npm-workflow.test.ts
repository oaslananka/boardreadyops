import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = join(process.cwd(), ".github/workflows/publish-npm.yml");
const packJsonExpression = ["$", "{pack_json}"].join("");
const homeNpmrcRedirect = ['> "$', '{HOME}/.npmrc"'].join("");

describe("publish-npm workflow contract", () => {
  it("uses one canonical workflow-dispatch publish trigger", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const triggerBlock = workflow.slice(workflow.indexOf("on:"), workflow.indexOf("concurrency:"));

    expect(triggerBlock).toContain("workflow_dispatch:");
    expect(triggerBlock).not.toMatch(/^ {2}release:/mu);
    expect(workflow).not.toContain("github.event.release");
    expect(workflow).not.toContain("EVENT_RELEASE_TAG");
    expect(workflow).toContain(["ref: $", "{{ inputs.tag || github.ref }}"].join(""));
  });

  it("validates the release tarball with direct npm pack instead of the tag's size script", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const verificationBlock = workflow.slice(
      workflow.indexOf("- name: Verify release package"),
      workflow.indexOf("- name: Attest provenance"),
    );

    expect(verificationBlock).toContain(`npm pack --dry-run --json > "${packJsonExpression}"`);
    expect(verificationBlock).toContain(`PACK_JSON="${packJsonExpression}" node`);
    expect(verificationBlock).toContain('"dist/cli/index.cjs"');
    expect(verificationBlock).toContain('"dist/action/index.cjs"');
    expect(verificationBlock).toContain("Object.values(parsed ?? {}).filter");
    expect(verificationBlock).toContain("metadata candidates");
    expect(verificationBlock).toContain("pack.unpackedSize");
    expect(verificationBlock).not.toContain("pnpm run check:size");
  });

  it("uses OIDC trusted publishing without a long-lived npm publish token fallback", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const publishBlock = workflow.slice(workflow.indexOf("- name: Publish npm package"));

    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("Refuse npm token-auth fallback");
    expect(workflow).toContain("Verify npm Trusted Publisher OIDC");
    expect(workflow).toContain("ACTIONS_ID_TOKEN_REQUEST_URL");
    expect(workflow).toContain("NPM_PACKAGE: boardreadyops");
    expect(workflow).toContain(["/-/npm/v1/oidc/token/exchange/package/$", "{NPM_PACKAGE}"].join(""));
    expect(workflow).toContain("npm Trusted Publisher OIDC exchange succeeded");
    expect(workflow).toContain("GitHub OIDC safe claims");
    expect(workflow).toContain('repository: "oaslananka/boardreadyops"');
    expect(workflow).toContain('"oaslananka/boardreadyops/.github/workflows/publish-npm.yml@"');
    expect(workflow).not.toContain("console.log(id_token)");
    expect(workflow).not.toContain("console.log(token)");
    expect(workflow).toContain("npm install -g npm@latest");
    expect(workflow).not.toContain("secrets.NPM_TOKEN");
    expect(publishBlock).not.toContain("_authToken=");
    expect(publishBlock).not.toContain(homeNpmrcRedirect);
    expect(publishBlock).toContain("npm publish --access public");
    expect(publishBlock).toContain("npm publish --access public --tag next");
  });

  it("keeps publish idempotency and stable floating-tag gating", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const publishBlock = workflow.slice(
      workflow.indexOf("- name: Publish npm package"),
      workflow.indexOf("floating-release-tags:"),
    );

    expect(publishBlock).toContain("is already published; skipping npm publish");
    expect(publishBlock).toContain('published_http_code="$(curl --silent --show-error');
    expect(publishBlock).toContain('"${NPM_REGISTRY}/${NPM_PACKAGE}/${package_version}"');
    expect(publishBlock).toContain('case "${published_http_code}" in');
    expect(publishBlock).toContain("Could not check npm registry");
    expect(publishBlock).not.toContain('npm view "boardreadyops@${package_version}" version');
    expect(publishBlock).not.toContain("|| true");
    expect(workflow).toContain("release_allows_floating_tags == 'true'");
    expect(workflow).toContain("release_is_prerelease == 'false'");
  });
});
