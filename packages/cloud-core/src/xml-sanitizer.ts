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
    // A single unbounded run followed by a fixed anchor -- not two unbounded runs
    // sandwiching it -- so this can't backtrack catastrophically the way the
    // original quote-delimited version did.
    const hasInternalEntityRef = /<!ENTITY\s+[\w.-]+[^>]*&[\w.-]+;/i.test(xmlContent);

    if (entityCount > 2 || hasInternalEntityRef) {
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
      i = input.length;
      break;
    }
    if (input[tagEnd - 1] === "/") {
      i = tagEnd + 1;
      continue;
    }
    const closeStart = upper.indexOf(closeMarker, tagEnd);
    if (closeStart === -1) {
      i = input.length;
      break;
    }
    const closeEnd = upper.indexOf(">", closeStart);
    i = closeEnd === -1 ? input.length : closeEnd + 1;
  }
  return result;
}

/**
 * Removes every `on*` event-handler attribute (onload, onerror, onclick, ...).
 */
function stripEventHandlerAttributes(input: string): string {
  return input.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

/**
 * Removes `href`/`xlink:href` attributes whose value uses a dangerous URI scheme
 * (javascript:, vbscript:, data:text/html). A single backreference for the quote
 * character replaces what was two near-duplicate alternation branches.
 */
function stripDangerousHrefAttributes(input: string): string {
  return input.replace(/\s+(?:xlink:)?href\s*=\s*(["'])\s*(?:javascript|vbscript|data:text\/html)[^"']*\1/gi, "");
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
  cleaned = applyUntilStable(cleaned, stripEventHandlerAttributes);
  cleaned = applyUntilStable(cleaned, stripDangerousHrefAttributes);
  return cleaned.trim();
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

  if (/\s+on[a-zA-Z]+\s*=/i.test(svgContent)) {
    throw new XmlSanitizerError("UNSAFE_SVG_CONTENT", "SVG contains inline event handler attributes");
  }

  if (/(?:href|xlink:href)\s*=\s*(["'])\s*(?:javascript|vbscript|data:text\/html)/i.test(svgContent)) {
    throw new XmlSanitizerError("UNSAFE_SVG_CONTENT", "SVG contains dangerous URI scheme in link attribute");
  }
}
