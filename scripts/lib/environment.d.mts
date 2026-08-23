export function requiredEnvironmentValue(environment: Readonly<Record<string, unknown>>, name: string): string;

export function boundedEnvironmentInteger(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number;

export function isBareHttpsOrigin(value: string): boolean;
