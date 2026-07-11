import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = join(process.cwd(), ".github/workflows/release-please.yml");
const releasePleaseTokenExpression = ["$", "{{ secrets.RELEASE_PLEASE_TOKEN }}"].join("");

describe("release-please workflow contract", () => {
  it("uses the dedicated release token for PR creation and regeneration", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain(`token: ${releasePleaseTokenExpression}`);
    expect(workflow).toContain(`GH_TOKEN: ${releasePleaseTokenExpression}`);
    expect(workflow).toContain("pull-requests: write");
    expect(workflow).toContain("pnpm run release:readme");
  });

  it("does not hide release-please failures", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).not.toContain("continue-on-error: true");
  });
});
