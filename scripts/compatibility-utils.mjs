/**
 * Validation and JSON helpers for the compatibility matrix toolchain.
 *
 * Extracted from compatibility.mjs to keep core compatibility logic focused
 * on matrix rendering and drift detection rather than input validation.
 */

export function objectValue(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected ${name} to be an object`);
  }
  return value;
}

export function stringValue(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected ${name} to be a non-empty string`);
  }
  return value;
}

export function stringArray(value, name) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    throw new Error(`Expected ${name} to be an array of non-empty strings`);
  }
  return value;
}

export function stringRecord(value, name) {
  const record = objectValue(value, name);
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry !== "string") {
      throw new Error(`Expected ${name}.${key} to be a string`);
    }
  }
  return record;
}

export async function readJson(url, fetchImpl) {
  if (!fetchImpl) {
    throw new Error("fetch is not available in this Node.js runtime");
  }
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Failed to read ${url}: HTTP ${response.status}`);
  }
  return response.json();
}

export function hasFlag(args, flag) {
  return args.includes(flag);
}

export function optionValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 && index < args.length - 1 ? args[index + 1] : undefined;
}

export function parseSeries(value) {
  const match = /^(\d+)\.(\d+)$/.exec(String(value));
  if (!match) {
    throw new Error(`Expected major.minor series, got ${value}`);
  }
  return { major: Number(match[1]), minor: Number(match[2]), patch: 0, normalized: `${match[1]}.${match[2]}.0` };
}

export function compareSeries(left, right) {
  return left.major - right.major || left.minor - right.minor;
}

export function compareVersion(left, right) {
  return compareSeries(left, right) || left.patch - right.patch;
}
