import { describe, expect, it } from "vitest";
import agentPlanSchema from "../../../schemas/agent-plan.schema.json" with { type: "json" };
import configSchema from "../../../schemas/config.schema.json" with { type: "json" };
import doctorSchema from "../../../schemas/doctor.schema.json" with { type: "json" };
import reviewPublishSchema from "../../../schemas/review-publish-result.schema.json" with { type: "json" };
import { schemaCommand } from "../../../src/cli/commands/schema.js";

function captureStreams() {
  let stdout = "";
  let stderr = "";
  const stream = (append: (chunk: string) => void) =>
    ({
      write(chunk: string): boolean {
        append(chunk);
        return true;
      },
    }) as unknown as NodeJS.WritableStream;

  return {
    streams: {
      stdout: stream((chunk) => {
        stdout += chunk;
      }),
      stderr: stream((chunk) => {
        stderr += chunk;
      }),
    },
    output: () => ({ stdout, stderr }),
  };
}

describe("schema CLI command", () => {
  it.each([undefined, "config"])("prints the configuration schema for %s", (name) => {
    const capture = captureStreams();
    expect(schemaCommand(name, capture.streams)).toBe(0);
    expect(JSON.parse(capture.output().stdout)).toEqual(configSchema);
    expect(capture.output().stderr).toBe("");
  });

  it.each([
    ["plan", agentPlanSchema],
    ["agent-plan", agentPlanSchema],
    ["doctor", doctorSchema],
    ["review-publish", reviewPublishSchema],
    ["review-publish-result", reviewPublishSchema],
  ])("returns the requested schema for %s", (name, expected) => {
    const capture = captureStreams();
    expect(schemaCommand(name, capture.streams)).toBe(0);
    expect(JSON.parse(capture.output().stdout)).toEqual(expected);
    expect(capture.output().stderr).toBe("");
  });

  it.each(["does_not_exist", "", "Config", "__proto__", "constructor"])(
    "rejects an unknown name (%s) without emitting misleading JSON",
    (name) => {
      const capture = captureStreams();
      expect(schemaCommand(name, capture.streams)).toBe(2);
      expect(capture.output().stdout).toBe("");
      expect(capture.output().stderr).toContain("Unknown schema");
      expect(capture.output().stderr).toContain("config");
      expect(capture.output().stderr).toContain("review-publish");
    },
  );
});
