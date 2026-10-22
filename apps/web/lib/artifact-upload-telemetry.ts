/**
 * A bounded operator correlation event for a failed metadata acknowledgement.
 * This is an ephemeral structured log, NOT a durable upload audit or quarantine.
 * Only the validated opaque artifact ID is included: never bearer tokens, URL,
 * path, checksum, error string, artifact contents, or tenant identifiers.
 */
const artifactIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

type Write = (line: string) => unknown;

export function emitAmbiguousArtifactUploadTelemetry(
  artifactId: string,
  write: Write = (line) => process.stdout.write(line),
): void {
  if (!artifactIdPattern.test(artifactId)) return;
  try {
    write(
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        component: "runner-artifact-uploads",
        event: "runner_artifact.upload_finalization_ambiguous",
        artifactId,
      })}\n`,
    );
  } catch {
    // A log sink outage must never alter the conservative HTTP 503 result.
  }
}
