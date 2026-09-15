import { boundedErrorClass } from "./webhook-intake-telemetry.js";

/**
 * Records why a dashboard action did not go through.
 *
 * `handleRepositoryAction` had two bare `catch {}` blocks and no logger, so a failed action
 * returned "The action could not be queued. Please try again." and discarded the reason. The
 * generic message to the caller is right -- an internal error must not reach a browser -- but
 * throwing the cause away as well made the failure undiagnosable from the deployment. A button
 * that says it failed and cannot say why is the same defect this codebase keeps producing one
 * layer down.
 */
export type RepositoryActionTelemetry = {
  action: string;
  outcome: "accepted" | "duplicate" | "rejected" | "failed";
  errorClass?: string | undefined;
  /**
   * The database's own error code, when the failure came from Postgres.
   *
   * The most diagnostic field available and the least likely to leak anything: `42883` is an
   * undefined function, `42P01` an undefined table, `23505` a unique violation, `28000` a failed
   * authorisation. A class name alone usually says only "error".
   */
  errorCode?: string | undefined;
};

type Write = (line: string) => unknown;

/** Reads a Postgres error code off an unknown thrown value, without assuming its shape. */
export function databaseErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== "string") return undefined;
  // Postgres SQLSTATE is five alphanumerics; anything else is some other library's `code`.
  return /^[0-9A-Za-z]{5}$/u.test(code) ? code : undefined;
}

export function errorClassOf(error: unknown): string {
  return error instanceof Error ? error.name || "Error" : "UnknownError";
}

export function emitRepositoryActionTelemetry(
  telemetry: RepositoryActionTelemetry,
  write: Write = (line) => process.stdout.write(line),
): void {
  const errorClass = boundedErrorClass(telemetry.errorClass);
  const errorCode = boundedErrorClass(telemetry.errorCode);
  write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level: telemetry.outcome === "failed" ? "error" : "info",
      component: "repository-actions",
      event: "repository.action",
      action: boundedErrorClass(telemetry.action) ?? "unknown",
      outcome: telemetry.outcome,
      ...(errorClass ? { errorClass } : {}),
      ...(errorCode ? { errorCode } : {}),
    })}\n`,
  );
}
