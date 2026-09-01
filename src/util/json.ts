export function parseJsonValue(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Serialize a JavaScript value to canonical JSON conforming to RFC 8785 (JSON Canonicalization Scheme).
 * Object keys are sorted strictly by UTF-16 code unit values.
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        return "null";
      }
      return Object.is(value, -0) ? "0" : String(value);
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const elements = value.map((element) => {
      if (element === undefined || typeof element === "function" || typeof element === "symbol") {
        return "null";
      }
      return canonicalizeJson(element);
    });
    return `[${elements.join(",")}]`;
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => {
      const v = obj[k];
      return v !== undefined && typeof v !== "function" && typeof v !== "symbol";
    })
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const entries = keys.map((key) => {
    const formattedKey = JSON.stringify(key);
    const formattedVal = canonicalizeJson(obj[key]);
    return `${formattedKey}:${formattedVal}`;
  });

  return `{${entries.join(",")}}`;
}

/**
 * Return a UTF-8 Buffer of the canonicalized JSON value.
 */
export function canonicalizeJsonBuffer(value: unknown): Buffer {
  return Buffer.from(canonicalizeJson(value), "utf8");
}
