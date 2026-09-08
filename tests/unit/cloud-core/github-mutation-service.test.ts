import { describe, expect, it, vi } from "vitest";
import {
  createGitHubMutationService,
  type ExecuteMutationInput,
  type GitHubMutationApiClient,
  isAllowedMutationPath,
} from "../../../packages/cloud-core/src/github-mutation-service.js";

describe("GitHub Mutation Service", () => {
  describe("path allowlist & traversal validation", () => {
    it("allows standard BoardReadyOps repository-owned paths", () => {
      expect(isAllowedMutationPath("boardreadyops.yml")).toBe(true);
      expect(isAllowedMutationPath(".github/workflows/readiness-runner.yml")).toBe(true);
      expect(isAllowedMutationPath(".boardreadyops/config.yml")).toBe(true);
      expect(isAllowedMutationPath(".boardreadyops/pinmap.csv")).toBe(true);
    });

    it("rejects paths outside the BoardReadyOps allowlist", () => {
      expect(isAllowedMutationPath("package.json")).toBe(false);
      expect(isAllowedMutationPath("src/index.ts")).toBe(false);
      expect(isAllowedMutationPath(".github/workflows/deploy.yml")).toBe(false);
      expect(isAllowedMutationPath(".github/workflows/ci.yml")).toBe(false);
      expect(isAllowedMutationPath("README.md")).toBe(false);
    });

    it("rejects path traversal and malicious sequences", () => {
      expect(isAllowedMutationPath("../boardreadyops.yml")).toBe(false);
      expect(isAllowedMutationPath("foo/../../boardreadyops.yml")).toBe(false);
      expect(isAllowedMutationPath("/boardreadyops.yml")).toBe(false);
      expect(isAllowedMutationPath("boardreadyops.yml\0evil")).toBe(false);
      expect(isAllowedMutationPath("boardreadyops.yml\\evil")).toBe(false);
    });
  });

  describe("mutation execution", () => {
    const validMutationInput: ExecuteMutationInput = {
      installationId: 12345,
      owner: "octo-org",
      repo: "hardware-board",
      defaultBranch: "main",
      intent: "setup",
      branchName: "boardreadyops/setup",
      commitMessage: "chore(boardreadyops): setup release readiness",
      prTitle: "chore(boardreadyops): initialize BoardReadyOps",
      prBody: "Sets up BoardReadyOps configuration and GitHub Actions workflow.",
      files: [
        { path: "boardreadyops.yml", content: "version: 1\nmode: enforce\n" },
        { path: ".github/workflows/readiness-runner.yml", content: "name: BoardReadyOps Readiness Runner\n" },
      ],
      actorId: "usr_123",
      requestId: "req_abc",
    };

    it("rejects mutations containing disallowed files", async () => {
      const mockClient: GitHubMutationApiClient = {
        request: vi.fn(),
      };
      const service = createGitHubMutationService({ client: mockClient });

      await expect(
        service.execute({
          ...validMutationInput,
          files: [{ path: "malicious.sh", content: "rm -rf /" }],
        }),
      ).rejects.toThrow(/not in the allowed repository-mutation allowlist/iu);
    });

    it("rejects mutations targeting default branch directly", async () => {
      const mockClient: GitHubMutationApiClient = {
        request: vi.fn(),
      };
      const service = createGitHubMutationService({ client: mockClient });

      await expect(
        service.execute({
          ...validMutationInput,
          branchName: "main",
        }),
      ).rejects.toThrow(/cannot mutate default branch directly/iu);
    });

    it("rejects invalid or unsafe branch names", async () => {
      const mockClient: GitHubMutationApiClient = {
        request: vi.fn(),
      };
      const service = createGitHubMutationService({ client: mockClient });

      await expect(
        service.execute({
          ...validMutationInput,
          branchName: "boardreadyops/../../evil",
        }),
      ).rejects.toThrow(/invalid branch name/iu);
    });

    it("creates a new branch, commit, and pull request when branch does not exist", async () => {
      const calls: { path: string; method?: string; body?: unknown }[] = [];
      const mockClient: GitHubMutationApiClient = {
        async request<T>(path: string, init?: RequestInit): Promise<{ status: number; ok: boolean; data: T }> {
          const body = init?.body ? JSON.parse(init.body as string) : undefined;
          calls.push({ path, method: init?.method ?? "GET", body });

          // 1. Get default branch ref
          if (path.includes("/git/ref/heads/main")) {
            return { status: 200, ok: true, data: { object: { sha: "base-sha-111" } } as T };
          }
          // 2. Get commit tree
          if (path.includes("/git/commits/base-sha-111")) {
            return { status: 200, ok: true, data: { tree: { sha: "base-tree-222" } } as T };
          }
          // 3. Check if target branch exists
          if (path.includes("/git/ref/heads/boardreadyops/setup")) {
            return { status: 404, ok: false, data: {} as T };
          }
          // 4. Check for existing open PR
          if (path.includes("/pulls?") && init?.method !== "POST") {
            return { status: 200, ok: true, data: [] as T };
          }
          // 5. Create tree
          if (path.includes("/git/trees")) {
            return { status: 201, ok: true, data: { sha: "new-tree-333" } as T };
          }
          // 6. Create commit
          if (path.includes("/git/commits") && init?.method === "POST") {
            return { status: 201, ok: true, data: { sha: "new-commit-444" } as T };
          }
          // 7. Create ref
          if (path.includes("/git/refs") && init?.method === "POST") {
            return { status: 201, ok: true, data: { ref: "refs/heads/boardreadyops/setup" } as T };
          }
          // 8. Create PR
          if (path.includes("/pulls") && init?.method === "POST") {
            return {
              status: 201,
              ok: true,
              data: {
                number: 42,
                html_url: "https://github.com/octo-org/hardware-board/pull/42",
              } as T,
            };
          }

          throw new Error(`Unexpected mock call to ${path}`);
        },
      };

      const service = createGitHubMutationService({ client: mockClient });
      const result = await service.execute(validMutationInput);

      expect(result.outcome).toBe("created");
      expect(result.branchName).toBe("boardreadyops/setup");
      expect(result.commitSha).toBe("new-commit-444");
      expect(result.pullRequestNumber).toBe(42);
      expect(result.pullRequestUrl).toBe("https://github.com/octo-org/hardware-board/pull/42");
      expect(result.auditRecord?.eventType).toBe("github.repository_mutation");
    });

    it("reads an allowed repository file from the exact default-branch commit snapshot", async () => {
      const mockClient: GitHubMutationApiClient = {
        async request<T>(path: string): Promise<{ status: number; ok: boolean; data: T }> {
          if (path.includes("/git/ref/heads/main")) {
            return { status: 200, ok: true, data: { object: { sha: "a".repeat(40) } } as T };
          }
          if (path.includes("/contents/boardreadyops.yml?ref=")) {
            return {
              status: 200,
              ok: true,
              data: { encoding: "base64", content: Buffer.from("version: 1\nmode: enforce\n").toString("base64") } as T,
            };
          }
          throw new Error(`Unexpected mock call to ${path}`);
        },
      };
      const service = createGitHubMutationService({ client: mockClient });

      await expect(
        service.readFileSnapshot({
          owner: "octo-org",
          repo: "hardware-board",
          defaultBranch: "main",
          path: "boardreadyops.yml",
        }),
      ).resolves.toEqual({
        baseCommitSha: "a".repeat(40),
        content: "version: 1\nmode: enforce\n",
      });
    });

    it("rejects a mutation when the default branch moved after an exact-base read", async () => {
      let requestCount = 0;
      const client: GitHubMutationApiClient = {
        async request<T>(path: string): Promise<{ status: number; ok: boolean; data: T }> {
          requestCount += 1;
          if (path.includes("/git/ref/heads/main")) {
            return { status: 200, ok: true, data: { object: { sha: "b".repeat(40) } } as T };
          }
          throw new Error(`Unexpected mock call to ${path}`);
        },
      };
      const service = createGitHubMutationService({ client });

      await expect(service.execute({ ...validMutationInput, expectedBaseCommitSha: "a".repeat(40) })).rejects.toThrow(
        /default branch moved.*retry/iu,
      );
      expect(requestCount).toBe(1);
    });

    it("updates pull request metadata when an existing mutation branch receives new content", async () => {
      const calls: { path: string; method: string; body?: unknown }[] = [];
      const mockClient: GitHubMutationApiClient = {
        async request<T>(path: string, init?: RequestInit): Promise<{ status: number; ok: boolean; data: T }> {
          const method = init?.method ?? "GET";
          const body = init?.body ? JSON.parse(init.body as string) : undefined;
          calls.push({ path, method, body });
          if (path.includes("/git/ref/heads/main")) {
            return { status: 200, ok: true, data: { object: { sha: "base-sha" } } as T };
          }
          if (path.includes("/git/commits/base-sha")) {
            return { status: 200, ok: true, data: { tree: { sha: "base-tree" } } as T };
          }
          if (path.includes("/git/ref/heads/boardreadyops/setup")) {
            return { status: 200, ok: true, data: { object: { sha: "existing-commit" } } as T };
          }
          if (path.includes("/git/commits/existing-commit")) {
            return { status: 200, ok: true, data: { tree: { sha: "existing-tree" } } as T };
          }
          if (path.includes("/pulls?") && method === "GET") {
            return {
              status: 200,
              ok: true,
              data: [
                { number: 42, html_url: "https://github.com/octo-org/hardware-board/pull/42", state: "open" },
              ] as T,
            };
          }
          if (path.endsWith("/git/trees") && method === "POST") {
            return { status: 201, ok: true, data: { sha: "new-tree" } as T };
          }
          if (path.endsWith("/git/commits") && method === "POST") {
            return { status: 201, ok: true, data: { sha: "new-commit" } as T };
          }
          if (path.includes("/git/refs/heads/boardreadyops/setup") && method === "PATCH") {
            return { status: 200, ok: true, data: {} as T };
          }
          if (path.endsWith("/pulls/42") && method === "PATCH") {
            return {
              status: 200,
              ok: true,
              data: { number: 42, html_url: "https://github.com/octo-org/hardware-board/pull/42" } as T,
            };
          }
          throw new Error(`Unexpected mock call to ${method} ${path}`);
        },
      };
      const service = createGitHubMutationService({ client: mockClient });

      const result = await service.execute({
        ...validMutationInput,
        prTitle: "Updated waiver title",
        prBody: "Updated waiver reason",
      });

      expect(result.outcome).toBe("updated");
      expect(calls).toContainEqual(
        expect.objectContaining({
          path: "/repos/octo-org/hardware-board/pulls/42",
          method: "PATCH",
          body: { title: "Updated waiver title", body: "Updated waiver reason" },
        }),
      );
    });

    it("repairs stale pull request metadata on retry when branch content already matches", async () => {
      const calls: { path: string; method: string; body?: unknown }[] = [];
      const mockClient: GitHubMutationApiClient = {
        async request<T>(path: string, init?: RequestInit): Promise<{ status: number; ok: boolean; data: T }> {
          const method = init?.method ?? "GET";
          const body = init?.body ? JSON.parse(init.body as string) : undefined;
          calls.push({ path, method, body });
          if (path.includes("/git/ref/heads/main")) {
            return { status: 200, ok: true, data: { object: { sha: "base-sha-111" } } as T };
          }
          if (path.includes("/git/commits/base-sha-111")) {
            return { status: 200, ok: true, data: { tree: { sha: "base-tree-222" } } as T };
          }
          if (path.includes("/git/ref/heads/boardreadyops/setup")) {
            return { status: 200, ok: true, data: { object: { sha: "existing-commit-sha" } } as T };
          }
          if (path.includes("/git/commits/existing-commit-sha")) {
            return { status: 200, ok: true, data: { tree: { sha: "existing-tree-sha" } } as T };
          }
          if (path.includes("/pulls?") && method === "GET") {
            return {
              status: 200,
              ok: true,
              data: [
                {
                  number: 42,
                  html_url: "https://github.com/octo-org/hardware-board/pull/42",
                  state: "open",
                  title: "Old waiver title",
                  body: "Old waiver reason",
                },
              ] as T,
            };
          }
          if (path.includes("/git/trees") && method === "POST") {
            return { status: 201, ok: true, data: { sha: "existing-tree-sha" } as T };
          }
          if (path.endsWith("/pulls/42") && method === "PATCH") {
            return {
              status: 200,
              ok: true,
              data: { number: 42, html_url: "https://github.com/octo-org/hardware-board/pull/42" } as T,
            };
          }
          throw new Error(`Unexpected mock call to ${method} ${path}`);
        },
      };

      const service = createGitHubMutationService({ client: mockClient });
      const result = await service.execute({
        ...validMutationInput,
        prTitle: "Updated waiver title",
        prBody: "Updated waiver reason",
      });

      expect(result.outcome).toBe("updated");
      expect(calls).toContainEqual(
        expect.objectContaining({
          path: "/repos/octo-org/hardware-board/pulls/42",
          method: "PATCH",
          body: { title: "Updated waiver title", body: "Updated waiver reason" },
        }),
      );
    });

    it("returns already_exists idempotently when target branch tree matches and open PR exists", async () => {
      const mockClient: GitHubMutationApiClient = {
        async request<T>(path: string, _init?: RequestInit): Promise<{ status: number; ok: boolean; data: T }> {
          if (path.includes("/git/ref/heads/main")) {
            return { status: 200, ok: true, data: { object: { sha: "base-sha-111" } } as T };
          }
          if (path.includes("/git/commits/base-sha-111")) {
            return { status: 200, ok: true, data: { tree: { sha: "base-tree-222" } } as T };
          }
          if (path.includes("/git/ref/heads/boardreadyops/setup")) {
            return { status: 200, ok: true, data: { object: { sha: "existing-commit-sha" } } as T };
          }
          if (path.includes("/git/commits/existing-commit-sha")) {
            return { status: 200, ok: true, data: { tree: { sha: "existing-tree-sha" } } as T };
          }
          if (path.includes("/pulls?")) {
            return {
              status: 200,
              ok: true,
              data: [
                {
                  number: 42,
                  html_url: "https://github.com/octo-org/hardware-board/pull/42",
                  state: "open",
                  title: validMutationInput.prTitle,
                  body: validMutationInput.prBody,
                },
              ] as T,
            };
          }
          if (path.includes("/git/trees")) {
            // New tree has same sha as existing tree
            return { status: 201, ok: true, data: { sha: "existing-tree-sha" } as T };
          }

          throw new Error(`Unexpected mock call to ${path}`);
        },
      };

      const service = createGitHubMutationService({ client: mockClient });
      const result = await service.execute(validMutationInput);

      expect(result.outcome).toBe("already_exists");
      expect(result.pullRequestNumber).toBe(42);
      expect(result.pullRequestUrl).toBe("https://github.com/octo-org/hardware-board/pull/42");
    });
  });
});
