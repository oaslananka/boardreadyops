import { spawn } from "node:child_process";

const RENOVATE_VALIDATOR_IMAGE =
  "renovate/renovate:44.97.6@sha256:128e8d6d6cb07beccc009a2cfbdbe741e2c620a9f70a2b8fb72614ca33dbe5ac";

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
