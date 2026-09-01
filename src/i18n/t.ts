import { catalogs, type Locale, type MessageKey, type MessageParams } from "./catalog.js";

export type { Locale, MessageKey, MessageParams } from "./catalog.js";

export function resolveLocale(env: NodeJS.ProcessEnv = process.env): Locale {
  return normalizeLocale(env.BOARDREADY_LOCALE) ?? normalizeLocale(env.LANG) ?? "en";
}

export function t(key: MessageKey, params: MessageParams = {}, locale: Locale = resolveLocale()): string {
  const catalog = locale === "__PSEUDO__" ? catalogs.en : catalogs[locale];
  const template = catalog[key];
  const values: MessageParams = { ...params };
  if (template.includes("{findingWord}")) {
    values.findingWord =
      typeof params.count === "number" && params.count === 1
        ? catalog["report.finding.word"]
        : catalog["report.finding.word.plural"];
  }
  const rendered = template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) => {
    const value = values[name];
    return value === undefined ? match : String(value);
  });
  return locale === "__PSEUDO__" ? `[[${rendered}]]` : rendered;
}

function normalizeLocale(value: string | undefined): Locale | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "__PSEUDO__") {
    return "__PSEUDO__";
  }
  const normalized = value.toLowerCase().replaceAll("_", "-");
  if (normalized === "en" || normalized.startsWith("en-")) {
    return "en";
  }
  return undefined;
}
