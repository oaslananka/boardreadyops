import { describe, expect, it } from "vitest";
import {
  authenticateControlPlaneOperator,
  configuredControlPlaneOperator,
} from "../../../apps/web/lib/control-plane-operator-auth.js";

const token = "operator-token-".padEnd(48, "x");
const environment = {
  BOARDREADYOPS_OPERATOR_API_TOKEN: token,
  BOARDREADYOPS_OPERATOR_ACTOR_ID: "operator.primary",
};

function request(authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
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
