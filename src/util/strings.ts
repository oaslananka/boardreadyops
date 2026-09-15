/**
 * Serialises a value with object keys in a fixed order, for hashing.
 *
 * The key order must not depend on the machine, because this feeds `fingerprintFor` and a
 * finding's fingerprint is what baselines and waivers match on. It used to sort with
 * `localeCompare`, and the real rule detail keys do reorder: under `lt-LT`
 * `missingCategory` sorts before `missingCategories`, and under `az-AZ` `fix` sorts before
 * `filename`. A waiver keyed by fingerprint would silently stop matching on such a machine.
 *
 * `compareCodePoints` reproduces the en-US order exactly for those keys, so this change
 * preserves every fingerprint computed on a common locale or in CI while correcting the ones
 * that were already diverging. See #795.
 */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => compareCodePoints(a, b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function redactControlCharacters(value: string): string {
  return [...value]
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
    })
    .join("");
}

export function splitRefs(value: string): string[] {
  return value
    .split(/[,\s]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Orders strings by code point, independent of the machine's locale.
 *
 * `localeCompare` without an explicit locale uses the runtime default, and the orders genuinely
 * differ. Measured with ordinary ESP-IDF component names:
 *
 *   en-US, de-DE, sv-SE   esp_timer  i2c_bus  idf  ILI9341  ipsum  IPSUM  Izmir
 *   tr-TR                 esp_timer  ILI9341  IPSUM  Izmir  i2c_bus  idf  ipsum
 *
 * Turkish collation orders the dotted and dotless I differently, so a bill of materials generated
 * on a tr-TR machine lists its components in a different order from one generated in CI. Same
 * board, same commit, a different document -- which makes every diff noise and any hash over the
 * output unstable.
 *
 * Use this wherever the order reaches an artefact a machine compares. See #795.
 */
export function compareCodePoints(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
