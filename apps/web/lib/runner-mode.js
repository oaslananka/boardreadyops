const allowedRunnerModes = new Set(["github-actions", "self-hosted", "disabled"]);
const runnerLabelPattern = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,63})$/;
const truthyValues = new Set(["1", "true", "yes"]);
const falseyValues = new Set(["0", "false", "no"]);

function environmentValue(environment, name) {
  const value = environment?.[name];
  return typeof value === "string" ? value.trim() : undefined;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === "") {
    return { valid: true, value: fallback };
  }

  const normalized = value.toLowerCase();
  if (truthyValues.has(normalized)) {
    return { valid: true, value: true };
  }
  if (falseyValues.has(normalized)) {
    return { valid: true, value: false };
  }

  return { valid: false, value: fallback };
}

export function resolveRunnerConfiguration(environment = globalThis.process?.env ?? {}) {
  const configuredMode = environmentValue(environment, "BOARDREADYOPS_RUNNER_MODE") || "github-actions";

  if (!allowedRunnerModes.has(configuredMode)) {
    return {
      mode: "disabled",
      configurationValid: false,
      configurationError: "invalid-runner-mode",
      dispatch: "none",
      selfHostedLabel: "default",
      selfHostedRequiresSafeMode: true,
    };
  }

  if (configuredMode !== "self-hosted") {
    return {
      mode: configuredMode,
      configurationValid: true,
      dispatch: configuredMode === "github-actions" ? "github-actions" : "none",
      selfHostedLabel: "default",
      selfHostedRequiresSafeMode: true,
    };
  }

  const label = environmentValue(environment, "BOARDREADYOPS_SELF_HOSTED_RUNNER_LABEL") || "default";
  if (!runnerLabelPattern.test(label)) {
    return {
      mode: "disabled",
      configurationValid: false,
      configurationError: "invalid-self-hosted-label",
      dispatch: "none",
      selfHostedLabel: "default",
      selfHostedRequiresSafeMode: true,
    };
  }

  const safeMode = parseBoolean(
    environmentValue(environment, "BOARDREADYOPS_SELF_HOSTED_RUNNER_REQUIRE_SAFE_MODE"),
    true,
  );
  if (!safeMode.valid) {
    return {
      mode: "disabled",
      configurationValid: false,
      configurationError: "invalid-safe-mode-flag",
      dispatch: "none",
      selfHostedLabel: label,
      selfHostedRequiresSafeMode: true,
    };
  }

  return {
    mode: "self-hosted",
    configurationValid: true,
    dispatch: "self-hosted-queue",
    selfHostedLabel: label,
    selfHostedRequiresSafeMode: safeMode.value,
  };
}

export function runnerMode(environment) {
  return resolveRunnerConfiguration(environment).mode;
}

export function selfHostedRunnerLabel(environment) {
  return resolveRunnerConfiguration(environment).selfHostedLabel;
}

export function selfHostedRunnerRequiresSafeMode(environment) {
  return resolveRunnerConfiguration(environment).selfHostedRequiresSafeMode;
}

export function runnerModeSummary(environment) {
  return resolveRunnerConfiguration(environment);
}

export function runnerWorkflowDispatchClient(configuration, createClient) {
  return configuration.configurationValid && configuration.mode === "github-actions" ? createClient() : undefined;
}
