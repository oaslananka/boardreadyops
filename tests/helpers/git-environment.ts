export function gitConfigNullDevice(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "NUL" : "/dev/null";
}

export function isolatedGitEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const environment = { ...process.env, ...overrides };
  for (const name of Object.keys(environment)) {
    if (name.startsWith("GIT_")) delete environment[name];
  }
  const nullDevice = gitConfigNullDevice();
  environment.XDG_CONFIG_HOME = nullDevice;
  environment.GIT_CONFIG_GLOBAL = nullDevice;
  environment.GIT_CONFIG_SYSTEM = nullDevice;
  environment.GIT_CONFIG_NOSYSTEM = "1";
  return environment;
}
