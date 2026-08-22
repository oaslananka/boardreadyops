export function requiredEnvironmentValue(environment, name) {
  const value = environment[name];
  if (typeof value !== "string") {
    throw new Error(`${name} is required`);
  }
  const normalized = value.trim();
  if (normalized === "") {
    throw new Error(`${name} is required`);
  }
  return normalized;
}

export function boundedEnvironmentInteger(environment, name, fallback, minimum, maximum) {
  const raw = environment[name];
  if (raw === undefined) return fallback;
  const normalized = raw.trim();
  if (!/^\d+$/u.test(normalized)) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  const value = Number(normalized);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

export function isBareHttpsOrigin(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}
