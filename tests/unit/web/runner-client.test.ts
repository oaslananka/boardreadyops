import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createRunnerClient, runnerDispatchInputs, safeModeInputs } from "../../../apps/web/lib/runner-client.js";
import type { EnqueueReleaseRunInput } from "../../../packages/cloud-core/src/lifecycle-executor.js";

const action: EnqueueReleaseRunInput = {
  type: "release_run.enqueue",
  installation: { id: 12345 },
  repository: {
    id: 98765,
    owner: "octo-org",
    name: "hardware-board",
    fullName: "octo-org/hardware-board",
    private: true,
  },
  pullRequestNumber: 42,
  ref: "feature/ready",
  commitSha: "0123456789abcdef",
  triggerKind: "pr",
};

describe("runner workflow dispatch binding", () => {
  it("binds workflow inputs and callback URL to the execution attempt", () => {
    const previousPublicUrl = process.env.BOARDREADYOPS_PUBLIC_URL;
    process.env.BOARDREADYOPS_PUBLIC_URL = "https://boardreadyops.test/";

    try {
      expect(
        runnerDispatchInputs({
          action,
          runId: "5dc4193b-5c7e-4df8-b86f-e4d3266fc22d",
          idempotencyKey: "98765:42:0123456789abcdef",
          githubCheckRunId: 555,
          executionAttemptId: "7559e99b-4998-4e02-a94a-7a7a4686ae11",
        }),
      ).toEqual({
        run_id: "5dc4193b-5c7e-4df8-b86f-e4d3266fc22d",
        execution_attempt_id: "7559e99b-4998-4e02-a94a-7a7a4686ae11",
        target: "octo-org/hardware-board",
        head_sha: "0123456789abcdef",
        result_url:
          "https://boardreadyops.test/api/v1/runs/result?run_id=5dc4193b-5c7e-4df8-b86f-e4d3266fc22d&attempt_id=7559e99b-4998-4e02-a94a-7a7a4686ae11",
        safe_mode: "false",
        safe_mode_reasons: "",
      });
    } finally {
      if (previousPublicUrl === undefined) {
        delete process.env.BOARDREADYOPS_PUBLIC_URL;
      } else {
        process.env.BOARDREADYOPS_PUBLIC_URL = previousPublicUrl;
      }
    }
  });
});

describe("runner workflow safe-mode inputs", () => {
  it("uses an explicit false value when safe mode is absent", () => {
    expect(safeModeInputs(action)).toEqual({
      safe_mode: "false",
      safe_mode_reasons: "",
    });
  });

  it("deduplicates and orders known safe-mode reasons", () => {
    expect(
      safeModeInputs({
        ...action,
        safeMode: {
          enabled: true,
          reasons: ["private-repository", "draft-pull-request", "private-repository", "fork-pull-request"],
        },
      }),
    ).toEqual({
      safe_mode: "true",
      safe_mode_reasons: "draft-pull-request,fork-pull-request,private-repository",
    });
  });

  it("rejects unknown safe-mode reasons", () => {
    expect(() =>
      safeModeInputs({
        ...action,
        safeMode: {
          enabled: true,
          reasons: ["private-repository", "unknown-reason" as never],
        },
      }),
    ).toThrow("unsupported runner safe-mode reason");
  });

  it("rejects enabled safe mode without a reason", () => {
    expect(() =>
      safeModeInputs({
        ...action,
        safeMode: { enabled: true, reasons: [] },
      }),
    ).toThrow("requires at least one reason");
  });

  it("rejects reasons when safe mode is disabled", () => {
    expect(() =>
      safeModeInputs({
        ...action,
        safeMode: { enabled: false, reasons: ["private-repository"] },
      }),
    ).toThrow("require safe mode to be enabled");
  });
});

