import { spawn } from "node:child_process";

const RENOVATE_VALIDATOR_IMAGE =
  "renovate/renovate:44.97.2@sha256:b9b32d70f395ec78b9c2a29633079ce4d249049e51018ad3f086417dadf96b86";

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

const child = spawn("/usr/bin/docker", args, {
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
