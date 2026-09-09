import { describe, expect, it } from "vitest";
import { tokenizeYamlLine } from "../../../apps/web/components/yaml-syntax-highlighter.js";

describe("YAML syntax highlighter tokenization", () => {
  it("preserves indentation and comment text", () => {
    expect(tokenizeYamlLine("  # setup note", 3)).toEqual([
      { id: "L3-indent", type: "plain", text: "  " },
      { id: "L3-comment", type: "comment", text: "# setup note" },
    ]);
  });

  it("tokenizes keys and scalar values without changing source text", () => {
    expect(tokenizeYamlLine("  bom.missing-mpn: true", 4)).toEqual([
      { id: "L4-prefix", type: "punctuation", text: "  " },
      { id: "L4-k-bom.missing-mpn", type: "key", text: "bom.missing-mpn" },
      { id: "L4-colon", type: "punctuation", text: ": " },
      { id: "L4-bool", type: "boolean", text: "true" },
    ]);
    expect(tokenizeYamlLine("version: 1.2", 5)).toEqual([
      { id: "L5-k-version", type: "key", text: "version" },
      { id: "L5-colon", type: "punctuation", text: ": " },
      { id: "L5-num", type: "number", text: "1.2" },
    ]);
  });

  it("distinguishes list key/value entries from plain list items", () => {
    expect(tokenizeYamlLine("  - path: .", 6)).toEqual([
      { id: "L6-prefix", type: "punctuation", text: "  - " },
      { id: "L6-k-path", type: "key", text: "path" },
      { id: "L6-colon", type: "punctuation", text: ": " },
      { id: "L6-str", type: "string", text: "." },
    ]);
    expect(tokenizeYamlLine("  - gerbers", 7)).toEqual([
      { id: "L7-marker", type: "punctuation", text: "  - " },
      { id: "L7-item", type: "string", text: "gerbers" },
    ]);
  });

  it("keeps empty and unrecognized lines lossless", () => {
    expect(tokenizeYamlLine("", 8)).toEqual([{ id: "L8-empty", type: "plain", text: "" }]);
    expect(tokenizeYamlLine("@not-yaml-key", 9)).toEqual([{ id: "L9-plain", type: "plain", text: "@not-yaml-key" }]);
  });
});
