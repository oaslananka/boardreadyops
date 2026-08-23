import fs from "node:fs";
import * as yaml from "js-yaml";
import { describe, expect, it } from "vitest";

describe("documentation public domain", () => {
  it("uses the BoardReadyOps custom hostname as the canonical MkDocs URL", () => {
    const config = yaml.load(fs.readFileSync("mkdocs.yml", "utf8")) as {
      site_url?: string;
      theme?: { logo?: string; favicon?: string };
    };

    expect(config.site_url).toBe("https://docs.boardreadyops.com/");
    expect(config.theme?.logo).toBe("assets/boardreadyops-mark.svg");
    expect(config.theme?.favicon).toBe("assets/boardreadyops-mark.svg");
  });
});
