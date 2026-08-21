import { spawn } from "node:child_process";

const RENOVATE_VALIDATOR_IMAGE =
  "renovate/renovate@sha256:62a5af4b26c18336b0ff5bc69f2e956337b6696e493b0de57a0d71c9d637da20";

const args = [
  "run",
  "--rm",
  "--network=none",
  "--mount",
  `type=bind,src=${process.cwd()},dst=/workspace,readonly`,
  "--workdir",
  "/workspace",
  "--entrypoint",
  "renovate-config-validator",
  RENOVATE_VALIDATOR_IMAGE,
  "renovate.json",
];

const child = spawn("docker", args, {
  stdio: "inherit",
  windowsHide: true,
});

child.once("error", (error) => {
  process.stderr.write(`Renovate configuration validation failed to start: ${error.message}\n`);
  process.exitCode = 1;
});

child.once("exit", (code, signal) => {
  if (signal) {
    process.stderr.write(`Renovate configuration validation terminated by ${signal}\n`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
