export function parseKicadMajor(version: string): number | undefined {
  const match = /\b(\d+)\./.exec(version);
  return match ? Number(match[1]) : undefined;
}
