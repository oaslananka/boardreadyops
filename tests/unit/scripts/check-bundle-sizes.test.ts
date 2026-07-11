import { describe, expect, it } from "vitest";

import {
  formatChildProcessStderr,
  normalizeSizePolicy,
  parseNpmPackOutput,
  resolveNpmCliPath,
} from "../../../scripts/check-bundle-sizes.mjs";

describe("check-bundle-sizes", () => {
  it("normalizes legacy numeric budgets", () => {
    expect(normalizeSizePolicy(1234, "legacy")).toEqual({ budget: 1234, failAtRatio: 0.9 });
  });

  it("defaults missing failAtRatio for object policies", () => {
    expect(normalizeSizePolicy({ budget: 2048 }, "object")).toEqual({ budget: 2048, failAtRatio: 0.9 });
  });

  it("preserves explicit failure ratios", () => {
    expect(normalizeSizePolicy({ budget: 4096, failAtRatio: 0.75 }, "strict")).toEqual({
      budget: 4096,
      failAtRatio: 0.75,
    });
  });

  it("parses npm 11 array metadata", () => {
    const metadata = { name: "boardreadyops", version: "1.8.0", size: 1234, unpackedSize: 5678, files: [] };
    expect(parseNpmPackOutput(JSON.stringify([metadata]))).toMatchObject({ size: 1234, unpackedSize: 5678 });
  });

  it("parses direct object metadata", () => {
    const metadata = { name: "boardreadyops", version: "1.8.0", size: 1234, unpackedSize: 5678, files: [] };
    expect(parseNpmPackOutput(JSON.stringify(metadata))).toMatchObject({ size: 1234, unpackedSize: 5678 });
  });

  it("parses npm 12 package-keyed metadata", () => {
    const metadata = { name: "boardreadyops", version: "1.8.0", size: 1234, unpackedSize: 5678, files: [] };
    expect(parseNpmPackOutput(JSON.stringify({ boardreadyops: metadata }))).toMatchObject({
      size: 1234,
      unpackedSize: 5678,
    });
  });

  it("rejects npm pack output without numeric size metadata", () => {
    expect(() => parseNpmPackOutput(JSON.stringify([{ name: "boardreadyops", files: [] }]))).toThrow(
      "numeric size metadata",
    );
  });

  it("resolves the npm CLI from fixed paths beside the Node.js runtime", () => {
    expect(
      resolveNpmCliPath("/opt/node/bin/node", "linux", (file) => file.endsWith("/lib/node_modules/npm/bin/npm-cli.js")),
    ).toBe("/opt/node/lib/node_modules/npm/bin/npm-cli.js");
    expect(resolveNpmCliPath("C:\\node\\node.exe", "win32", () => true)).toMatch(
      /node_modules[\\/]npm[\\/]bin[\\/]npm-cli\.js$/u,
    );
  });

  it("fails closed when npm cannot be resolved beside Node.js", () => {
    expect(() => resolveNpmCliPath("/opt/node/bin/node", "linux", () => false)).toThrow("npm CLI was not found");
  });

  it("formats child-process stderr without object default stringification", () => {
    expect(formatChildProcessStderr(Buffer.from(" npm failed \n"))).toBe("npm failed");
    expect(formatChildProcessStderr(" text error ")).toBe("text error");
    expect(formatChildProcessStderr({ message: "hidden" })).toBe("");
  });

  it("rejects policies without a positive numeric budget", () => {
    expect(() => normalizeSizePolicy({}, "bad policy")).toThrow("bad policy must define a positive numeric budget");
    expect(() => normalizeSizePolicy(0, "zero policy")).toThrow("zero policy must define a positive numeric budget");
  });
});
