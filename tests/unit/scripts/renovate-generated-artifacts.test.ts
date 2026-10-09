import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error Native ESM operations helper intentionally has no declaration file.
import * as generated from "../../../scripts/renovate-generated-artifacts.mjs";

const { authorizeRenovatePullRequest, exportGeneratedFiles, verifyAndApplyGeneratedFiles } = generated;

const tempRoots: string[] = [];
async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "bro-renovate-generated-"));
  tempRoots.push(dir);
  const source = path.join(dir, "source");
  const output = path.join(dir, "output");
  const target = path.join(dir, "target");
  for (const base of [source, target]) {
    await mkdir(path.join(base, "dist/action"), { recursive: true });
    await mkdir(path.join(base, "dist/cli"), { recursive: true });
    for (const name of ["NOTICE", "dist/action/index.cjs", "dist/cli/index.cjs"]) {
      await writeFile(path.join(base, name), "before");
    }
  }
  await mkdir(output, { recursive: true });
  await writeFile(path.join(source, "NOTICE"), "new notice");
  return { dir, source, output, target };
}
afterEach(async () => {
  for (const dir of tempRoots.splice(0)) await rm(dir, { recursive: true, force: true });
});

const sha = "a".repeat(40);
const repository = "oaslananka/boardreadyops";
const currentPr = {
  state: "open",
  number: 88,
  user: { login: "renovate[bot]" },
  base: { ref: "main" },
  head: { ref: "renovate/react-20", sha, repo: { full_name: repository } },
};
const event = { repository: { full_name: repository }, pull_request: currentPr };

describe("Mend Renovate generated-file privilege separation", () => {
  it("authorizes only a live open same-repo Renovate PR at the exact event SHA", () => {
    expect(authorizeRenovatePullRequest(event, currentPr, repository)).toEqual({
      sha,
      branch: "renovate/react-20",
      number: 88,
    });
    expect(
      authorizeRenovatePullRequest(
        event,
        { ...currentPr, head: { ...currentPr.head, sha: "b".repeat(40) } },
        repository,
      ),
    ).toBeNull();
    expect(authorizeRenovatePullRequest(event, { ...currentPr, state: "closed" }, repository)).toBeNull();
    expect(authorizeRenovatePullRequest(event, null, repository)).toBeNull();
  });

  it("rejects forks, actor changes, malformed branch names and unrelated repositories", () => {
    expect(authorizeRenovatePullRequest(event, { ...currentPr, user: { login: "attacker" } }, repository)).toBeNull();
    expect(
      authorizeRenovatePullRequest(
        event,
        { ...currentPr, head: { ...currentPr.head, repo: { full_name: "attacker/repo" } } },
        repository,
      ),
    ).toBeNull();
    expect(
      authorizeRenovatePullRequest(
        event,
        { ...currentPr, head: { ...currentPr.head, ref: "feature/attack" } },
        repository,
      ),
    ).toBeNull();
    expect(
      authorizeRenovatePullRequest(
        event,
        { ...currentPr, head: { ...currentPr.head, ref: "renovate/../x" } },
        repository,
      ),
    ).toBeNull();
    expect(
      authorizeRenovatePullRequest({ ...event, repository: { full_name: "another/repo" } }, currentPr, repository),
    ).toBeNull();
  });

  it("copies only declared NOTICE and dist and verifies source identity and content hashes", async () => {
    const { source, output, target } = await fixture();
    await exportGeneratedFiles(source, output, sha);
    await verifyAndApplyGeneratedFiles(output, target, sha);
    expect(await readFile(path.join(target, "NOTICE"), "utf8")).toBe("new notice");
    await expect(verifyAndApplyGeneratedFiles(output, target, "b".repeat(40))).rejects.toThrow(/identity/);
    await writeFile(path.join(output, "NOTICE"), "tampered");
    await expect(verifyAndApplyGeneratedFiles(output, target, sha)).rejects.toThrow(/hash mismatch/i);
  });

  it.skipIf(process.platform === "win32")(
    "rejects an artifact symlink and never changes a source file outside the allowlist",
    async () => {
      const { source, output, target, dir } = await fixture();
      await exportGeneratedFiles(source, output, sha);
      await rm(path.join(output, "NOTICE"));
      await symlink(path.join(dir, "source", "NOTICE"), path.join(output, "NOTICE"));
      await expect(verifyAndApplyGeneratedFiles(output, target, sha)).rejects.toThrow(/Symlink/);
    },
  );
});
