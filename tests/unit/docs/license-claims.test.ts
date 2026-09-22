import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Licensing Claims Policy", () => {
  it("rejects 100% open source claims in product/GTM documentation", async () => {
    const docsDir = join(process.cwd(), "docs");

    async function checkDirectory(dir: string): Promise<void> {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          await checkDirectory(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          if (fullPath.includes("superpowers/plans")) continue;
          const content = await readFile(fullPath, "utf8");
          expect(content).not.toContain("100% open source");
        }
      }
    }

    await checkDirectory(docsDir);
  });
});
