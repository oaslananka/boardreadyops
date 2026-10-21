import { describe, expect, it } from "vitest";
import {
  isUnattestedManufacturingArchive,
  releaseRunResultSchema,
  runnerArtifactDeclarationSchema,
} from "../../../packages/contracts/src/index.js";

const archive = {
  kind: "archive",
  name: "gerbers.zip",
  storagePath: "run/gerbers.zip",
  role: "manufacturing",
  sha256: "a".repeat(64),
  bytes: 152,
};

describe("untrusted manufacturing archive role boundary", () => {
  it("detects exactly the reserved archive role (including case/whitespace variants)", () => {
    expect(isUnattestedManufacturingArchive(archive)).toBe(true);
    expect(isUnattestedManufacturingArchive({ kind: " ARCHIVE ", role: " MANUFACTURING " })).toBe(true);
    expect(isUnattestedManufacturingArchive({ kind: "archive", role: "draft-manufacturing" })).toBe(false);
    expect(isUnattestedManufacturingArchive({ kind: "bom", role: "manufacturing" })).toBe(false);
  });

  it("rejects a claimed approved archive in signed runner results, while keeping genuine drafts", () => {
    const base = { status: "completed", decision: "pass", findings: [] };
    expect(releaseRunResultSchema.safeParse({ ...base, artifacts: [archive] }).success).toBe(false);
    expect(
      releaseRunResultSchema.safeParse({
        ...base,
        artifacts: [{ ...archive, role: "draft-manufacturing" }],
      }).success,
    ).toBe(true);
    expect(releaseRunResultSchema.safeParse({ ...base, artifacts: [{ ...archive, kind: "bom" }] }).success).toBe(true);
  });

  it("rejects the same role on runner capability declarations without removing draft uploads", () => {
    const { storagePath, ...declaration } = archive;
    expect(runnerArtifactDeclarationSchema.safeParse(declaration).success).toBe(false);
    expect(runnerArtifactDeclarationSchema.safeParse({ ...declaration, role: "draft-manufacturing" }).success).toBe(
      true,
    );
  });
});
