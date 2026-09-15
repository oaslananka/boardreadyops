import { describe, expect, it } from "vitest";
import {
  databaseErrorCode,
  emitRepositoryActionTelemetry,
  errorClassOf,
} from "../../../apps/web/lib/repository-action-telemetry.js";

/**
 * `handleRepositoryAction` had a bare `catch {}` and no logger, so a failed dashboard action
 * returned "The action could not be queued. Please try again." and discarded the reason. The
 * generic message to the caller is right; throwing the cause away as well made the failure
 * undiagnosable from the deployment.
 */

function capture(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
}

describe("databaseErrorCode", () => {
  it("reads a Postgres SQLSTATE off a thrown error", () => {
    // These are the codes worth having: 42883 undefined function, 42P01 undefined table,
    // 23505 unique violation, 28000 failed authorisation. A class name alone says "error".
    for (const code of ["42883", "42P01", "23505", "28000"]) {
      expect(databaseErrorCode(Object.assign(new Error("boom"), { code })), code).toBe(code);
    }
  });

  it("ignores a code that is not a SQLSTATE", () => {
    // Node and many libraries put their own strings on `code`; only a five-character SQLSTATE
    // means what this field claims to mean.
    for (const code of ["ENOTFOUND", "ERR_INVALID_ARG_TYPE", "", "1234", "123456"]) {
      expect(databaseErrorCode(Object.assign(new Error("boom"), { code })), code).toBeUndefined();
    }
  });

  it("returns nothing for a value that carries no code", () => {
    for (const thrown of [new Error("plain"), "a string", null, undefined, 42, {}]) {
      expect(databaseErrorCode(thrown)).toBeUndefined();
    }
  });
});

describe("errorClassOf", () => {
  it("names the error, and names a non-error too", () => {
    expect(errorClassOf(new TypeError("bad"))).toBe("TypeError");
    expect(errorClassOf(new Error("bad"))).toBe("Error");
    expect(errorClassOf("a bare string")).toBe("UnknownError");
    expect(errorClassOf(undefined)).toBe("UnknownError");
  });
});

describe("emitRepositoryActionTelemetry", () => {
  it("records a failure with the class and the database code", () => {
    const { lines, write } = capture();

    emitRepositoryActionTelemetry(
      { action: "rerun", outcome: "failed", errorClass: "error", errorCode: "42883" },
      write,
    );

    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      level: "error",
      component: "repository-actions",
      event: "repository.action",
      action: "rerun",
      outcome: "failed",
      errorClass: "error",
      errorCode: "42883",
    });
  });

  it("logs a successful action at info without error fields", () => {
    const { lines, write } = capture();

    emitRepositoryActionTelemetry({ action: "rerun", outcome: "accepted" }, write);

    const parsed = JSON.parse(lines[0] ?? "{}");
    expect(parsed.level).toBe("info");
    expect(parsed).not.toHaveProperty("errorClass");
    expect(parsed).not.toHaveProperty("errorCode");
  });

  it("emits one line of valid JSON", () => {
    const { lines, write } = capture();

    emitRepositoryActionTelemetry({ action: "rerun", outcome: "duplicate" }, write);

    expect(lines[0]?.endsWith("\n")).toBe(true);
    expect(lines[0]?.trimEnd().includes("\n")).toBe(false);
  });

  it("cannot be made to inject a newline into the log stream", () => {
    const { lines, write } = capture();

    // action and errorClass both arrive from outside. A line-delimited stream that can be split
    // by a crafted value is worse than no logging, because it corrupts neighbouring records.
    emitRepositoryActionTelemetry(
      {
        action: 'rerun"}\n{"level":"info","forged":true',
        outcome: "failed",
        errorClass: "Err\nor",
        errorCode: "4288\n3",
      },
      write,
    );

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? "{}");
    expect(parsed).not.toHaveProperty("forged");
    expect(String(parsed.action)).not.toContain("\n");
    expect(String(parsed.errorClass)).not.toContain("\n");
  });

  it("falls back to a named action rather than omitting the field", () => {
    const { lines, write } = capture();

    // A log line with no action is far less useful, and the sanitiser can empty the value.
    emitRepositoryActionTelemetry({ action: "\n\n", outcome: "failed" }, write);

    expect(JSON.parse(lines[0] ?? "{}").action).toBe("unknown");
  });
});
