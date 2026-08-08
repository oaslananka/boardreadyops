export const PUBLIC_RELEASE_PATHS: readonly string[];
export const IMMUTABLE_ACTION_PIN_PATHS: readonly string[];

export function syncReleaseReadme(readme: string, version: string): string;

export function syncPublicReleaseFiles(files: Record<string, string>, version: string): Record<string, string>;

export function verifyPublicReleaseFiles(files: Record<string, string>, version: string): void;

export function main(root?: string, args?: string[]): Promise<void>;
