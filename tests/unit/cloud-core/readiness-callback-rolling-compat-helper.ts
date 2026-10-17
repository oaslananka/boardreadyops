import { readFile } from "node:fs/promises";
import { createContext, Script } from "node:vm";
import { load } from "js-yaml";
import { expect } from "vitest";

type Workflow = {
  jobs: {
    readiness: {
      steps: Array<{ name?: string; with?: { script?: string } }>;
    };
  };
};

type CallbackResponse = {
  status: number;
  body: Record<string, unknown> | null;
};

type CapturedRequest = {
  url: string;
  headers: Record<string, string>;
  payload: Record<string, unknown>;
};

const canonical = await readFile(new URL("../../../.github/workflows/readiness-runner.yml", import.meta.url), "utf8");
const workflow = load(canonical) as Workflow;
const publisher = workflow.jobs.readiness.steps.find((step) => step.name === "Publish OIDC-authenticated cloud result");
const publisherScript = publisher?.with?.script;
if (!publisherScript) throw new Error("Canonical OIDC publisher step is missing");

const report = {
  schemaVersion: 1,
  tool: { name: "boardreadyops", version: "1.24.1" },
  summary: { failed: false, total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 },
  findings: [],
};

function mockResponse({ status, body }: CallbackResponse) {
  return {
    status,
    ok: status >= 200 && status < 300,
    clone: () => mockResponse({ status, body }),
    async json() {
      if (body === null) throw new SyntaxError("Non-JSON response");
      return body;
    },
    async text() {
      return body === null ? "<invalid-response>" : JSON.stringify(body);
    },
  };
}

export async function executePublisher(responses: CallbackResponse[]) {
  const requests: CapturedRequest[] = [];
  const failedMessages: string[] = [];
  let responseIndex = 0;
  const resultUrl = "https://cloud.example/api/v1/runs/github-actions-result?run_id=sample&attempt_id=sample";
  const oidcToken = "test-oidc-token";
  const context = createContext({
    require(name: string) {
      expect(name).toBe("node:fs");
      return { readFileSync: () => JSON.stringify(report) };
    },
    core: {
      async getIDToken(audience: string) {
        expect(audience).toMatch(/^boardreadyops-cloud:/u);
        return oidcToken;
      },
      setFailed(message: string) {
        failedMessages.push(message);
      },
    },
    fetch: async (url: string, options: { headers: Record<string, string>; body: string }) => {
      requests.push({
        url,
        headers: { ...options.headers },
        payload: JSON.parse(options.body) as Record<string, unknown>,
      });
      const selected = responses[Math.min(responseIndex++, responses.length - 1)];
      if (!selected) throw new Error("At least one mock response is required");
      return mockResponse(selected);
    },
    process: {
      env: {
        RUN_ID: "a6e4d1d2-2a20-44d1-81f4-7680ffa583b7",
        EXECUTION_ATTEMPT_ID: "0cc0bf41-8a31-4afa-aac2-ccb7efa7c47d",
        HEAD_SHA: "395ca695c10d7e990dd49315784541dfeac1c943",
        RESULT_URL: resultUrl,
        READINESS_OUTCOME: "success",
        KICAD_VERSION: "10.0.7",
        SAFE_MODE: "true",
        SAFE_MODE_REASONS: "private-repository",
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_REPOSITORY: "oaslananka-dev/boardreadyops-e2e-private",
        GITHUB_RUN_ID: "12345",
      },
    },
    Buffer,
    setTimeout: (callback: () => void) => callback(),
  });
  let failure: unknown;
  try {
    // Execute only the first-party, version-controlled script embedded in the
    // canonical workflow. This is not a sandbox for any external input.
    await new Script(`(async () => {${publisherScript}\n})()`).runInContext(context);
  } catch (error) {
    failure = error;
  }
  return { requests, failure, failedMessages };
}

export function assertSameSignedContext(requests: CapturedRequest[]) {
  const first = requests[0];
  expect(first).toBeDefined();
  if (!first) throw new Error("Expected callback");
  expect(first.payload).toHaveProperty("toolVersions");
  expect(first.headers.authorization).toBe("Bearer test-oidc-token");
  for (const request of requests.slice(1)) {
    expect(request.url).toBe(first.url);
    expect(request.headers).toEqual(first.headers);
    const { toolVersions: _ignoredFirst, ...firstDecision } = first.payload;
    const { toolVersions: _ignoredOther, ...otherDecision } = request.payload;
    expect(otherDecision).toEqual(firstDecision);
  }
}
