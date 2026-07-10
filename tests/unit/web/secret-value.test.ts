import { describe, expect, it, vi } from "vitest";
import { configuredSecretValue } from "../../../apps/web/lib/secret-value.js";

describe("configuredSecretValue", () => {
  it("prefers a configured secret file over the environment value", () => {
    const readFile = vi.fn(() => "file-secret\n");

    expect(
      configuredSecretValue({
        environment: { VALUE: "environment-secret", VALUE_FILE: "/run/keys/value" },
        valueName: "VALUE",
        fileName: "VALUE_FILE",
        readFile,
      }),
    ).toBe("file-secret");
    expect(readFile).toHaveBeenCalledWith("/run/keys/value", "utf8");
  });

  it("fails closed when a configured secret file cannot be read", () => {
    expect(
      configuredSecretValue({
        environment: { VALUE: "environment-secret", VALUE_FILE: "/run/keys/missing" },
        valueName: "VALUE",
        fileName: "VALUE_FILE",
        readFile: () => {
          throw new Error("missing");
        },
      }),
    ).toBeUndefined();
  });

  it("uses a trimmed environment value when no file is configured", () => {
    expect(
      configuredSecretValue({
        environment: { VALUE: "  environment-secret  " },
        valueName: "VALUE",
        fileName: "VALUE_FILE",
      }),
    ).toBe("environment-secret");
  });
});
