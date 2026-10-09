import { describe, expect, it } from "vitest";
import {
  BoardReadyOpsError,
  CliError,
  ConfigError,
  DiscoveryError,
  EvidenceBundleError,
  isBoardReadyOpsError,
  KicadCliError,
  PluginError,
  RuleError,
} from "../../../src/core/errors.js";

describe("structured BoardReadyOps errors", () => {
  it("preserves the message, explicit code and root cause on the base error", () => {
    const cause = new Error("underlying failure");
    const error = new BoardReadyOpsError("base failure", "BASE_FAILURE", { cause });
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(BoardReadyOpsError);
    expect(error.name).toBe("BoardReadyOpsError");
    expect(error.message).toBe("base failure");
    expect(error.code).toBe("BASE_FAILURE");
    expect(error.cause).toBe(cause);
    expect(isBoardReadyOpsError(error)).toBe(true);
  });

  it.each([
    [ConfigError, "ConfigError", "CONFIG_INVALID"],
    [CliError, "CliError", "CLI_INVALID_ARGS"],
    [EvidenceBundleError, "EvidenceBundleError", "EVIDENCE_BUNDLE_INVALID"],
    [DiscoveryError, "DiscoveryError", "DISCOVERY_FAILED"],
  ])("retains typed %s identity, code and ErrorOptions cause", (ErrorClass, name, code) => {
    const cause = new Error("cause");
    const error = new ErrorClass("invalid input", { cause });
    expect(error.name).toBe(name);
    expect(error.code).toBe(code);
    expect(error.message).toBe("invalid input");
    expect(error.cause).toBe(cause);
    expect(error).toBeInstanceOf(BoardReadyOpsError);
    expect(isBoardReadyOpsError(error)).toBe(true);
  });

  it("preserves failing plugin identity without treating it as arbitrary Error", () => {
    const cause = new Error("import failed");
    const error = new PluginError("could not load", "@acme/plugin", { cause });
    expect(error.name).toBe("PluginError");
    expect(error.code).toBe("PLUGIN_LOAD_FAILED");
    expect(error.message).toBe("could not load");
    expect(error.specifier).toBe("@acme/plugin");
    expect(error.cause).toBe(cause);
    expect(isBoardReadyOpsError(error)).toBe(true);
  });

  it("preserves the failing rule identity", () => {
    const cause = new Error("unexpected");
    const error = new RuleError("rule failed", "design.board-outline", { cause });
    expect(error.name).toBe("RuleError");
    expect(error.code).toBe("RULE_EXECUTION_FAILED");
    expect(error.message).toBe("rule failed");
    expect(error.ruleId).toBe("design.board-outline");
    expect(error.cause).toBe(cause);
    expect(isBoardReadyOpsError(error)).toBe(true);
  });

  it("preserves KiCad CLI exit codes including zero and an unspecified exit code", () => {
    const cause = new Error("spawn failed");
    const error = new KicadCliError("kicad-cli failed", 7, { cause });
    expect(error.name).toBe("KicadCliError");
    expect(error.code).toBe("KICAD_CLI_FAILED");
    expect(error.message).toBe("kicad-cli failed");
    expect(error.exitCode).toBe(7);
    expect(error.cause).toBe(cause);
    expect(new KicadCliError("exited", 0).exitCode).toBe(0);
    expect(new KicadCliError("missing").exitCode).toBeUndefined();
    expect(isBoardReadyOpsError(error)).toBe(true);
  });

  it("rejects native, cross-domain and primitive errors from the type guard", () => {
    for (const value of [new Error("unrelated"), new TypeError("wrong type"), null, undefined, 0, "", {}]) {
      expect(isBoardReadyOpsError(value)).toBe(false);
    }
  });
});
