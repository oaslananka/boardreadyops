import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createLogger } from "../../../src/core/logger.js";
import { runPipeline } from "../../../src/core/pipeline.js";
import { type Rule, registerRule } from "../../../src/core/rule-registry.js";

const fixtureRoot = path.resolve("tests/fixtures/projects");

function memoryStream() {
  let text = "";
  return {
    stream: {
      write(value: string) {
        text += value;
        return true;
      },
    } as NodeJS.WritableStream,
    text: () => text,
  };
}

describe("structured logger", () => {
  it("emits parseable JSONL with stable fields and redacted values", () => {
    const memory = memoryStream();
    const projectRoot = path.resolve("work/project");
    const projectPath = path.join(projectRoot, "hardware", "demo.kicad_pro");
    const logger = createLogger({
      level: "debug",
      format: "json",
      stream: memory.stream,
      now: () => new Date("2026-05-23T00:00:00.000Z"),
      requestId: "req-123",
      sessionId: "session-456",
      projectRoot,
      maxFieldLength: 32,
    });

    logger.info("cli.command.start", {
      rule: "bom.lifecycle",
      latency_ms: 12,
      path: projectPath,
      project: `${projectRoot.replaceAll("/", "\\")}\\hardware\\demo.kicad_pro`,
      apiKey: "plain-secret-value",
      payload: "x".repeat(80),
    });

    const entry = JSON.parse(memory.text().trim());
    expect(entry).toMatchObject({
      ts: "2026-05-23T00:00:00.000Z",
      level: "info",
      event: "cli.command.start",
      message: "cli.command.start",
      request_id: "req-123",
      session_id: "session-456",
      rule: "bom.lifecycle",
      latency_ms: 12,
      path: "<project>/hardware/demo.kicad_pro",
      project: "<project>/hardware/demo.kicad_pro",
      apiKey: "[REDACTED]",
    });
    expect(entry.payload).toContain("[truncated]");
  });

  it("normalizes errors and includes stacks only when debug logging is enabled", () => {
    const infoMemory = memoryStream();
    const debugMemory = memoryStream();
    const error = new TypeError("bad config");
    error.stack = "TypeError: bad config\n    at test";

    createLogger({
      level: "info",
      format: "json",
      stream: infoMemory.stream,
      now: () => new Date("2026-05-23T00:00:00.000Z"),
    }).error("cli.command.error", { error });
    createLogger({
      level: "debug",
      format: "json",
      stream: debugMemory.stream,
      now: () => new Date("2026-05-23T00:00:00.000Z"),
    }).error("cli.command.error", { error });

    const infoEntry = JSON.parse(infoMemory.text().trim());
    const debugEntry = JSON.parse(debugMemory.text().trim());
    expect(infoEntry.error).toEqual({ type: "TypeError", message: "bad config" });
    expect(debugEntry.error).toEqual({
      type: "TypeError",
      message: "bad config",
      stack: "TypeError: bad config\n    at test",
    });
  });

  it("redacts nested objects, arrays, inline tokens, and critical entries", () => {
    const memory = memoryStream();
    const logger = createLogger({
      level: "debug",
      format: "json",
      stream: memory.stream,
      now: () => new Date("2026-05-23T00:00:00.000Z"),
      projectRoot: "/work/project",
    });

    logger.critical("redaction.nested", {
      payload: "request token=plain-token-value",
      nested: {
        authorization: "Bearer nested-secret",
        children: ["Authorization: Bearer child-secret", { password: "array-secret" }],
      },
    });

    const entry = JSON.parse(memory.text().trim());
    expect(entry.level).toBe("critical");
    expect(entry.payload).toBe("request token=[REDACTED]");
    expect(entry.nested).toEqual({
      authorization: "[REDACTED]",
      children: ["Authorization: Bearer [REDACTED]", { password: "[REDACTED]" }],
    });
  });

  it("rotates file output with bounded retention", async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-logs-"));
    const file = path.join(temp, "boardreadyops.log");
    const logger = createLogger({
      level: "debug",
      format: "json",
      stream: memoryStream().stream,
      logFile: file,
      maxFileBytes: 180,
      retention: 2,
      now: () => new Date("2026-05-23T00:00:00.000Z"),
    });

    for (let index = 0; index < 8; index += 1) {
      logger.info("rotation.entry", { index, payload: "x".repeat(80) });
    }

    const files = (await fs.readdir(temp)).sort();
    expect(files).toEqual(["boardreadyops.log", "boardreadyops.log.1", "boardreadyops.log.2"]);
    await expect(fs.stat(`${file}.3`)).rejects.toMatchObject({ code: "ENOENT" });

    for (const name of files) {
      const lines = (await fs.readFile(path.join(temp, name), "utf8")).trim().split(/\r?\n/);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(JSON.parse(line)).toMatchObject({ event: "rotation.entry" });
      }
    }
  });

  it("supports disabled rotation and zero retention cleanup", async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-log-retention-"));
    const unboundedFile = path.join(temp, "unbounded.log");
    const unbounded = createLogger({
      level: "debug",
      format: "json",
      stream: memoryStream().stream,
      logFile: unboundedFile,
      maxFileBytes: 0,
      retention: 2,
      now: () => new Date("2026-05-23T00:00:00.000Z"),
    });
    unbounded.info("rotation.disabled", { payload: "x".repeat(120) });
    unbounded.info("rotation.disabled", { payload: "x".repeat(120) });

    expect(await fs.readdir(temp)).toContain("unbounded.log");
    await expect(fs.stat(`${unboundedFile}.1`)).rejects.toMatchObject({ code: "ENOENT" });

    const zeroRetentionFile = path.join(temp, "zero-retention.log");
    const zeroRetention = createLogger({
      level: "debug",
      format: "json",
      stream: memoryStream().stream,
      logFile: zeroRetentionFile,
      maxFileBytes: 160,
      retention: 0,
      now: () => new Date("2026-05-23T00:00:00.000Z"),
    });
    zeroRetention.info("rotation.zero-retention", { payload: "x".repeat(120) });
    zeroRetention.info("rotation.zero-retention", { payload: "x".repeat(120) });

    expect(await fs.readdir(temp)).not.toContain("zero-retention.log.1");
    const active = await fs.readFile(zeroRetentionFile, "utf8");
    expect(active).toContain("rotation.zero-retention");
  });

  it("surfaces filesystem errors from the rotating log sink", async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "boardreadyops-log-error-"));
    const loop = path.join(temp, "loop.log");
    await fs.mkdir(loop);
    const logger = createLogger({
      level: "debug",
      format: "json",
      stream: memoryStream().stream,
      logFile: loop,
      maxFileBytes: 0,
      retention: 1,
      now: () => new Date("2026-05-23T00:00:00.000Z"),
    });

    expect(() => logger.info("rotation.error", { payload: "x".repeat(120) })).toThrow();
  });

  it("logs rule errors before rethrowing them", async () => {
    const memory = memoryStream();
    const ruleId = "test.throwing-logger";
    const throwingRule: Rule = {
      meta: {
        id: ruleId,
        title: "Throwing logger rule",
        description: "Exercises structured rule error logs.",
        rationale: "Coverage for BOARD-38 pipeline error logging.",
        defaultSeverity: "high",
        appliesTo: ["project"],
        configKeys: [],
        kicadVersions: ["future"],
        tags: ["test"],
        category: "unclassified",
        evidenceType: "unclassified",
        fixability: "unclassified",
        vendorDependence: "unclassified",
      },
      run: async () => {
        throw new Error("rule exploded");
      },
    };
    registerRule(throwingRule);

    await expect(
      runPipeline(
        {
          path: path.join(fixtureRoot, "safe-basic"),
          failOn: "never",
          rules: [ruleId],
        },
        createLogger({
          level: "debug",
          format: "json",
          stream: memory.stream,
          now: () => new Date("2026-05-23T00:00:00.000Z"),
        }),
      ),
    ).rejects.toThrow("rule exploded");

    const entries = memory
      .text()
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    expect(entries).toContainEqual(
      expect.objectContaining({
        event: "pipeline.rule.error",
        rule: ruleId,
        error: {
          type: "Error",
          message: "rule exploded",
          stack: expect.stringContaining("rule exploded"),
        },
      }),
    );
  });
});
