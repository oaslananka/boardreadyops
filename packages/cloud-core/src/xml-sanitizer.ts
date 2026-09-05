export type XmlSanitizerErrorCode =
  | "XXE_DETECTED"
  | "ENTITY_EXPANSION_DETECTED"
  | "DTD_NOT_ALLOWED"
  | "UNSAFE_SVG_CONTENT";

export class XmlSanitizerError extends Error {
  readonly code: XmlSanitizerErrorCode;

  constructor(code: XmlSanitizerErrorCode, message: string) {
    super(message);
    this.name = "XmlSanitizerError";
    this.code = code;
  }
}

/**
 * True if any `<!ENTITY ...>` declaration's body references another entity (`&name;`).
 * Scans one declaration at a time (bounded by its own `>`) rather than matching the whole
 * document with a single regex, so an unterminated/adversarial declaration only costs a scan
 * of its own length instead of backtracking across the rest of the document.
 */
function hasInternalEntityReference(xml: string): boolean {
  const upper = xml.toUpperCase();
  let i = 0;
  while (i < xml.length) {
    const start = upper.indexOf("<!ENTITY", i);
    if (start === -1) return false;
    const end = xml.indexOf(">", start);
    const declaration = xml.slice(start, end === -1 ? xml.length : end);
    if (/&[\w.-]+;/.test(declaration)) return true;
    i = end === -1 ? xml.length : end + 1;
  }
  return false;
}

/**
 * Validates XML payloads (such as IPC-2581 CAD files) against XXE (XML External Entity)
 * injection and Billion Laughs / quadratic entity expansion attacks.
 */
export function assertSafeXml(xmlContent: string): void {
  const upper = xmlContent.toUpperCase();

  // Check for external entity injection (XXE)
  if (upper.includes("SYSTEM") || upper.includes("PUBLIC")) {
    if (upper.includes("<!DOCTYPE") || upper.includes("<!ENTITY")) {
      throw new XmlSanitizerError("XXE_DETECTED", "XML contains external DTD or entity reference (XXE vulnerability)");
    }
  }

  // Check for recursive entity expansion (Billion Laughs)
  if (upper.includes("<!ENTITY")) {
    const entityCount = (upper.match(/<!ENTITY/g) || []).length;

    if (entityCount > 2 || hasInternalEntityReference(xmlContent)) {
      throw new XmlSanitizerError(
        "ENTITY_EXPANSION_DETECTED",
        "XML contains nested or recursive entity definitions (Billion Laughs / expansion attack)",
      );
    }
  }
}

/**
 * Removes every case-insensitive `<!DOCTYPE ... >` span in one linear pass, tracking
 * `[`/`]` depth so an internal subset's own `>` characters (e.g. inside a nested
 * `<!ENTITY ...>`) don't end the scan early. A regex equivalent needs two unbounded
 * runs either side of the optional internal-subset group, which is exactly the shape
 * that made the previous version polynomial on attacker-sized input.
 */
function stripDoctype(xml: string): string {
  const upper = xml.toUpperCase();
  let result = "";
  let i = 0;
  while (i < xml.length) {
    const start = upper.indexOf("<!DOCTYPE", i);
    if (start === -1) {
      result += xml.slice(i);
      break;
    }
    result += xml.slice(i, start);
    let depth = 0;
    let end = -1;
    for (let j = start; j < xml.length; j += 1) {
      const ch = xml[j];
      if (ch === "[") depth += 1;
      else if (ch === "]") depth = Math.max(0, depth - 1);
      else if (ch === ">" && depth === 0) {
        end = j;
        break;
      }
    }
    i = end === -1 ? xml.length : end + 1;
  }
  return result;
}

/** Removes every case-insensitive `<!ENTITY ... >` span in one linear pass. */
function stripEntityDeclarations(xml: string): string {
  const upper = xml.toUpperCase();
  let result = "";
  let i = 0;
  while (i < xml.length) {
    const start = upper.indexOf("<!ENTITY", i);
    if (start === -1) {
      result += xml.slice(i);
      break;
    }
    result += xml.slice(i, start);
    const end = xml.indexOf(">", start);
    i = end === -1 ? xml.length : end + 1;
  }
  return result;
}

/**
 * Strips DOCTYPE and entity declarations from XML while keeping element content intact.
 */
export function sanitizeXml(xmlContent: string): string {
  return stripEntityDeclarations(stripDoctype(xmlContent)).trim();
}

/**
 * Removes every span between a literal open and close marker (matched case-insensitively),
 * left-to-right, in one linear pass. An unterminated span consumes the remainder of the
 * string. This is the same mechanism `stripDoctype`/`stripEntityDeclarations` use, generalized
 * for markers that don't need bracket-depth tracking (HTML comments).
 */
