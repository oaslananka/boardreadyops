import os from "node:os";

export function isolatedGitEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const environment = { ...process.env, ...overrides };
  for (const name of Object.keys(environment)) {
    if (name.startsWith("GIT_")) delete environment[name];
  }
  environment.GIT_CONFIG_GLOBAL = os.devNull;
  environment.GIT_CONFIG_SYSTEM = os.devNull;
  environment.GIT_CONFIG_NOSYSTEM = "1";
  return environment;
}
