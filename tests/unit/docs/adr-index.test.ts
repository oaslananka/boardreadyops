import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../../");
const adrDir = resolve(root, "docs/architecture/adr");
const read = (file: string) => readFileSync(resolve(root, file), "utf8");

describe("architecture decision record discovery", () => {
  it("gives every canonical ADR a unique number and a matching navigation entry", () => {
    const nav = read("mkdocs.yml");
    const seen = new Set<string>();
    for (const name of readdirSync(adrDir).filter((name) => name.endsWith(".md"))) {
      const document = readFileSync(resolve(adrDir, name), "utf8");
      if (name === "0009-plugin-sandboxing.md" && document.startsWith("# Plugin trust boundary: moved")) {
        expect(document).toContain("[ADR-0020");
        expect(document).toContain("(0020-plugin-sandboxing.md)");
        continue;
      }
      const number = /^# ADR[- ](\d{4})\b/u.exec(document)?.[1];
      expect(number, name).toBeDefined();
      expect(name).toMatch(new RegExp(`^${number}-`, "u"));
      expect(seen.has(number ?? ""), name).toBe(false);
      seen.add(number ?? "");
      const navigationEntries = nav.split("\n").filter((line) => line.trimEnd().endsWith(`: architecture/adr/${name}`));
      expect(navigationEntries, name).toHaveLength(1);
      expect(navigationEntries[0]).toContain(`"${number}: `);
    }
  });

  it("keeps the old plugin URL as a pointer and marks the old license decision historical", () => {
    expect(read("docs/architecture/adr/0009-plugin-sandboxing.md")).toContain("(0020-plugin-sandboxing.md)");
    expect(read("docs/architecture/adr/0019-source-available-commercial-licensing.md")).toContain("[ADR-0021");
    const current = read("docs/architecture/adr/0021-agpl-contribution-licensing.md");
    expect(current).toContain("AGPL-3.0-only");
    expect(current).toContain("https://github.com/oaslananka/boardreadyops/pull/1565");
    expect(current).toContain("LICENSING.md");
  });
});
