import { describe, expect, it, vi } from "vitest";
import { createSqlBoardBomStore } from "../../../packages/db/src/board-bom-store.js";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";

const installationId = "11111111-1111-4111-8111-111111111111";
const boardId = "22222222-2222-4222-8222-222222222222";
const repositoryId = "33333333-3333-4333-8333-333333333333";
const snapshotId = "44444444-4444-4444-8444-444444444444";

function executor(rows: Record<string, unknown>[]) {
  const query = vi.fn(async () => ({ rows }));
  return { store: createSqlBoardBomStore({ query } as unknown as SqlQueryExecutor), query };
}

describe("board BOM store: findBoardsByMpn", () => {
  it("returns matching boards with their current-snapshot components", async () => {
    const capturedAt = new Date("2026-06-22T00:00:00.000Z");
    const { store, query } = executor([
      {
        board_id: boardId,
        repository_id: repositoryId,
        project_path: "hardware/mainboard/mainboard.kicad_pro",
        display_name: "mainboard",
        snapshot_id: snapshotId,
        captured_at: capturedAt,
        matches: [
          { reference: "U1", mpn: "STM32F103C8T6", manufacturer: "ST", quantity: 1 },
          { reference: "U5", mpn: "STM32F103C8T6", manufacturer: "ST", quantity: 1 },
        ],
      },
    ]);

    const results = await store.findBoardsByMpn(installationId, "STM32F103C8T6");

    expect(results).toEqual([
      {
        boardId,
        repositoryId,
        projectPath: "hardware/mainboard/mainboard.kicad_pro",
        displayName: "mainboard",
        snapshotId,
        capturedAt: capturedAt.toISOString(),
        matches: [
          { reference: "U1", mpn: "STM32F103C8T6", manufacturer: "ST", quantity: 1 },
          { reference: "U5", mpn: "STM32F103C8T6", manufacturer: "ST", quantity: 1 },
        ],
      },
    ]);

    expect(query).toHaveBeenCalledWith(expect.stringContaining("lower(component.mpn) = lower($2)"), [
      installationId,
      "STM32F103C8T6",
    ]);
  });

  it("trims the MPN before querying and returns nothing for a blank MPN without hitting the database", async () => {
    const { store, query } = executor([]);

    const results = await store.findBoardsByMpn(installationId, "   ");

    expect(results).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it("parses a JSON-string matches column the same as a native jsonb array", async () => {
    const capturedAt = new Date("2026-06-22T00:00:00.000Z");
    const { store } = executor([
      {
        board_id: boardId,
        repository_id: repositoryId,
        project_path: "hardware/sensor/sensor.kicad_pro",
        display_name: "sensor",
        snapshot_id: snapshotId,
        captured_at: capturedAt,
        matches: JSON.stringify([{ reference: "U2", mpn: "ADS1115", manufacturer: null, quantity: null }]),
      },
    ]);

    const results = await store.findBoardsByMpn(installationId, "ADS1115");

    expect(results[0]?.matches).toEqual([
      { reference: "U2", mpn: "ADS1115", manufacturer: undefined, quantity: undefined },
    ]);
  });

  it("returns an empty array when no board's current snapshot references the MPN", async () => {
    const { store } = executor([]);

    const results = await store.findBoardsByMpn(installationId, "UNKNOWN-PART");

    expect(results).toEqual([]);
  });
});
