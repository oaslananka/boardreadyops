/**
 * A producer-reported role is never authority to release a fabrication archive.
 * The only currently supported producer path is draft-manufacturing.
 * An approved manufacturing archive requires a separate server-verified
 * source/runner attestation and a distinct authorization transition.
 */
export function isUnattestedManufacturingArchive(input: { kind: string; role: string }): boolean {
  return input.kind.trim().toLowerCase() === "archive" && input.role.trim().toLowerCase() === "manufacturing";
}
