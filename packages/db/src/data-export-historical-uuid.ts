/**
 * Exact lowercase RFC-4122-shaped identifier boundary (UUID version is not
 * intentionally constrained). Fixed 36-byte scan: no regex backtracking or
 * coercion of untrusted values. Never grants ownership by itself.
 */
export function isHistoricalUserUuid(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== 36) return false;
  for (let index = 0; index < 36; index++) {
    const code = value.charCodeAt(index);
    if (index === 8 || index === 13 || index === 18 || index === 23) {
      if (code !== 45) return false;
    } else if (!((code >= 48 && code <= 57) || (code >= 97 && code <= 102))) {
      return false;
    }
  }
  return true;
}
