/**
 * Raised by a hand-written parser (kicad/bom) when raw input exceeds a hostile-input safety
 * limit -- e.g. an oversized design file, an absurd sheet-hierarchy fan-out, or an absurd row
 * count. Lives in util/ (not core/errors.ts) because the bom/kicad layers are not permitted to
 * depend on core (see scripts/verify-structure.mjs).
 */
export class HostileInputError extends Error {
  override readonly name: string = "HostileInputError";
}
