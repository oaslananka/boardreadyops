import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseJobset } from "../../../src/kicad/jobset.js";
import { writeFixture } from "../rules/helpers.js";

describe("KiCad 10 jobset parser", () => {
  it("parses enabled KiCad jobset outputs", async () => {
    const root = await writeFixture({
      "board.kicad_jobset": JSON.stringify({
        jobs: [
          { type: "gerber", outputPath: "fab/board.gbr", enabled: true },
          { type: "step", output_path: "fab/board.step", enabled: false },
          { type: "pdf", output: "board.pdf", destinationPath: "fab", enabled: true },
        ],
      }),
    });

    const parsed = await parseJobset(path.join(root, "board.kicad_jobset"));

    expect(parsed.jobs).toEqual([
      { type: "gerber", outputPath: "fab/board.gbr", enabled: true },
      { type: "step", outputPath: "fab/board.step", enabled: false },
      { type: "pdf", outputPath: "board.pdf", destinationPath: "fab", enabled: true },
    ]);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("parses every job inside a grouped S-expression jobset", async () => {
    const root = await writeFixture({
      "board.kicad_jobset": `(kicad_jobset
        (jobs
          (job "Gerber Files" (destination "fab") (output "board.gbr"))
          (job drill (destination_path "fab") (output "board.drl") (enabled  false))
        )
      )`,
    });

    const parsed = await parseJobset(path.join(root, "board.kicad_jobset"));

    expect(parsed.jobs).toEqual([
      { type: "Gerber Files", outputPath: "board.gbr", destinationPath: "fab", enabled: true },
      { type: "drill", outputPath: "board.drl", destinationPath: "fab", enabled: false },
    ]);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("deduplicates identical jobs across multiple JSON job arrays", async () => {
    const root = await writeFixture({
      "board.kicad_jobset": JSON.stringify({
        groups: [
          {
            jobs: [
              { type: "gerber", outputPath: "fab/board.gbr", enabled: true },
              { type: "drill", outputPath: "fab/board.drl", enabled: true },
            ],
          },
          {
            jobs: [
              { type: "gerber", outputPath: "fab/board.gbr", enabled: true },
              { type: "step", outputPath: "fab/board.step", enabled: true },
            ],
          },
        ],
      }),
    });

    const parsed = await parseJobset(path.join(root, "board.kicad_jobset"));

    expect(parsed.jobs).toHaveLength(3);
    expect(parsed.jobs.filter((job) => job.type === "gerber")).toHaveLength(1);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("accepts the kind field alias in place of type", async () => {
    const root = await writeFixture({
      "board.kicad_jobset": JSON.stringify({
        jobs: [{ kind: "gerber", outputPath: "fab/board.gbr", enabled: true }],
      }),
    });

    const parsed = await parseJobset(path.join(root, "board.kicad_jobset"));

    expect(parsed.jobs).toEqual([{ type: "gerber", outputPath: "fab/board.gbr", enabled: true }]);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("accepts destination and output_directory as destinationPath aliases", async () => {
    const root = await writeFixture({
      "board.kicad_jobset": JSON.stringify({
        jobs: [
          { type: "gerber", outputPath: "board.gbr", destination: "fab", enabled: true },
          { type: "drill", outputPath: "board.drl", output_directory: "out", enabled: true },
        ],
      }),
    });

    const parsed = await parseJobset(path.join(root, "board.kicad_jobset"));

    expect(parsed.jobs[0]?.destinationPath).toBe("fab");
    expect(parsed.jobs[1]?.destinationPath).toBe("out");
    await fs.rm(root, { recursive: true, force: true });
  });

  it("skips S-expression jobs with no output path", async () => {
    const root = await writeFixture({
      "board.kicad_jobset": `(kicad_jobset
        (jobs
          (job "Gerber Files" (output "board.gbr"))
          (job "No Output")
        )
      )`,
    });

    const parsed = await parseJobset(path.join(root, "board.kicad_jobset"));

    expect(parsed.jobs).toHaveLength(1);
    expect(parsed.jobs[0]?.type).toBe("Gerber Files");
    expect(parsed.jobs[0]).not.toHaveProperty("destinationPath");
    await fs.rm(root, { recursive: true, force: true });
  });

  it("normalizes backslash path separators to forward slashes", async () => {
    const root = await writeFixture({
      "board.kicad_jobset": JSON.stringify({
        jobs: [{ type: "gerber", outputPath: "fab\\board.gbr", destinationPath: "output\\dir", enabled: true }],
      }),
    });

    const parsed = await parseJobset(path.join(root, "board.kicad_jobset"));

    expect(parsed.jobs[0]?.outputPath).toBe("fab/board.gbr");
    expect(parsed.jobs[0]?.destinationPath).toBe("output/dir");
    await fs.rm(root, { recursive: true, force: true });
  });

  it("treats jobs as enabled by default when the enabled field is absent", async () => {
    const root = await writeFixture({
      "board.kicad_jobset": JSON.stringify({
        jobs: [{ type: "gerber", outputPath: "fab/board.gbr" }],
      }),
    });

    const parsed = await parseJobset(path.join(root, "board.kicad_jobset"));

    expect(parsed.jobs[0]?.enabled).toBe(true);
    await fs.rm(root, { recursive: true, force: true });
  });
});
