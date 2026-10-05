import { describe, expect, it } from "vitest";
import { requiredAgentFiles, verifyAgentInstructions } from "../../../scripts/verify-agent-instructions.mjs";

describe("verify-agent-instructions", () => {
  it("accepts the repository agent instruction hierarchy", async () => {
    await expect(verifyAgentInstructions()).resolves.toEqual({ files: requiredAgentFiles.length });
  });
});