function stripSpans(input: string, openMarker: string, closeMarker: string): string {
  const upper = input.toUpperCase();
  const openUpper = openMarker.toUpperCase();
  const closeUpper = closeMarker.toUpperCase();
  let result = "";
  let i = 0;
  while (i < input.length) {
    const start = upper.indexOf(openUpper, i);
    if (start === -1) {
      result += input.slice(i);
      break;
    }
    result += input.slice(i, start);
    const end = upper.indexOf(closeUpper, start + openUpper.length);
    i = end === -1 ? input.length : end + closeUpper.length;
  }
  return result;
}

/**
 * Removes every `<tagName ...>...</tagName>` and self-closing `<tagName ... />` element,
 * matched case-insensitively, in one linear pass. Tolerates whitespace before the closing
 * `>` (e.g. `</script >`), which a naive `</script>`-only regex would miss.
 */
function stripElement(input: string, tagName: string): string {
  const upper = input.toUpperCase();
  const openMarker = `<${tagName.toUpperCase()}`;
  const closeMarker = `</${tagName.toUpperCase()}`;
  let result = "";
  let i = 0;
  while (i < input.length) {
    const start = upper.indexOf(openMarker, i);
    if (start === -1) {
      result += input.slice(i);
      break;
    }
    // Require a tag boundary right after the name, so e.g. stripping "script" doesn't
    // also match a hypothetical "<scriptx" element.
    const boundary = upper[start + openMarker.length];
    if (boundary !== undefined && !/[\s/>]/.test(boundary)) {
      result += input.slice(i, start + openMarker.length);
      i = start + openMarker.length;
      continue;
    }
    result += input.slice(i, start);
    const tagEnd = upper.indexOf(">", start);
    if (tagEnd === -1) {
      break;
    }
    if (input[tagEnd - 1] === "/") {
      i = tagEnd + 1;
      continue;
    }
    const closeStart = upper.indexOf(closeMarker, tagEnd);
    if (closeStart === -1) {
      break;
    }
    const closeEnd = upper.indexOf(">", closeStart);
    i = closeEnd === -1 ? input.length : closeEnd + 1;
  }
  return result;
}

/**
 * Runs `stripFn` against the inside of each `<...>` tag individually, rather than the whole
 * document in one regex pass. A crafted multi-megabyte document with many "on...=" near-misses
 * spread across it is what makes a whole-document regex scan super-linear; a single real tag's
 * attribute list is never more than a few hundred bytes, so the same regex applied per-tag has
 * no adversarially-large haystack to backtrack across.
 */
function stripWithinTags(input: string, stripFn: (tagContent: string) => string): string {
  let result = "";
  let i = 0;
  while (i < input.length) {
    const start = input.indexOf("<", i);
    if (start === -1) {
      result += input.slice(i);
      break;
    }
    const end = input.indexOf(">", start);
    if (end === -1) {
      result += input.slice(i);
      break;
    }
    result += input.slice(i, start);
    result += stripFn(input.slice(start, end + 1));
    i = end + 1;
  }
  return result;
}

function isEventHandlerAttributeName(name: string): boolean {
  return name.length > 2 && name.toLowerCase().startsWith("on");
}

function isDangerousHrefAttribute(name: string, value: string): boolean {
  const lowerName = name.toLowerCase();
  if (lowerName !== "href" && lowerName !== "xlink:href") return false;
  const lowerValue = value.trimStart().toLowerCase();
  return (
    lowerValue.startsWith("javascript:") ||
    lowerValue.startsWith("vbscript:") ||
    lowerValue.startsWith("data:")
  );
}

const ATTRIBUTE_NAME_CHARS = new Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:_-".split(""));
const WHITESPACE_CHARS = new Set([" ", "\t", "\n", "\r", "\f", "\v"]);

function parseAttributeValue(tagContent: string, start: number): { value: string; end: number } {
  const quote = tagContent[start];
  if (quote === '"' || quote === "'") {
    const closing = tagContent.indexOf(quote, start + 1);
    const end = closing === -1 ? tagContent.length : closing + 1;
    return { value: tagContent.slice(start + 1, closing === -1 ? tagContent.length : closing), end };
  }

  let end = start;
  while (end < tagContent.length) {
    const ch = tagContent[end];
    if (ch === undefined || ch === ">" || WHITESPACE_CHARS.has(ch)) break;
    end += 1;
  }
  return { value: tagContent.slice(start, end), end };
}

