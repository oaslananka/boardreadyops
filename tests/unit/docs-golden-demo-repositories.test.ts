import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const sources = [
  new URL("../../docs/golden-demo.md", import.meta.url),
  new URL("../../docs/product/golden-demo-repositories.md", import.meta.url),
  new URL("../../README.md", import.meta.url),
  new URL("../../apps/web/app/page.tsx", import.meta.url),
];

describe("public golden demo links", () => {
  it("links real local fixtures without promising missing external pull requests", async () => {
    const files = await Promise.all(sources.map((source) => readFile(source, "utf8")));
    const combined = files.join("\n");

    expect(combined).toContain("examples/golden-demo/broken");
    expect(combined).toContain("examples/golden-demo/fixed");
    expect(combined.toLowerCase()).toContain("expected pass");
    expect(combined.toLowerCase()).toContain("expected fail");
    expect(combined).not.toMatch(/https:\/\/github\.com\/oaslananka\/boardreadyops-demo-(?:pass|fail)/u);
  });
});
