import { afterEach, describe, expect, it } from "vitest";
import {
  authenticateControlPlaneOperator,
  configuredControlPlaneOperator,
} from "../../../apps/web/lib/control-plane-operator-auth.js";
import { resetOperatorRateLimitForTests } from "../../../apps/web/lib/operator-rate-limit.js";

const token = "operator-token-".padEnd(48, "x");
const environment = {
  BOARDREADYOPS_OPERATOR_API_TOKEN: token,
  BOARDREADYOPS_OPERATOR_ACTOR_ID: "operator.primary",
};

afterEach(() => {
  resetOperatorRateLimitForTests();
});

function request(authorization?: string, forwardedFor?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  if (forwardedFor !== undefined) headers.set("x-forwarded-for", forwardedFor);
  return new Request("https://boardreadyops.example/api/v1/operator", { headers });
}

describe("control-plane operator authentication", () => {
  it("disables the operator API unless both validated settings exist", () => {
    expect(configuredControlPlaneOperator({})).toBeUndefined();
    expect(configuredControlPlaneOperator({ BOARDREADYOPS_OPERATOR_API_TOKEN: token })).toBeUndefined();
    expect(
      configuredControlPlaneOperator({
        ...environment,
        BOARDREADYOPS_OPERATOR_API_TOKEN: "too-short",
      }),
    ).toBeUndefined();
    expect(
      configuredControlPlaneOperator({
        ...environment,
        BOARDREADYOPS_OPERATOR_ACTOR_ID: "contains space",
      }),
    ).toBeUndefined();
  });

  it("returns the configured non-secret actor identity", () => {
    expect(configuredControlPlaneOperator(environment)).toEqual({
      token,
      actorId: "operator.primary",
    });
  });

  it("rejects missing, malformed, and incorrect bearer credentials", () => {
    expect(authenticateControlPlaneOperator(request(), environment)).toEqual({ status: "unauthorized" });
    expect(authenticateControlPlaneOperator(request(`Basic ${token}`), environment)).toEqual({
      status: "unauthorized",
    });
    expect(authenticateControlPlaneOperator(request("Bearer wrong-token"), environment)).toEqual({
      status: "unauthorized",
    });
    expect(authenticateControlPlaneOperator(request(`Bearer ${"z".repeat(token.length)}`), environment)).toEqual({
      status: "unauthorized",
    });
    expect(authenticateControlPlaneOperator(request(`Bearer ${token} trailing`), environment)).toEqual({
      status: "unauthorized",
    });
  });

  it("authenticates only the exact configured bearer token", () => {
    expect(authenticateControlPlaneOperator(request(`Bearer ${token}`), environment)).toEqual({
      status: "authenticated",
      actorId: "operator.primary",
    });
  });

  it("fails closed for byte-length mismatches and non-ASCII credentials", () => {
    expect(authenticateControlPlaneOperator(request(`Bearer ${token}x`), environment)).toEqual({
      status: "unauthorized",
    });
    expect(authenticateControlPlaneOperator(request(`Bearer ${"é".repeat(48)}`), environment)).toEqual({
      status: "unauthorized",
    });
  });

  it("reports disabled configuration before examining request credentials", () => {
    expect(authenticateControlPlaneOperator(request(`Bearer ${token}`), {})).toEqual({ status: "disabled" });
  });
});

describe("control-plane operator authentication rate limiting", () => {
  function environmentWithLimit(limit: string) {
    return { ...environment, BOARDREADYOPS_OPERATOR_RATE_LIMIT_PER_MINUTE: limit };
  }

  it("never rate limits repeated requests bearing the valid operator token", () => {
    const limitedEnvironment = environmentWithLimit("2");
    for (let attempt = 0; attempt < 25; attempt += 1) {
      expect(authenticateControlPlaneOperator(request(`Bearer ${token}`, "203.0.113.9"), limitedEnvironment)).toEqual({
        status: "authenticated",
        actorId: "operator.primary",
      });
    }
  });

  it("rate limits repeated invalid operator token attempts and returns 429 before comparing further tokens", () => {
    const limitedEnvironment = environmentWithLimit("3");
    const clientIp = "203.0.113.10";

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(authenticateControlPlaneOperator(request("Bearer wrong-token", clientIp), limitedEnvironment)).toEqual({
        status: "unauthorized",
      });
    }

    const limited = authenticateControlPlaneOperator(request("Bearer wrong-token", clientIp), limitedEnvironment);
    expect(limited.status).toBe("rate_limited");
    if (limited.status === "rate_limited") {
      expect(limited.retryAfterSeconds).toBeGreaterThan(0);
    }

    // Once limited, even the correct token is rejected -- the real comparison never runs.
    expect(authenticateControlPlaneOperator(request(`Bearer ${token}`, clientIp), limitedEnvironment).status).toBe(
      "rate_limited",
    );
  });

  it("tracks the rate limit independently per client", () => {
    const limitedEnvironment = environmentWithLimit("1");
    expect(authenticateControlPlaneOperator(request("Bearer wrong-token", "203.0.113.20"), limitedEnvironment)).toEqual(
      {
        status: "unauthorized",
      },
    );
    expect(
      authenticateControlPlaneOperator(request("Bearer wrong-token", "203.0.113.20"), limitedEnvironment).status,
    ).toBe("rate_limited");
    expect(authenticateControlPlaneOperator(request(`Bearer ${token}`, "203.0.113.21"), limitedEnvironment)).toEqual({
      status: "authenticated",
      actorId: "operator.primary",
    });
  });

  it("uses the injected operator environment for the configured limit", () => {
    const injectedEnvironment = environmentWithLimit("1");
    const clientIp = "203.0.113.30";

    expect(authenticateControlPlaneOperator(request("Bearer wrong-token", clientIp), injectedEnvironment)).toEqual({
      status: "unauthorized",
    });
    expect(authenticateControlPlaneOperator(request("Bearer wrong-token", clientIp), injectedEnvironment).status).toBe(
      "rate_limited",
    );
  });
});
