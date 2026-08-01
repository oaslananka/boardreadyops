import { execFile } from "node:child_process";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import {
  collectDesiredTreeChanges,
  rewriteReleaseBranchWithVerifiedCommit,
} from "../../../scripts/rewrite-release-pr-verified.mjs";

const execFileAsync = promisify(execFile);
const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("rewrite-release-pr-verified", () => {
  it("collects the complete desired release tree relative to main, including committed and regenerated changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "boardreadyops-release-rewrite-"));
    tempDirectories.push(root);
    await git(root, "init", "-b", "main");
    await git(root, "config", "user.name", "BoardReadyOps Test");
    await git(root, "config", "user.email", "test@example.com");
    await writeFile(join(root, "package.json"), '{"version":"1.0.0"}\n');
    await writeFile(join(root, "README.md"), "before\n");
    await writeFile(join(root, "obsolete.txt"), "remove\n");
    await git(root, "add", ".");
    await git(root, "commit", "-m", "main baseline");
    const baseOid = (await git(root, "rev-parse", "HEAD")).trim();

    await git(root, "checkout", "-b", "release-please");
    await writeFile(join(root, "package.json"), '{"version":"1.0.1"}\n');
    await writeFile(join(root, "CHANGELOG.md"), "# 1.0.1\n");
    await git(root, "add", ".");
    await git(root, "commit", "-m", "release 1.0.1");
    const branchHeadOid = (await git(root, "rev-parse", "HEAD")).trim();

    await writeFile(join(root, "README.md"), "after regeneration\n");
    await writeFile(join(root, "NOTICE"), "generated\n");
    await unlink(join(root, "obsolete.txt"));

    const changes = await collectDesiredTreeChanges(root, baseOid);

    expect(changes.baseOid).toBe(baseOid);
    expect(changes.branchHeadOid).toBe(branchHeadOid);
    expect(changes.additions.map(({ path }) => path)).toEqual(["CHANGELOG.md", "NOTICE", "README.md", "package.json"]);
    expect(changes.deletions).toEqual([{ path: "obsolete.txt" }]);
    expect(
      Object.fromEntries(
        changes.additions.map(({ path, contents }) => [path, Buffer.from(contents, "base64").toString()]),
      ),
    ).toMatchObject({
      "package.json": '{"version":"1.0.1"}\n',
      "README.md": "after regeneration\n",
      NOTICE: "generated\n",
    });
  });

  it("rewrites the release branch directly to one GitHub-verified commit based on main", async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    let targetHead = "unsigned-release-head";
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      const method = init?.method ?? "GET";

      if (method === "GET" && url.endsWith("/branches/release-please")) {
        return Response.json({ commit: { sha: targetHead } });
      }
      if (method === "POST" && url.endsWith("/git/refs")) {
        return Response.json({ ref: "refs/heads/release-please-verified-123-1" }, { status: 201 });
      }
      if (method === "POST" && url.endsWith("/graphql")) {
        return Response.json({ data: { createCommitOnBranch: { commit: { oid: "verified-release-oid" } } } });
      }
      if (method === "GET" && url.endsWith("/commits/verified-release-oid")) {
        return Response.json({ commit: { verification: { verified: true, reason: "valid" } } });
      }
      if (method === "PATCH" && url.endsWith("/git/refs/heads/release-please")) {
        const body = JSON.parse(String(init?.body));
        targetHead = body.sha;
        return Response.json({ object: { sha: targetHead } });
      }
      if (method === "DELETE" && url.endsWith("/git/refs/heads/release-please-verified-123-1")) {
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    };

    const result = await rewriteReleaseBranchWithVerifiedCommit(
      {
        repository: "oaslananka/boardreadyops",
        branch: "release-please",
        temporaryBranch: "release-please-verified-123-1",
        branchHeadOid: "unsigned-release-head",
        baseOid: "main-oid",
        headline: "chore(main): release 1.25.1",
        body: "Regenerated release and compliance artifacts.",
        additions: [{ path: "package.json", contents: Buffer.from('{"version":"1.25.1"}\n').toString("base64") }],
        deletions: [],
        token: "test-token",
      },
      fetchImpl,
    );

    expect(result).toEqual({ oid: "verified-release-oid", verified: true, reason: "valid" });
    const mutation = requests.find(({ url }) => url.endsWith("/graphql"));
    const mutationPayload = JSON.parse(String(mutation?.init?.body));
    expect(mutationPayload.variables.input).toMatchObject({
      branch: {
        repositoryNameWithOwner: "oaslananka/boardreadyops",
        branchName: "release-please-verified-123-1",
      },
      expectedHeadOid: "main-oid",
    });
    const createRef = requests.find(({ url, init }) => url.endsWith("/git/refs") && init?.method === "POST");
    expect(JSON.parse(String(createRef?.init?.body))).toEqual({
      ref: "refs/heads/release-please-verified-123-1",
      sha: "main-oid",
    });
    const updateRef = requests.find(
      ({ url, init }) => url.endsWith("/git/refs/heads/release-please") && init?.method === "PATCH",
    );
    expect(JSON.parse(String(updateRef?.init?.body))).toEqual({ sha: "verified-release-oid", force: true });
    expect(targetHead).toBe("verified-release-oid");
    expect(requests.at(-1)).toMatchObject({
      url: "https://api.github.com/repos/oaslananka/boardreadyops/git/refs/heads/release-please-verified-123-1",
      init: { method: "DELETE" },
    });
  });

  it("fails before mutation when the remote release branch changed after cloning", async () => {
    const requests: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      requests.push(String(input));
      return Response.json({ commit: { sha: "newer-release-head" } });
    };

    await expect(
      rewriteReleaseBranchWithVerifiedCommit(
        {
          repository: "oaslananka/boardreadyops",
          branch: "release-please",
          temporaryBranch: "release-please-verified-123-1",
          branchHeadOid: "stale-clone-head",
          baseOid: "main-oid",
          headline: "release",
          body: "",
          additions: [{ path: "package.json", contents: "e30=" }],
          deletions: [],
          token: "test-token",
        },
        fetchImpl,
      ),
    ).rejects.toThrow("release branch moved: expected stale-clone-head, found newer-release-head");
    expect(requests).toEqual(["https://api.github.com/repos/oaslananka/boardreadyops/branches/release-please"]);
  });

  it("does not overwrite the release branch when it moves while the verified commit is being prepared", async () => {
    let branchReads = 0;
    const methods: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      methods.push(`${method} ${url}`);
      if (method === "GET" && url.endsWith("/branches/release-please")) {
        branchReads += 1;
        return Response.json({ commit: { sha: branchReads === 1 ? "unsigned-release-head" : "newer-release-head" } });
      }
      if (method === "POST" && url.endsWith("/git/refs")) {
        return Response.json({ ref: "refs/heads/release-please-verified-123-1" }, { status: 201 });
      }
      if (method === "POST" && url.endsWith("/graphql")) {
        return Response.json({ data: { createCommitOnBranch: { commit: { oid: "verified-release-oid" } } } });
      }
      if (method === "GET" && url.endsWith("/commits/verified-release-oid")) {
        return Response.json({ commit: { verification: { verified: true, reason: "valid" } } });
      }
      if (method === "DELETE" && url.endsWith("/git/refs/heads/release-please-verified-123-1")) {
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    };

    await expect(
      rewriteReleaseBranchWithVerifiedCommit(
        {
          repository: "oaslananka/boardreadyops",
          branch: "release-please",
          temporaryBranch: "release-please-verified-123-1",
          branchHeadOid: "unsigned-release-head",
          baseOid: "main-oid",
          headline: "release",
          body: "",
          additions: [{ path: "package.json", contents: "e30=" }],
          deletions: [],
          token: "test-token",
        },
        fetchImpl,
      ),
    ).rejects.toThrow("release branch moved before rewrite: expected unsigned-release-head, found newer-release-head");
    expect(methods.some((entry) => entry.startsWith("PATCH "))).toBe(false);
    expect(methods.at(-1)).toContain(
      "DELETE https://api.github.com/repos/oaslananka/boardreadyops/git/refs/heads/release-please-verified-123-1",
    );
  });

  it("deletes the temporary branch and fails closed when GitHub does not verify the commit", async () => {
    const methods: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      methods.push(`${method} ${url}`);
      if (method === "GET" && url.endsWith("/branches/release-please")) {
        return Response.json({ commit: { sha: "unsigned-release-head" } });
      }
      if (method === "POST" && url.endsWith("/git/refs")) {
        return Response.json({ ref: "refs/heads/release-please-verified-123-1" }, { status: 201 });
      }
      if (method === "POST" && url.endsWith("/graphql")) {
        return Response.json({ data: { createCommitOnBranch: { commit: { oid: "unsigned-oid" } } } });
      }
      if (method === "GET" && url.endsWith("/commits/unsigned-oid")) {
        return Response.json({ commit: { verification: { verified: false, reason: "unsigned" } } });
      }
      if (method === "DELETE" && url.endsWith("/git/refs/heads/release-please-verified-123-1")) {
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    };

    await expect(
      rewriteReleaseBranchWithVerifiedCommit(
        {
          repository: "oaslananka/boardreadyops",
          branch: "release-please",
          temporaryBranch: "release-please-verified-123-1",
          branchHeadOid: "unsigned-release-head",
          baseOid: "main-oid",
          headline: "release",
          body: "",
          additions: [{ path: "package.json", contents: "e30=" }],
          deletions: [],
          token: "test-token",
        },
        fetchImpl,
      ),
    ).rejects.toThrow("GitHub did not verify commit unsigned-oid: unsigned");
    expect(methods.some((entry) => entry.startsWith("PATCH "))).toBe(false);
    expect(methods.at(-1)).toContain(
      "DELETE https://api.github.com/repos/oaslananka/boardreadyops/git/refs/heads/release-please-verified-123-1",
    );
  });
});

async function git(root: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: root });
  return stdout;
}
