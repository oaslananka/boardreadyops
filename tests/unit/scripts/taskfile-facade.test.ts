import { readFileSync } from "node:fs";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

type TaskDefinition = {
  cmds?: string[];
};

type Taskfile = {
  tasks?: Record<string, TaskDefinition>;
};

const taskfile = load(readFileSync("Taskfile.yml", "utf8")) as Taskfile;
const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
};

describe("Taskfile facade", () => {
  it("delegates human-facing aliases to canonical package scripts", () => {
    expect(taskfile.tasks?.verify?.cmds).toEqual(["corepack pnpm run verify"]);
    expect(taskfile.tasks?.dev?.cmds).toEqual(["corepack pnpm run cloud:dev"]);
    expect(taskfile.tasks?.["backup:verify"]?.cmds).toEqual(["corepack pnpm run cloud:backup:verify"]);
    expect(taskfile.tasks?.["deploy:self-hosted"]?.cmds).toEqual(["corepack pnpm run cloud:deploy:self-hosted"]);
    expect(taskfile.tasks?.["docs:serve"]?.cmds).toEqual(["corepack pnpm run docs:serve"]);
  });

  it("keeps verify non-recursive and preserves the moderate dependency audit gate", () => {
    expect(packageJson.scripts.verify).not.toMatch(/\btask\b/);
    expect(packageJson.scripts.verify).toContain("corepack pnpm audit --audit-level moderate");
  });
});
