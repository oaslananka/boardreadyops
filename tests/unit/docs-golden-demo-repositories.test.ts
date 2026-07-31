import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const goldenDemo = new URL("../../docs/golden-demo.md", import.meta.url);
const productPlan = new URL("../../docs/product/golden-demo-repositories.md", import.meta.url);
const readme = new URL("../../README.md", import.meta.url);

describe("public golden demo repositories", () => {
  it("links the live passing and failing pull requests with their expected outcomes", async () => {
    const content = (
      await Promise.all([goldenDemo, productPlan, readme].map((document) => readFile(document, "utf8")))
    ).join("\n");

    for (const phrase of [
      "oaslananka/boardreadyops-demo-pass",
      "oaslananka/boardreadyops-demo-pass/pull/1",
      "oaslananka/boardreadyops-demo-fail",
      "oaslananka/boardreadyops-demo-fail/pull/1",
      "expected pass",
      "expected fail",
      "workflow artifacts",
      "synthetic",
    ]) {
      expect(content.toLowerCase()).toContain(phrase.toLowerCase());
    }
  });
});
