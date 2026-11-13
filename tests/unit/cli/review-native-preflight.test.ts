import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reviewPublishCommand } from "../../../src/cli/commands/review.js";
import { generateSnapshots } from "../../../src/kicad/snapshots.js";

vi.mock("../../../src/kicad/snapshots.js", () => ({ generateSnapshots: vi.fn() }));
const mockSnapshots = vi.mocked(generateSnapshots);
const fixtureRoot = path.resolve("tests/fixtures/projects/safe-basic");

function collect() {
  const output: string[] = [];
  return {
    stream: {
      write: (chunk: string) => {
        output.push(chunk);
        return true;
      },
    } as NodeJS.WritableStream,
    text: () => output.join(""),
  };
}

beforeEach(() => {
  mockSnapshots.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("opted-in Review native preview", () => {
  it("fails closed before a dry-run success when KiCad returned only illustrative summaries", async () => {
    mockSnapshots.mockResolvedValue([
      { id: "summary", kind: "pcb_layer", name: "pcb_F_Cu.svg" } as never,
      { id: "summary-sch", kind: "schematic", name: "schematic_sheet.svg" } as never,
    ]);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const stdout = collect();
    const stderr = collect();
    const code = await reviewPublishCommand(
      fixtureRoot,
      { dryRun: true, nativeVisuals: true, format: "json", repo: "sample/repo", rule: [] },
      { stdout: stdout.stream, stderr: stderr.stream },
    );
    expect(code).toBe(1);
    expect(stdout.text()).toBe("");
    expect(stderr.text()).toContain("Native visual preflight failed");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("renders a preflight with real-native-only names and shows both view counts without a network call", async () => {
    mockSnapshots.mockResolvedValue([
      { id: "pcb", kind: "pcb_layer", name: "kicad_native_F_Cu.svg" } as never,
      { id: "sch", kind: "schematic", name: "kicad_native_sheet.svg" } as never,
    ]);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const stdout = collect();
    const stderr = collect();
    const code = await reviewPublishCommand(
      fixtureRoot,
      { dryRun: true, nativeVisuals: true, repo: "sample/repo", rule: [] },
      { stdout: stdout.stream, stderr: stderr.stream },
    );
    expect(code, stderr.text()).toBe(0);
    expect(stdout.text()).toContain("Verified KiCad artwork: 1 PCB layers, 1 schematic sheets");
    expect(mockSnapshots).toHaveBeenCalledOnce();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps ordinary metadata-only dry runs fast without exporting source artwork", async () => {
    const stdout = collect();
    const stderr = collect();
    const code = await reviewPublishCommand(
      fixtureRoot,
      { dryRun: true, format: "json", repo: "sample/repo", rule: [] },
      { stdout: stdout.stream, stderr: stderr.stream },
    );
    expect(code).toBe(0);
    expect(JSON.parse(stdout.text())).toMatchObject({ success: true, dryRun: true });
    expect(mockSnapshots).not.toHaveBeenCalled();
  });
});
