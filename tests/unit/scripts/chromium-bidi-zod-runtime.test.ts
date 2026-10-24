import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

// Puppeteer owns this transitive package, so resolve it through Puppeteer
// instead of coupling tests to pnpm's peer suffix or virtual-store paths.
const requireFromProject = createRequire(import.meta.url);
const requireFromPuppeteer = createRequire(requireFromProject.resolve("puppeteer"));
const requireFromCore = createRequire(requireFromPuppeteer.resolve("puppeteer-core"));
const bidiEntry = requireFromCore.resolve("chromium-bidi");
const parserUrl = pathToFileURL(path.join(path.dirname(bidiEntry), "protocol-parser", "protocol-parser.js")).href;

describe("Chromium BiDi's patched Zod 4 protocol parser", () => {
  it("preserves success and protocol-specific invalid-argument errors", async () => {
    const { Browser } = await import(parserUrl);
    expect(Browser.parseRemoveUserContextParameters({ userContext: "context-test" })).toEqual({
      userContext: "context-test",
    });
    expect(() => Browser.parseRemoveUserContextParameters({})).toThrowError(/userContext/u);
    try {
      Browser.parseRemoveUserContextParameters({});
      expect.unreachable("Parser should reject missing user context");
    } catch (error) {
      expect((error as Error).constructor.name).toBe("InvalidArgumentException");
      expect(error).not.toBeInstanceOf(TypeError);
    }
  });
});