describe("runner workflow dispatch client", () => {
  it("authenticates the GitHub App and dispatches the bound workflow before marking the check running", async () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const environment = {
      GITHUB_APP_ID: process.env.GITHUB_APP_ID,
      GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY,
      GITHUB_API_BASE_URL: process.env.GITHUB_API_BASE_URL,
      BOARDREADYOPS_DISPATCH_REPOSITORY: process.env.BOARDREADYOPS_DISPATCH_REPOSITORY,
      BOARDREADYOPS_DISPATCH_WORKFLOW: process.env.BOARDREADYOPS_DISPATCH_WORKFLOW,
      BOARDREADYOPS_DISPATCH_REF: process.env.BOARDREADYOPS_DISPATCH_REF,
      BOARDREADYOPS_PUBLIC_URL: process.env.BOARDREADYOPS_PUBLIC_URL,
    };
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; method: string; headers: Headers; body?: string }> = [];

    process.env.GITHUB_APP_ID = "123";
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey;
    process.env.GITHUB_API_BASE_URL = "https://github.test";
    process.env.BOARDREADYOPS_DISPATCH_REPOSITORY = "runner-org/runner-repo";
    process.env.BOARDREADYOPS_DISPATCH_WORKFLOW = "readiness-runner.yml";
    process.env.BOARDREADYOPS_DISPATCH_REF = "main";
    process.env.BOARDREADYOPS_PUBLIC_URL = "https://boardreadyops.test";

    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      const body = typeof init?.body === "string" ? init.body : undefined;
      requests.push({ url, method, headers, ...(body === undefined ? {} : { body }) });

      if (url === "https://api.github.com/app/installations/12345/access_tokens") {
        return Response.json(
          {
            token: "installation-token",
            expires_at: "2099-01-01T00:00:00Z",
            permissions: {},
            repository_selection: "all",
          },
          { status: 201, headers: { date: new Date().toUTCString() } },
        );
      }

      if (
        url === "https://github.test/repos/runner-org/runner-repo/actions/workflows/readiness-runner.yml/dispatches"
      ) {
        return new Response(null, { status: 204 });
      }

      if (url === "https://github.test/repos/octo-org/hardware-board/check-runs/555") {
        return new Response("{}", { status: 200 });
      }

      return new Response("not found", { status: 404 });
    };

    try {
      await expect(
        createRunnerClient().dispatchReleaseRunWorkflow({
          action,
          runId: "5dc4193b-5c7e-4df8-b86f-e4d3266fc22d",
          idempotencyKey: "98765:42:0123456789abcdef",
          githubCheckRunId: 555,
          executionAttemptId: "7559e99b-4998-4e02-a94a-7a7a4686ae11",
        }),
      ).resolves.toEqual({
        workflowDispatchId:
          "runner-org/runner-repo/readiness-runner.yml/5dc4193b-5c7e-4df8-b86f-e4d3266fc22d/7559e99b-4998-4e02-a94a-7a7a4686ae11",
      });

      expect(requests).toHaveLength(3);
      expect(requests[0]).toMatchObject({
        url: "https://api.github.com/app/installations/12345/access_tokens",
        method: "POST",
      });
      expect(requests[0]?.headers.get("authorization")).toMatch(/^bearer /u);

      expect(requests[1]).toMatchObject({
        url: "https://github.test/repos/runner-org/runner-repo/actions/workflows/readiness-runner.yml/dispatches",
        method: "POST",
      });
      expect(requests[1]?.headers.get("authorization")).toBe("Bearer installation-token");
      expect(JSON.parse(requests[1]?.body ?? "null")).toEqual({
        ref: "main",
        inputs: {
          run_id: "5dc4193b-5c7e-4df8-b86f-e4d3266fc22d",
          execution_attempt_id: "7559e99b-4998-4e02-a94a-7a7a4686ae11",
          target: "octo-org/hardware-board",
          head_sha: "0123456789abcdef",
          result_url:
            "https://boardreadyops.test/api/v1/runs/result?run_id=5dc4193b-5c7e-4df8-b86f-e4d3266fc22d&attempt_id=7559e99b-4998-4e02-a94a-7a7a4686ae11",
          safe_mode: "false",
          safe_mode_reasons: "",
        },
      });

      expect(requests[2]).toMatchObject({
        url: "https://github.test/repos/octo-org/hardware-board/check-runs/555",
        method: "PATCH",
      });
      expect(requests[2]?.headers.get("authorization")).toBe("Bearer installation-token");
      expect(JSON.parse(requests[2]?.body ?? "null")).toMatchObject({ status: "in_progress" });
    } finally {
      globalThis.fetch = originalFetch;
      for (const [name, value] of Object.entries(environment)) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    }
  });
});
