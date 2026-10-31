/** ASCII digits only; no regular-expression engine processes customer metadata. */
function asciiDigits(value: string, start: number, count: number): boolean {
  for (let index = start; index < start + count; index++) {
    const code = value.charCodeAt(index);
    if (code < 48 || code > 57) return false;
  }
  return true;
}

/** Fixed offsets for YYYY-MM-DDTHH:mm:ss. */
function hasInstantPrefix(value: string): boolean {
  return (
    asciiDigits(value, 0, 4) &&
    value[4] === "-" &&
    asciiDigits(value, 5, 2) &&
    value[7] === "-" &&
    asciiDigits(value, 8, 2) &&
    value[10] === "T" &&
    asciiDigits(value, 11, 2) &&
    value[13] === ":" &&
    asciiDigits(value, 14, 2) &&
    value[16] === ":" &&
    asciiDigits(value, 17, 2)
  );
}

/** A fractional second contains one to six ASCII digits, if present. */
function zoneOffset(value: string): number {
  if (value[19] !== ".") return 19;
  let position = 20;
  while (position < value.length && position < 26) {
    const code = value.charCodeAt(position);
    if (code < 48 || code > 57) break;
    position++;
  }
  return position === 20 ? -1 : position;
}

function hasValidZone(value: string, start: number): boolean {
  const zone = value.slice(start);
  return (
    zone === "Z" ||
    (zone.length === 6 &&
      (zone[0] === "+" || zone[0] === "-") &&
      zone[3] === ":" &&
      asciiDigits(zone, 1, 2) &&
      asciiDigits(zone, 4, 2))
  );
}

/** Strict bounded ISO-8601 instant validation for claimed export metadata. */
export function isValidExportTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 20 || value.length > 32) return false;
  const offset = zoneOffset(value);
  return offset >= 0 && hasInstantPrefix(value) && hasValidZone(value, offset) && Number.isFinite(Date.parse(value));
}
