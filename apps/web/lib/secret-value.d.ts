export type SecretEnvironment = Readonly<Record<string, string | undefined>>;

export type SecretFileReader = (path: string, encoding: "utf8") => string;

export function configuredSecretValue(input: {
  environment?: SecretEnvironment;
  valueName: string;
  fileName: string;
  readFile?: SecretFileReader;
}): string | undefined;
