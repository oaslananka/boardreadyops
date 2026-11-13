import { describe, expect, it, vi } from "vitest";
import { defaultReadinessWorkflowTemplate } from "../../../packages/cloud-core/src/readiness-workflow-template.js";
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
          if (path.includes("/contents/")) {
            return { status: 404, ok: false, data: {} as T };
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
          if (path.includes("/contents/")) {
            return { status: 404, ok: false, data: {} as T };
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
          if (path.includes("/contents/")) {
            return { status: 404, ok: false, data: {} as T };
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

    function snapshotClient(
      existing: Record<string, string>,
      options: { lookupStatus?: number; changedBase?: boolean } = {},
    ) {
      const requests: Array<{ path: string; method: string; body?: unknown }> = [];
      let baseLookups = 0;
      const client: GitHubMutationApiClient = {
        async request<T>(path: string, init?: RequestInit): Promise<{ status: number; ok: boolean; data: T }> {
          const method = init?.method ?? "GET";
          requests.push({ path, method, ...(init?.body ? { body: JSON.parse(init.body as string) } : {}) });
          const make = (status: number, data: unknown) => ({
            status,
            ok: status >= 200 && status < 300,
            data: data as T,
          });
          if (path.endsWith("/git/ref/heads/main")) {
            baseLookups++;
            return make(200, { object: { sha: options.changedBase && baseLookups > 1 ? "other-sha" : "base-sha" } });
          }
          if (path.endsWith("/git/commits/base-sha")) return make(200, { tree: { sha: "base-tree" } });
          const contentMarker = "/contents/";
          if (path.includes(contentMarker)) {
            if (options.lookupStatus !== undefined) return make(options.lookupStatus, {});
            const filePath = path.split(contentMarker)[1]?.split("?")[0];
            if (filePath === undefined) throw new Error("missing file path");
            const value = existing[filePath];
            return value === undefined
              ? make(404, {})
              : make(200, { type: "file", encoding: "base64", content: Buffer.from(value).toString("base64") });
          }
          if (path.includes("/git/ref/heads/boardreadyops/setup")) return make(404, {});
          if (path.includes("/pulls?")) return make(200, []);
          if (method === "POST" && path.endsWith("/git/trees")) return make(201, { sha: "new-tree" });
          if (method === "POST" && path.endsWith("/git/commits")) return make(201, { sha: "new-commit" });
          if (method === "POST" && path.endsWith("/git/refs")) return make(201, {});
          if (method === "POST" && path.endsWith("/pulls")) {
            return make(201, { number: 42, html_url: "https://github.test/octo/hardware/pull/42" });
          }
          throw new Error(`unexpected mock request: ${method} ${path}`);
        },
      };
      return { requests, client };
    }

    it.each([
      ["custom workflow", ".github/workflows/readiness-runner.yml", "name: customized workflow\\n"],
      ["custom configuration", "boardreadyops.yml", "version: 999\\n"],
    ])("fails closed before Git writes for existing %s", async (_, filePath, existingContent) => {
      const { client, requests } = snapshotClient({ [filePath]: existingContent });
      await expect(createGitHubMutationService({ client }).execute(validMutationInput)).rejects.toMatchObject({
        name: "SetupFileConflictError",
        filePath,
      });
      expect(requests.filter((request) => request.method !== "GET")).toEqual([]);
    });

    it("accepts identical existing setup bytes without overwriting custom content", async () => {
      const existing = Object.fromEntries(validMutationInput.files.map((file) => [file.path, file.content]));
      const { client, requests } = snapshotClient(existing);
      const outcome = await createGitHubMutationService({ client }).execute(validMutationInput);
      expect(outcome.outcome).toBe("created");
      expect(requests.filter((request) => request.path.includes("/contents/"))).toHaveLength(2);
    });

    it("preserves exact canonical variable-origin workflow while adding only missing setup config", async () => {
      const generatedWorkflow = defaultReadinessWorkflowTemplate.replaceAll(
        "${{ vars.BOARDREADYOPS_CLOUD_ORIGIN }}",
        "https://boardreadyops.com",
      );
      const { client, requests } = snapshotClient({
        ".github/workflows/readiness-runner.yml": defaultReadinessWorkflowTemplate,
      });
      const result = await createGitHubMutationService({ client }).execute({
        ...validMutationInput,
        files: [
          validMutationInput.files[0]!,
          { path: ".github/workflows/readiness-runner.yml", content: generatedWorkflow },
        ],
      });
      expect(result.outcome).toBe("created");
      const tree = requests.find((request) => request.path.endsWith("/git/trees"));
      expect((tree?.body as { tree?: Array<{ path: string }> })?.tree?.map((file) => file.path)).toEqual([
        "boardreadyops.yml",
      ]);
    });

    it("rejects noncanonical existing workflow without any Git mutation", async () => {
      const generatedWorkflow = defaultReadinessWorkflowTemplate.replaceAll(
        "${{ vars.BOARDREADYOPS_CLOUD_ORIGIN }}",
        "https://boardreadyops.com",
      );
      const { client, requests } = snapshotClient({
        ".github/workflows/readiness-runner.yml": defaultReadinessWorkflowTemplate.replace(
          "  contents: read",
          "  contents: write",
        ),
      });
      await expect(
        createGitHubMutationService({ client }).execute({
          ...validMutationInput,
          files: [
            validMutationInput.files[0]!,
            { path: ".github/workflows/readiness-runner.yml", content: generatedWorkflow },
          ],
        }),
      ).rejects.toMatchObject({
        name: "SetupFileConflictError",
        filePath: ".github/workflows/readiness-runner.yml",
      });
      expect(requests.filter((request) => request.method !== "GET")).toEqual([]);
    });

    it("rejects arbitrary proposed workflow bytes even with canonical existing source", async () => {
      const { client, requests } = snapshotClient({
        ".github/workflows/readiness-runner.yml": defaultReadinessWorkflowTemplate,
      });
      await expect(
        createGitHubMutationService({ client }).execute({
          ...validMutationInput,
          files: [
            validMutationInput.files[0]!,
            {
              path: ".github/workflows/readiness-runner.yml",
              content: defaultReadinessWorkflowTemplate.replace("  contents: read", "  contents: write"),
            },
          ],
        }),
      ).rejects.toMatchObject({ name: "SetupFileConflictError" });
      expect(requests.filter((request) => request.method !== "GET")).toEqual([]);
    });

    it("allows a genuinely new repository with both setup paths absent", async () => {
      const { client } = snapshotClient({});
      await expect(createGitHubMutationService({ client }).execute(validMutationInput)).resolves.toMatchObject({
        outcome: "created",
      });
    });

    it("fails closed if the provider cannot verify existing setup files", async () => {
      const { client, requests } = snapshotClient({}, { lookupStatus: 403 });
      await expect(createGitHubMutationService({ client }).execute(validMutationInput)).rejects.toThrow(
        /unable to verify existing setup file/u,
      );
      expect(requests.filter((request) => request.method !== "GET")).toEqual([]);
    });

    it("fails closed if the default branch changes during initial setup inspection", async () => {
      const { client, requests } = snapshotClient({}, { changedBase: true });
      await expect(createGitHubMutationService({ client }).execute(validMutationInput)).rejects.toThrow(
        /default branch changed during setup file verification/u,
      );
      expect(requests.filter((request) => request.method !== "GET")).toEqual([]);
    });

    it("preserves the explicit update path without applying first-setup-only conflict rules", async () => {
      const { client, requests } = snapshotClient({
        "boardreadyops.yml": "custom existing configuration",
      });
      await expect(
        createGitHubMutationService({ client }).execute({ ...validMutationInput, intent: "setup-update" }),
      ).resolves.toMatchObject({ outcome: "created" });
      expect(requests.some((request) => request.path.includes("/contents/"))).toBe(false);
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
          if (path.includes("/contents/")) {
            return { status: 404, ok: false, data: {} as T };
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
