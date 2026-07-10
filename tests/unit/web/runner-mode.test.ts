import { describe, expect, it, vi } from "vitest";
import {
  resolveRunnerConfiguration,
  runnerMode,
  runnerModeSummary,
  runnerWorkflowDispatchClient,
  selfHostedRunnerLabel,
  selfHostedRunnerRequiresSafeMode,
} from "../../../apps/web/lib/runner-mode.js";

describe("runner mode configuration", () => {
  it("keeps GitHub Actions as the explicit compatibility default", () => {
    expect(resolveRunnerConfiguration({})).toEqual({
      mode: "github-actions",
      configurationValid: true,
      dispatch: "github-actions",
      selfHostedLabel: "default",
      selfHostedRequiresSafeMode: true,
    });
    expect(runnerMode({})).toBe("github-actions");
  });

  it("fails closed when the configured mode is unknown", () => {
    expect(resolveRunnerConfiguration({ BOARDREADYOPS_RUNNER_MODE: "auto" })).toEqual({
      mode: "disabled",
      configurationValid: false,
      configurationError: "invalid-runner-mode",
      dispatch: "none",
      selfHostedLabel: "default",
      selfHostedRequiresSafeMode: true,
    });
  });

  it("queues self-hosted work with safe mode enabled by default", () => {
    const environment = {
      BOARDREADYOPS_RUNNER_MODE: " self-hosted ",
      BOARDREADYOPS_SELF_HOSTED_RUNNER_LABEL: "tenant_runner-01",
    };

    expect(runnerModeSummary(environment)).toEqual({
      mode: "self-hosted",
      configurationValid: true,
      dispatch: "self-hosted-queue",
      selfHostedLabel: "tenant_runner-01",
      selfHostedRequiresSafeMode: true,
    });
    expect(selfHostedRunnerLabel(environment)).toBe("tenant_runner-01");
    expect(selfHostedRunnerRequiresSafeMode(environment)).toBe(true);
  });

  it.each(["0", "false", "no"])("allows safe mode to be explicitly disabled with %s", (value) => {
    expect(
      resolveRunnerConfiguration({
        BOARDREADYOPS_RUNNER_MODE: "self-hosted",
        BOARDREADYOPS_SELF_HOSTED_RUNNER_REQUIRE_SAFE_MODE: value,
      }),
    ).toMatchObject({
      mode: "self-hosted",
      configurationValid: true,
      selfHostedRequiresSafeMode: false,
    });
  });

  it.each(["1", "true", "yes"])("accepts an explicit safe mode value of %s", (value) => {
    expect(
      resolveRunnerConfiguration({
        BOARDREADYOPS_RUNNER_MODE: "self-hosted",
        BOARDREADYOPS_SELF_HOSTED_RUNNER_REQUIRE_SAFE_MODE: value,
      }),
    ).toMatchObject({
      mode: "self-hosted",
      configurationValid: true,
      selfHostedRequiresSafeMode: true,
    });
  });

  it("disables self-hosted execution for an unsafe label", () => {
    expect(
      resolveRunnerConfiguration({
        BOARDREADYOPS_RUNNER_MODE: "self-hosted",
        BOARDREADYOPS_SELF_HOSTED_RUNNER_LABEL: "../../tenant runner",
      }),
    ).toEqual({
      mode: "disabled",
      configurationValid: false,
      configurationError: "invalid-self-hosted-label",
      dispatch: "none",
      selfHostedLabel: "default",
      selfHostedRequiresSafeMode: true,
    });
  });

  it("disables self-hosted execution for an invalid safe-mode flag", () => {
    expect(
      resolveRunnerConfiguration({
        BOARDREADYOPS_RUNNER_MODE: "self-hosted",
        BOARDREADYOPS_SELF_HOSTED_RUNNER_LABEL: "tenant-a",
        BOARDREADYOPS_SELF_HOSTED_RUNNER_REQUIRE_SAFE_MODE: "sometimes",
      }),
    ).toEqual({
      mode: "disabled",
      configurationValid: false,
      configurationError: "invalid-safe-mode-flag",
      dispatch: "none",
      selfHostedLabel: "tenant-a",
      selfHostedRequiresSafeMode: true,
    });
  });

  it("ignores self-hosted-only variables outside self-hosted mode", () => {
    expect(
      resolveRunnerConfiguration({
        BOARDREADYOPS_RUNNER_MODE: "github-actions",
        BOARDREADYOPS_SELF_HOSTED_RUNNER_LABEL: "invalid label",
        BOARDREADYOPS_SELF_HOSTED_RUNNER_REQUIRE_SAFE_MODE: "invalid",
      }),
    ).toMatchObject({
      mode: "github-actions",
      configurationValid: true,
      dispatch: "github-actions",
    });
  });

  it("creates a dispatch client only for a valid GitHub Actions configuration", () => {
    const createClient = vi.fn(() => ({ dispatch: true }));

    expect(runnerWorkflowDispatchClient(resolveRunnerConfiguration({}), createClient)).toEqual({ dispatch: true });
    expect(createClient).toHaveBeenCalledOnce();

    createClient.mockClear();
    expect(
      runnerWorkflowDispatchClient(
        resolveRunnerConfiguration({ BOARDREADYOPS_RUNNER_MODE: "self-hosted" }),
        createClient,
      ),
    ).toBeUndefined();
    expect(
      runnerWorkflowDispatchClient(resolveRunnerConfiguration({ BOARDREADYOPS_RUNNER_MODE: "invalid" }), createClient),
    ).toBeUndefined();
    expect(createClient).not.toHaveBeenCalled();
  });
});
