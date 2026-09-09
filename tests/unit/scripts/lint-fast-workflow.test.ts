import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = join(process.cwd(), ".github/workflows/lint-fast.yml");

describe("lint-fast workflow contract", () => {
  it("skips transient release-please pull request heads while keeping manual runs enabled", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("github.event_name != 'pull_request'");
    expect(workflow).toContain("!startsWith(github.head_ref, 'release-please--branches--')");
    expect(workflow).toContain("workflow_dispatch:");
  });
});
