import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = join(process.cwd(), ".github/workflows/authenticated-unlighthouse.yml");
const sessionExpression = ["$", "{{ secrets.BROPS_UNLIGHTHOUSE_SESSION }}"].join("");

describe("authenticated Unlighthouse workflow", () => {
  it("ships a dedicated manual workflow", () => {
    expect(existsSync(workflowPath)).toBe(true);
  });

  it("uses only manual dispatch with the ephemeral repository secret", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("pull_request:");
    expect(workflow).not.toContain("pull_request_target:");
    expect(workflow).not.toContain("push:");
    expect(workflow).not.toContain("schedule:");
    expect(workflow).not.toContain("inputs:");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain(`BROPS_SESSION: ${sessionExpression}`);
    expect(workflow).toContain("BROPS_UNLIGHTHOUSE_SITE: https://boardreadyops.com");
    expect(workflow).toContain("corepack pnpm run qa:unlighthouse:auth");
    expect(workflow).toContain(".unlighthouse/authenticated/");
    expect(workflow).toContain(".unlighthouse/authenticated-routes.json");
    expect(workflow).toContain("retention-days: 7");
    expect(workflow).not.toContain('echo "$BROPS_SESSION"');
  });
});
