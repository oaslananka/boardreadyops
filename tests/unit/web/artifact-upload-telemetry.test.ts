import { describe, expect, it } from "vitest";
import { emitAmbiguousArtifactUploadTelemetry } from "../../../apps/web/lib/artifact-upload-telemetry.js";

const artifactId = "b7430a5f-1228-4eb2-95dd-fd5b57f8f4ca";

describe("ambiguous upload telemetry", () => {
  it("emits a bounded correlation event without storage paths, secrets, or exception text", () => {
    const lines: string[] = [];
    emitAmbiguousArtifactUploadTelemetry(artifactId, (line) => lines.push(line));
    expect(lines).toHaveLength(1);
    const event = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(event).toEqual({
      timestamp: expect.any(String),
      level: "error",
      component: "runner-artifact-uploads",
      event: "runner_artifact.upload_finalization_ambiguous",
      artifactId,
    });
    expect(lines[0]).not.toContain("cap=");
    expect(lines[0]).not.toContain("storagePath");
    expect(lines[0]).not.toContain("uploadToken");
  });

  it("never logs an unvalidated artifact identifier", () => {
    const lines: string[] = [];
    emitAmbiguousArtifactUploadTelemetry("token?cap=sensitive-secret", (line) => lines.push(line));
    expect(lines).toEqual([]);
  });

  it("a broken log sink cannot change the caller's failure behavior", () => {
    expect(() =>
      emitAmbiguousArtifactUploadTelemetry(artifactId, () => {
        throw new Error("sink closed");
      }),
    ).not.toThrow();
  });
});
