export const requiredAgentFiles: readonly string[];

export const requiredAgentMarkers: Readonly<Record<string, readonly string[]>>;

export function verifyAgentInstructions(repositoryRoot?: string): Promise<{ files: number }>;
