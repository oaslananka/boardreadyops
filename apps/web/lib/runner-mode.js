const allowedRunnerModes = new Set(["github-actions", "self-hosted", "disabled"]);

function envValue(name) {
  return globalThis.process?.env?.[name];
}

export function runnerMode() {
  const configured = envValue("BOARDREADYOPS_RUNNER_MODE") ?? "github-actions";
  return allowedRunnerModes.has(configured) ? configured : "github-actions";
}

export function selfHostedRunnerLabel() {
  return envValue("BOARDREADYOPS_SELF_HOSTED_RUNNER_LABEL") ?? "default";
}

export function selfHostedRunnerRequiresSafeMode() {
  return envValue("BOARDREADYOPS_SELF_HOSTED_RUNNER_REQUIRE_SAFE_MODE") === "1";
}

export function runnerModeSummary() {
  return {
    mode: runnerMode(),
    selfHostedLabel: selfHostedRunnerLabel(),
    selfHostedRequiresSafeMode: selfHostedRunnerRequiresSafeMode(),
  };
}
