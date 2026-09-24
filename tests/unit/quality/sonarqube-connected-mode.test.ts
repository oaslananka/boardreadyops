import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const connectedModePath = fileURLToPath(new URL("../../../.sonarlint/connectedMode.json", import.meta.url));

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readConnectedMode(): Promise<string> {
  try {
    return await readFile(connectedModePath, "utf8");
  } catch (error) {
    expect.fail(`.sonarlint/connectedMode.json must exist and be readable: ${errorMessage(error)}`);
  }
}

describe("SonarQube Connected Mode binding", () => {
  it("matches the BoardReadyOps repository binding", async () => {
    const source = await readConnectedMode();
    let config: unknown;

    try {
      config = JSON.parse(source);
    } catch (error) {
      expect.fail(`.sonarlint/connectedMode.json must contain valid JSON: ${errorMessage(error)}`);
    }

    expect(
      config,
      ".sonarlint/connectedMode.json does not match the BoardReadyOps Connected Mode binding",
    ).toMatchObject({
      sonarCloudOrganization: "oaslananka",
      projectKey: "oaslananka_boardreadyops",
      region: "EU",
    });
  });
});
