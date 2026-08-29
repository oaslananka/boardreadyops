import { describe, expect, it } from "vitest";
import {
  CURATED_DOC_LINKS,
  DOCS_ORIGIN,
  PUBLIC_API_PATHS,
  PUBLIC_HTML_PAGES,
  PUBLIC_SITE_ORIGIN,
} from "../../../apps/web/lib/public-discovery.js";

describe("public discovery manifest", () => {
  it("publishes only the approved canonical surfaces", () => {
    expect(PUBLIC_SITE_ORIGIN).toBe("https://boardreadyops.com");
    expect(DOCS_ORIGIN).toBe("https://docs.boardreadyops.com");
    expect(PUBLIC_HTML_PAGES).toEqual([{ path: "/", markdownPath: "/index.md" }]);
    expect(PUBLIC_API_PATHS).toEqual(["/api/health/live", "/api/health/ready"]);
  });

  it("keeps curated links on canonical public origins", () => {
    for (const item of CURATED_DOC_LINKS) {
      const url = new URL(item.url);
      expect([PUBLIC_SITE_ORIGIN, DOCS_ORIGIN]).toContain(url.origin);
      expect(url.username).toBe("");
      expect(url.password).toBe("");
    }
  });
});
