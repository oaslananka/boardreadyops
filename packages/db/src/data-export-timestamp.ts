/**
 * Strict, bounded ISO-8601 instant validation for claimed export metadata.
 * Character checks avoid an untrusted-text regular-expression engine.
 * Dates remain required to parse as real instants.
 */
export function isValidExportTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 20 || value.length > 32) return false;

  const digits = (start: number, count: number): boolean => {
    for (let index = start; index < start + count; index++) {
      const character = value.charCodeAt(index);
      if (character < 48 || character > 57) return false;
    }
    return true;
  };
  if (
    !digits(0, 4) ||
    value[4] !== "-" ||
    !digits(5, 2) ||
    value[7] !== "-" ||
    !digits(8, 2) ||
    value[10] !== "T" ||
    !digits(11, 2) ||
    value[13] !== ":" ||
    !digits(14, 2) ||
    value[16] !== ":" ||
    !digits(17, 2)
  )
    return false;

  let zoneStart = 19;
  if (value[zoneStart] === ".") {
    const fractionStart = ++zoneStart;
    while (zoneStart < value.length && zoneStart - fractionStart < 6) {
      const code = value.charCodeAt(zoneStart);
      if (code < 48 || code > 57) break;
      zoneStart++;
    }
    if (zoneStart === fractionStart) return false;
  }

  const suffix = value.slice(zoneStart);
  const validZone =
    suffix === "Z" ||
    (suffix.length === 6 &&
      (suffix[0] === "+" || suffix[0] === "-") &&
      suffix[3] === ":" &&
      digits(zoneStart + 1, 2) &&
      digits(zoneStart + 4, 2));
  return validZone && Number.isFinite(Date.parse(value));
}
