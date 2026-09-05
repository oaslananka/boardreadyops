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
    const hasInternalEntityRef = /<!ENTITY\s+[\w.-]+\s+["'][^"']*&[\w.-]+;[^"']*["']/i.test(xmlContent);

    if (entityCount > 2 || hasInternalEntityRef) {
      throw new XmlSanitizerError(
        "ENTITY_EXPANSION_DETECTED",
        "XML contains nested or recursive entity definitions (Billion Laughs / expansion attack)",
      );
    }
  }
}

/**
 * Strips DOCTYPE and entity declarations from XML while keeping element content intact.
 */
export function sanitizeXml(xmlContent: string): string {
  // Strip multi-line DOCTYPE with internal subsets: <!DOCTYPE root [ ... ]>
  let cleaned = xmlContent.replace(/<!DOCTYPE\s+[^>[\]]*(\[[^\]]*\])?\s*>/gis, "");
  // Strip standalone ENTITY declarations if any remain
  cleaned = cleaned.replace(/<!ENTITY\s+[^>]*>/gis, "");
  return cleaned.trim();
}

/**
 * Sanitizes SVG markup for board rendering, gerber visualizers, and layer previews.
 * Strips <script>, <foreignObject>, inline event handlers (onload, onerror, etc.),
 * and javascript: URLs.
 */
export function sanitizeSvg(svgContent: string): string {
  let cleaned = svgContent;

  // Strip XML/HTML comments
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, "");

  // Strip <script>...</script> and self-closing <script />
  cleaned = cleaned.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gis, "");
  cleaned = cleaned.replace(/<script\b[^>]*\/>/gis, "");

  // Strip <foreignObject>...</foreignObject> and self-closing <foreignObject />
  cleaned = cleaned.replace(/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject>/gis, "");
  cleaned = cleaned.replace(/<foreignObject\b[^>]*\/>/gis, "");

  // Strip inline event attributes (onload, onerror, onclick, onmouseover, etc.)
  cleaned = cleaned.replace(/\s+on[a-zA-Z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gis, "");

  // Strip javascript:, vbscript:, and data:text/html URLs in href / xlink:href
  cleaned = cleaned.replace(
    /\s+(?:xlink:)?href\s*=\s*(?:"\s*(?:javascript|vbscript|data:text\/html)[^"]*"|'\s*(?:javascript|vbscript|data:text\/html)[^']*')/gis,
    "",
  );

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

  if (/(?:href|xlink:href)\s*=\s*["']\s*(?:javascript|vbscript|data:text\/html)/i.test(svgContent)) {
    throw new XmlSanitizerError("UNSAFE_SVG_CONTENT", "SVG contains dangerous URI scheme in link attribute");
  }
}
