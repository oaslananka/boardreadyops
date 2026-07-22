import { describe, expect, it } from "vitest";
import {
  findControlPlaneWorkerBoundaryViolations,
  verifyControlPlaneWorkerBoundary,
} from "../../../scripts/verify-control-plane-worker-boundary.mjs";

function metafile(inputs: string[], imports: string[] = []) {
  return {
    inputs: Object.fromEntries(inputs.map((path) => [path, { bytes: 1, imports: [] }])),
    outputs: {
      "apps/web/.next/worker.mjs": {
        bytes: 1,
        inputs: Object.fromEntries(inputs.map((path) => [path, { bytesInOutput: 1 }])),
        imports: imports.map((path) => ({ path, kind: "import-statement", external: true })),
        exports: [],
        entryPoint: "apps/web/worker.ts",
      },
    },
  };
}

describe("control-plane worker bundle boundary", () => {
  it("accepts orchestration-only database and GitHub client modules", () => {
    const metadata = metafile([
      "apps/web/worker.ts",
      "apps/web/lib/control-plane-worker.ts",
      "apps/web/lib/control-plane-outbox-worker.ts",
      "packages/cloud-core/src/durable-lifecycle-planner.ts",
      "packages/db/src/control-plane-job-store.ts",
    ]);

    expect(findControlPlaneWorkerBoundaryViolations(metadata)).toEqual([]);
    expect(() => verifyControlPlaneWorkerBoundary(metadata)).not.toThrow();
  });

  it.each([
    "src/kicad/runner.ts",
    "src/runner/job-executor.ts",
    "src/repository-checkout.ts",
    "src/source-workspace/materialize.ts",
    "packages/core/src/kicad.ts",
  ])("rejects execution-plane input %s", (forbiddenInput) => {
    const metadata = metafile(["apps/web/worker.ts", forbiddenInput]);

    expect(findControlPlaneWorkerBoundaryViolations(metadata)).toEqual([forbiddenInput]);
    expect(() => verifyControlPlaneWorkerBoundary(metadata)).toThrow(forbiddenInput);
  });

  it.each(["node:child_process", "child_process"])("rejects command-execution import %s", (forbiddenImport) => {
    const metadata = metafile(["apps/web/worker.ts"], [forbiddenImport]);

    expect(findControlPlaneWorkerBoundaryViolations(metadata)).toEqual([forbiddenImport]);
    expect(() => verifyControlPlaneWorkerBoundary(metadata)).toThrow(forbiddenImport);
  });
});
