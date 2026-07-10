import { readFileSync } from "node:fs";

export function configuredSecretValue({ environment = process.env, valueName, fileName, readFile = readFileSync }) {
  const configuredFile = environment[fileName]?.trim();

  if (configuredFile) {
    try {
      const value = readFile(configuredFile, "utf8").trim();
      return value || undefined;
    } catch {
      return undefined;
    }
  }

  const value = environment[valueName]?.trim();
  return value || undefined;
}
