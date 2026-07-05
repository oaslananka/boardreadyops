import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateConfig } from "../../../../src/core/config.js";
import { runPipeline } from "../../../../src/core/pipeline.js";
import { loadStm32CubeMxContract } from "../../../../src/firmware/stm32cubemx.js";

const fixture = path.resolve("tests/fixtures/projects/firmware-contract-stm32cubemx");

describe("firmware.stm32cubemx-pin-contract", () => {
  it("accepts firmware STM32CubeMX project configuration", () => {
    expect(
      validateConfig({
        version: 1,
        firmware: { stm32cubemx: { project: "hardware/board.ioc", mcuDesignator: "U2" } },
        projects: [{ path: ".", firmware: { stm32cubemx: { project: "board.ioc" } } }],
      }),
    ).toEqual([]);
  });

  it("parses a STM32CubeMX .ioc file into a normalized contract", async () => {
    const result = await loadStm32CubeMxContract(path.join(fixture, "board-good.ioc"));
    expect(result.errors).toEqual([]);
    expect(result.document?.pins).toHaveLength(3);
    expect(result.document?.pins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ signal: "LED_STATUS", hardware: "U1.PA1" }),
        expect.objectContaining({ signal: "I2C_SDA", hardware: "U1.PA2" }),
        expect.objectContaining({ signal: "UART_TX", hardware: "U1.PB6" }),
      ]),
    );
  });

  it("respects custom mcu-designator when parsing .ioc files", async () => {
    const result = await loadStm32CubeMxContract(path.join(fixture, "board-good.ioc"), "U2");
    expect(result.errors).toEqual([]);
    expect(result.document?.pins[0]?.hardware).toMatch(/^U2\./);
  });

  it("reports an error when no GPIO_Label entries exist", async () => {
    const result = await loadStm32CubeMxContract(path.join(fixture, "board-no-labels.ioc"));
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("GPIO_Label");
  });

  it("skips when the firmware contract is not configured", async () => {
    const result = await runPipeline({
      path: fixture,
      failOn: "never",
      rules: ["firmware.stm32cubemx-pin-contract"],
      config: "disabled-contract.yml",
    });
    expect(result.findings).toEqual([]);
  });

  it("reports mismatched, extra, and missing pin assignments from .ioc", async () => {
    const result = await runPipeline({
      path: fixture,
      failOn: "never",
      rules: ["firmware.stm32cubemx-pin-contract"],
    });
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings.every((f) => f.ruleId === "firmware.stm32cubemx-pin-contract")).toBe(true);
  });

  it("supports rule-level .ioc file and mcu-designator config", async () => {
    const result = await runPipeline({
      path: fixture,
      failOn: "never",
      rules: ["firmware.stm32cubemx-pin-contract"],
      config: "rule-file-contract.yml",
    });
    expect(result.findings).toEqual([]);
  });

  it("passes when the .ioc file matches the pinmap", async () => {
    const result = await runPipeline({
      path: fixture,
      failOn: "never",
      rules: ["firmware.stm32cubemx-pin-contract"],
      config: "good-contract.yml",
    });
    expect(result.findings).toEqual([]);
  });
});
