import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Keep the primary authenticated journeys aligned on the same responsive canvas.
// Long-form content can still use a narrower inner column when that improves reading.
const customerPages = [
  "dashboard/page.tsx",
  "dashboard/loading.tsx",
  "setup/page.tsx",
  "projects/page.tsx",
  "work/page.tsx",
  "work/loading.tsx",
  "reviews/page.tsx",
  "runs/page.tsx",
  "runs/loading.tsx",
  "deliveries/page.tsx",
  "parts/page.tsx",
  "rules/page.tsx",
  "policies/page.tsx",
  "evidence/page.tsx",
  "insights/page.tsx",
  "settings/layout.tsx",
] as const;

describe("authenticated page layout consistency", () => {
  it.each(customerPages)("%s uses the shared application canvas width", (page) => {
    const source = readFileSync(resolve("apps/web/app", page), "utf8");
    const mainClassNames = [...source.matchAll(/<main\b[^>]*?className="([^"]+)"/gs)].map((match) => match[1]);

    expect(mainClassNames.length).toBeGreaterThan(0);
    for (const mainClassName of mainClassNames) {
      expect(mainClassName).toContain("max-w-[1600px]");
      expect(mainClassName).toContain("w-full");
      expect(mainClassName).toContain("mx-auto");
    }
  });
});
