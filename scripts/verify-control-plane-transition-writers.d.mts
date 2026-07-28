export type TransitionWriterSourceFile = {
  readonly path: string;
  readonly content: string;
};

export const protectedFunctionOwners: Readonly<Record<string, string>>;

export function findRuntimeTransitionWriterViolations(files: readonly TransitionWriterSourceFile[]): string[];

export function latestProtectedFunctionDefinitions(
  migrationFiles: readonly TransitionWriterSourceFile[],
): Record<string, string>;

export function findProtectedFunctionOwnershipViolations(
  migrationFiles: readonly TransitionWriterSourceFile[],
): string[];

export function verifyControlPlaneTransitionWriters(
  runtimeFiles: readonly TransitionWriterSourceFile[],
  migrationFiles: readonly TransitionWriterSourceFile[],
): void;
