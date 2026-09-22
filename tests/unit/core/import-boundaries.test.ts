import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Trust-Core Import Boundaries", () => {
  it("ensures src/core modules do not depend on hosted apps/web or cloud-core", async () => {
    const coreDir = join(process.cwd(), "src/core");
    const files = (await readdir(coreDir)).filter((f) => f.endsWith(".ts"));

    for (const file of files) {
      const content = await readFile(join(coreDir, file), "utf8");
      expect(content).not.toContain('from "apps/web');
      expect(content).not.toContain("from 'apps/web");
    }
  });
});
