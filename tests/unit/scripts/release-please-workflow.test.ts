import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = join(process.cwd(), ".github/workflows/release-please.yml");
const releasePleaseTokenExpression = ["$", "{{ secrets.RELEASE_PLEASE_TOKEN }}"].join("");
const releaseBaseFetchExpression = [
  'git fetch origin "',
  "$",
  "{BASE_BRANCH}:refs/remotes/origin/",
  "$",
  '{BASE_BRANCH}"',
].join("");

describe("release-please workflow contract", () => {
  it("uses the dedicated release token for PR creation and regeneration", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain(`token: ${releasePleaseTokenExpression}`);
    expect(workflow).toContain(`GH_TOKEN: ${releasePleaseTokenExpression}`);
    expect(workflow).toContain("pull-requests: write");
    expect(workflow).toContain("pnpm run release:readme");
    expect(workflow).toContain("pnpm run notice");
    expect(workflow).toContain(releaseBaseFetchExpression);
    expect(workflow).toContain("node scripts/rewrite-release-pr-verified.mjs");
    expect(workflow).not.toContain('git commit -am "chore: regenerate release and compliance artifacts"');
    expect(workflow).not.toContain(['git push origin "HEAD:', "$", '{PR_BRANCH}"'].join(""));
    expect(workflow).not.toContain('if [ -n "$(git status --porcelain)" ]');
  });

  it("does not hide release-please failures", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).not.toContain("continue-on-error: true");
  });
});
