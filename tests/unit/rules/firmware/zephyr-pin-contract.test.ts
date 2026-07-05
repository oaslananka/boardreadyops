import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateConfig } from "../../../../src/core/config.js";
import { runPipeline } from "../../../../src/core/pipeline.js";
import { loadZephyrPinContract } from "../../../../src/firmware/zephyr.js";

const fixture = path.resolve("tests/fixtures/projects/firmware-contract-zephyr");

describe("firmware.zephyr-pin-contract", () => {
  it("accepts firmware Zephyr pin assignment configuration", () => {
    expect(
      validateConfig({
        version: 1,
        firmware: { zephyr: { pinAssignments: "firmware/zephyr-pins.yml" } },
        projects: [{ path: ".", firmware: { zephyr: { pinAssignments: "board-pins.yml" } } }],
      }),
    ).toEqual([]);
  });

  it("loads object-form Zephyr pin contracts deterministically", async () => {
    await expect(loadZephyrPinContract(path.join(fixture, "zephyr-pins-good.yml"))).resolves.toMatchObject({
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

  it("loads array-form Zephyr pin contracts", async () => {
    const result = await loadZephyrPinContract(path.join(fixture, "zephyr-pins-array-good.yml"));
    expect(result.errors).toEqual([]);
    expect(result.document?.pins).toHaveLength(3);
    expect(result.document?.pins[0]).toMatchObject({ signal: "LED_STATUS", hardware: "U1.PA1" });
  });

  it("skips when the firmware contract is not configured", async () => {
    const result = await runPipeline({
      path: fixture,
      failOn: "never",
      rules: ["firmware.zephyr-pin-contract"],
      config: "missing-contract.yml",
    });
    expect(result.findings).toEqual([]);
  });

  it("reports mismatched, extra, and missing firmware assignments", async () => {
    const result = await runPipeline({
      path: fixture,
      failOn: "never",
      rules: ["firmware.zephyr-pin-contract"],
    });
    expect(result.findings).toHaveLength(4);
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "firmware.zephyr-pin-contract",
          resource: { path: "zephyr-pins-mismatch.yml", kind: "firmware" },
          message: expect.stringContaining("LED_STATUS"),
        }),
        expect.objectContaining({
          ruleId: "firmware.zephyr-pin-contract",
          resource: { path: "zephyr-pins-mismatch.yml", kind: "firmware" },
          message: expect.stringContaining("EXTRA_SIGNAL"),
        }),
        expect.objectContaining({
          ruleId: "firmware.zephyr-pin-contract",
          resource: { path: "pins.yml", kind: "pinmap" },
          message: expect.stringContaining("I2C_SDA"),
        }),
        expect.objectContaining({
          ruleId: "firmware.zephyr-pin-contract",
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
        rules: ["firmware.zephyr-pin-contract"],
        config: "disabled-contract.yml",
      }),
    ).resolves.toMatchObject({ findings: [] });
  });

  it("supports rule-level contract files and reports contract parse errors", async () => {
    await expect(
      runPipeline({
        path: fixture,
        failOn: "never",
        rules: ["firmware.zephyr-pin-contract"],
        config: "rule-file-contract.yml",
      }),
    ).resolves.toMatchObject({ findings: [] });

    const invalid = await runPipeline({
      path: fixture,
      failOn: "never",
      rules: ["firmware.zephyr-pin-contract"],
      config: "invalid-rule-file.yml",
    });
    expect(invalid.findings).toEqual([
      expect.objectContaining({
        ruleId: "firmware.zephyr-pin-contract",
        resource: { path: "invalid-contract.yml", kind: "firmware" },
        message: expect.stringContaining("could not be parsed"),
      }),
    ]);
  });

  it("passes when the Zephyr contract matches the pinmap", async () => {
    const result = await runPipeline({
      path: fixture,
      failOn: "never",
      rules: ["firmware.zephyr-pin-contract"],
      config: "good-contract.yml",
    });
    expect(result.findings).toEqual([]);
  });
});
