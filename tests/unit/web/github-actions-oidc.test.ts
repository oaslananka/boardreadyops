import { generateKeyPairSync, sign } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetGitHubActionsOidcJwksCache,
  verifyGitHubActionsOidcToken,
} from "../../../apps/web/lib/github-actions-oidc.js";

const runId = "5dc4193b-5c7e-4df8-b86f-e4d3266fc22d";
const executionAttemptId = "7559e99b-4998-4e02-a94a-7a7a4686ae11";
const repository = "oaslananka/boardreadyops";
const workflowRef = `${repository}/.github/workflows/readiness-runner.yml@refs/heads/main`;
const nowMs = Date.UTC(2026, 6, 10, 20, 30, 0);
const nowSeconds = Math.floor(nowMs / 1000);
const keyId = "github-test-key";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = {
  ...publicKey.export({ format: "jwk" }),
  alg: "RS256",
  kid: keyId,
  use: "sig",
};

function token(
  payloadOverrides: Readonly<Record<string, unknown>> = {},
  headerOverrides: Readonly<Record<string, unknown>> = {},
): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: keyId, typ: "JWT", ...headerOverrides })).toString(
    "base64url",
  );
  const payload = Buffer.from(
    JSON.stringify({
      iss: "https://token.actions.githubusercontent.com",
      aud: `boardreadyops-cloud:${runId}:${executionAttemptId}`,
      sub: `repo:${repository}:ref:refs/heads/main`,
      repository,
      workflow_ref: workflowRef,
      ref: "refs/heads/main",
      event_name: "workflow_dispatch",
      runner_environment: "github-hosted",
      run_id: "29121986402",
      iat: nowSeconds - 10,
      nbf: nowSeconds - 10,
      exp: nowSeconds + 300,
      ...payloadOverrides,
    }),
  ).toString("base64url");
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

function jwksFetch(keys: readonly Record<string, unknown>[] = [publicJwk]) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify({ keys }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
}

beforeEach(() => {
  resetGitHubActionsOidcJwksCache();
});

describe("GitHub Actions OIDC verification", () => {
  it("accepts a signed token bound to the repository, workflow, ref, event, and release run and execution attempt", async () => {
    const fetchImpl = jwksFetch();

    await expect(
      verifyGitHubActionsOidcToken(token(), {
        runId,
        executionAttemptId,
        fetchImpl,
        now: () => nowMs,
      }),
    ).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://token.actions.githubusercontent.com/.well-known/jwks",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("accepts the legacy run-only audience during the rolling upgrade", async () => {
    const fetchImpl = jwksFetch();

    await expect(
      verifyGitHubActionsOidcToken(token({ aud: `boardreadyops-cloud:${runId}` }), {
        runId,
        fetchImpl,
        now: () => nowMs,
      }),
    ).resolves.toBe(true);
  });

  it.each([
    ["audience", { aud: "boardreadyops-cloud:another-run" }],
    ["issuer", { iss: "https://attacker.example" }],
    ["repository", { repository: "attacker/example" }],
    ["workflow", { workflow_ref: `${repository}/.github/workflows/other.yml@refs/heads/main` }],
    ["ref", { ref: "refs/heads/feature" }],
    ["event", { event_name: "pull_request" }],
    ["runner", { runner_environment: "self-hosted" }],
  ])("rejects a token with the wrong %s claim", async (_label, payloadOverrides) => {
    const fetchImpl = jwksFetch();

    await expect(
      verifyGitHubActionsOidcToken(token(payloadOverrides), {
        runId,
        executionAttemptId,
        fetchImpl,
        now: () => nowMs,
      }),
    ).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects expired, future, and excessively long-lived tokens", async () => {
    const fetchImpl = jwksFetch();

    for (const payloadOverrides of [
      { exp: nowSeconds - 31 },
      { iat: nowSeconds + 31, nbf: nowSeconds + 31 },
      { iat: nowSeconds - 1, nbf: nowSeconds - 1, exp: nowSeconds + 901 },
    ]) {
      await expect(
        verifyGitHubActionsOidcToken(token(payloadOverrides), {
          runId,
          executionAttemptId,
          fetchImpl,
          now: () => nowMs,
        }),
      ).resolves.toBe(false);
    }

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects unsupported algorithms and ambiguous or missing signing keys", async () => {
    await expect(
      verifyGitHubActionsOidcToken(token({}, { alg: "HS256" }), {
        runId,
        executionAttemptId,
        fetchImpl: jwksFetch(),
        now: () => nowMs,
      }),
    ).resolves.toBe(false);

    await expect(
      verifyGitHubActionsOidcToken(token(), {
        runId,
        executionAttemptId,
        fetchImpl: jwksFetch([publicJwk, publicJwk]),
        now: () => nowMs,
      }),
    ).resolves.toBe(false);
  });

  it("fails closed when GitHub JWKS cannot be retrieved", async () => {
    const fetchImpl = vi.fn(async () => new Response("unavailable", { status: 503 }));

    await expect(
      verifyGitHubActionsOidcToken(token(), {
        runId,
        executionAttemptId,
        fetchImpl,
        now: () => nowMs,
      }),
    ).resolves.toBe(false);
  });
});
