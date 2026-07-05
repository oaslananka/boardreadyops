import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateConfig } from "../../../../src/core/config.js";
import { runPipeline } from "../../../../src/core/pipeline.js";
import { loadEspIdfPinContract } from "../../../../src/firmware/esp-idf.js";

const fixture = path.resolve("tests/fixtures/projects/firmware-contract-esp-idf");

describe("firmware.esp-idf-pin-contract", () => {
  it("accepts firmware ESP-IDF pin assignment configuration", () => {
    expect(
      validateConfig({
        version: 1,
        firmware: { "esp-idf": { pinAssignments: "firmware/esp-idf-pins.yml" } },
        projects: [{ path: ".", firmware: { "esp-idf": { pinAssignments: "board-pins.yml" } } }],
      }),
    ).toEqual([]);
  });

  it("loads object-form ESP-IDF pin contracts deterministically", async () => {
    await expect(loadEspIdfPinContract(path.join(fixture, "esp-idf-pins-good.yml"))).resolves.toMatchObject({
      errors: [],
      document: {
        pins: [
          { signal: "LED_STATUS", hardware: "U1.PA1", net: "LED_STATUS", pin: "GPIO2" },
          { signal: "I2C_SDA", hardware: "U1.PA2", net: "I2C_SDA", pin: "GPIO21" },
          { signal: "UART_TX", hardware: "U1.PA3", net: "UART_TX", pin: "GPIO17" },
        ],
      },
    });
  });

  it("skips when the firmware contract is not configured", async () => {
    const result = await runPipeline({
      path: fixture,
      failOn: "never",
      rules: ["firmware.esp-idf-pin-contract"],
      config: "missing-contract.yml",
    });
    expect(result.findings).toEqual([]);
  });

  it("reports mismatched, extra, and missing firmware assignments", async () => {
    const result = await runPipeline({
      path: fixture,
      failOn: "never",
      rules: ["firmware.esp-idf-pin-contract"],
    });
    expect(result.findings).toHaveLength(4);
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "firmware.esp-idf-pin-contract",
          resource: { path: "esp-idf-pins-mismatch.yml", kind: "firmware" },
          message: expect.stringContaining("LED_STATUS"),
        }),
        expect.objectContaining({
          ruleId: "firmware.esp-idf-pin-contract",
          resource: { path: "esp-idf-pins-mismatch.yml", kind: "firmware" },
          message: expect.stringContaining("EXTRA_SIGNAL"),
        }),
        expect.objectContaining({
          ruleId: "firmware.esp-idf-pin-contract",
          resource: { path: "pins.yml", kind: "pinmap" },
          message: expect.stringContaining("I2C_SDA"),
        }),
        expect.objectContaining({
          ruleId: "firmware.esp-idf-pin-contract",
          resource: { path: "pins.yml", kind: "pinmap" },
          message: expect.stringContaining("UART_TX"),
        }),
      ]),
    );
  });

  it("skips when the rule is disabled", async () => {
    await expect(
      runPipeline({
        path: fixture,
        failOn: "never",
        rules: ["firmware.esp-idf-pin-contract"],
        config: "disabled-contract.yml",
      }),
    ).resolves.toMatchObject({ findings: [] });
  });

  it("reports contract parse errors", async () => {
    const invalid = await runPipeline({
      path: fixture,
      failOn: "never",
      rules: ["firmware.esp-idf-pin-contract"],
      config: "invalid-rule-file.yml",
    });
    expect(invalid.findings).toEqual([
      expect.objectContaining({
        ruleId: "firmware.esp-idf-pin-contract",
        resource: { path: "invalid-contract.yml", kind: "firmware" },
        message: expect.stringContaining("could not be parsed"),
      }),
    ]);
  });

  it("passes when the ESP-IDF contract matches the pinmap", async () => {
    const result = await runPipeline({
      path: fixture,
      failOn: "never",
      rules: ["firmware.esp-idf-pin-contract"],
      config: "good-contract.yml",
    });
    expect(result.findings).toEqual([]);
  });
});