interface ParsedAttribute {
  name: string;
  value: string;
  end: number;
}

/** Parses one `name="value"` (or unquoted) attribute starting right after `whitespaceIndex`. */
function parseAttributeAt(tagContent: string, whitespaceIndex: number): ParsedAttribute | null {
  const nameStart = whitespaceIndex + 1;
  let nameEnd = nameStart;
  while (nameEnd < tagContent.length && ATTRIBUTE_NAME_CHARS.has(tagContent[nameEnd] ?? "")) nameEnd += 1;
  if (nameEnd === nameStart || tagContent[nameEnd] !== "=") return null;

  const { value, end } = parseAttributeValue(tagContent, nameEnd + 1);
  return { name: tagContent.slice(nameStart, nameEnd), value, end };
}

/**
 * Removes every attribute in a single tag's markup for which `isDangerous` returns true.
 * Scans character-by-character instead of matching name+value with a regex -- the same
 * reasoning as stripElement/stripSpans above: no unbounded-quantifier regex here for a static
 * analyzer to flag as super-linear, and an unterminated/adversarial value is naturally bounded
 * to one linear scan of the tag's own length rather than needing lookahead or backtracking.
 */
function stripAttributesWhere(tagContent: string, isDangerous: (name: string, value: string) => boolean): string {
  let result = "";
  let i = 0;
  while (i < tagContent.length) {
    const ch = tagContent[i];
    if (ch === undefined || !WHITESPACE_CHARS.has(ch)) {
      result += ch ?? "";
      i += 1;
      continue;
    }

    const attribute = parseAttributeAt(tagContent, i);
    if (!attribute) {
      result += ch;
      i += 1;
      continue;
    }

    if (isDangerous(attribute.name, attribute.value)) {
      i = attribute.end;
      continue;
    }

    result += tagContent.slice(i, attribute.end);
    i = attribute.end;
  }
  return result;
}

function stripUnsafeAttributes(tagContent: string): string {
  return stripAttributesWhere(
    tagContent,
    (name, value) => isEventHandlerAttributeName(name) || isDangerousHrefAttribute(name, value),
  );
}

/**
 * A single pass can leave a new dangerous tag behind when its own removal splices two
 * fragments back together (classic example: "<scr" + "<script>" + "ipt>" -- removing the
 * middle "<script>...</script>" span leaves "<scr" + "ipt>", which reads back as
 * "<script>"). Re-running the pass until the string stops changing closes that gap; the
 * pass count is capped so a pathological input can't turn this into unbounded work.
 */
function applyUntilStable(input: string, pass: (value: string) => string, maxPasses = 10): string {
  let current = input;
  for (let i = 0; i < maxPasses; i += 1) {
    const next = pass(current);
    if (next === current) return next;
    current = next;
  }
  return current;
}

/**
 * Sanitizes SVG markup for board rendering, gerber visualizers, and layer previews.
 * Strips <script>, <foreignObject>, inline event handlers (onload, onerror, etc.),
 * and javascript: URLs.
 */
export function sanitizeSvg(svgContent: string): string {
  let cleaned = svgContent;
  cleaned = applyUntilStable(cleaned, (s) => stripSpans(s, "<!--", "-->"));
  cleaned = applyUntilStable(cleaned, (s) => stripElement(s, "script"));
  cleaned = applyUntilStable(cleaned, (s) => stripElement(s, "foreignObject"));
  cleaned = applyUntilStable(cleaned, (s) => stripWithinTags(s, stripUnsafeAttributes));
  return cleaned.trim();
}

function hasUnsafeAttribute(svgContent: string): boolean {
  let found = false;
  stripWithinTags(svgContent, (tagContent) => {
    stripAttributesWhere(tagContent, (name, value) => {
      if (isEventHandlerAttributeName(name) || isDangerousHrefAttribute(name, value)) found = true;
      return false;
    });
    return tagContent;
  });
  return found;
}

/**
 * Asserts that an SVG string does not contain executable or dangerous tags/attributes.
 */
export function assertSafeSvg(svgContent: string): void {
  const upper = svgContent.toUpperCase();

  if (upper.includes("<SCRIPT") || upper.includes("<FOREIGNOBJECT")) {
    throw new XmlSanitizerError(
      "UNSAFE_SVG_CONTENT",
      "SVG contains disallowed executable elements (<script> or <foreignObject>)",
    );
  }

  if (hasUnsafeAttribute(svgContent)) {
    throw new XmlSanitizerError(
      "UNSAFE_SVG_CONTENT",
      "SVG contains an inline event handler or a dangerous URI scheme in a link attribute",
    );
  }
}
