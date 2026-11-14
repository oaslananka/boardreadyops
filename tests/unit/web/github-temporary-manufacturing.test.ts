import { describe, expect, it } from "vitest";
import {
  matchesTemporaryManufacturingArtifact,
  temporaryManufacturingArtifactReference,
  temporaryManufacturingDownloadUrl,
  temporaryManufacturingExpiresAt,
  temporaryManufacturingStoragePath,
} from "../../../apps/web/lib/github-temporary-manufacturing.js";

const expected = {
  runId: "5dc4193b-5c7e-4df8-b86f-e4d3266fc22d",
  executionAttemptId: "7559e99b-4998-4e02-a94a-7a7a4686ae11",
  githubRunId: "29121986402",
  repositoryId: "987654321",
};

const valid = {
  id: 54321,
  name: ["boardreadyops-manufacturing", expected.runId, expected.executionAttemptId].join("-"),
  expired: false,
  expires_at: "2026-11-17T00:00:00.000Z",
  workflow_run: { id: 29121986402, repository_id: 987654321 },
};

describe("temporary manufacturing archive references", () => {
  it("builds only bounded, numeric GitHub Actions locators", () => {
    const path = temporaryManufacturingStoragePath("29121986402", "54321");
    expect(path).toBe("github-actions/29121986402/54321");
    expect(temporaryManufacturingArtifactReference(path ?? "")).toEqual({
      runId: "29121986402",
      artifactId: "54321",
    });
    expect(temporaryManufacturingDownloadUrl("octo-org/hardware-board", path ?? "")).toBe(
      "https://github.com/octo-org/hardware-board/actions/runs/29121986402/artifacts/54321",
    );
    expect(temporaryManufacturingStoragePath("bad", "54321")).toBeUndefined();
    expect(temporaryManufacturingArtifactReference("../github-actions/29121986402/54321")).toBeUndefined();
    expect(temporaryManufacturingDownloadUrl("octo-org/../outside", path ?? "")).toBeUndefined();
  });

  it("expires 72 hours after upload and denies malformed dates", () => {
    expect(temporaryManufacturingExpiresAt("2026-11-03T12:00:00.000Z")).toBe("2026-11-06T12:00:00.000Z");
    expect(temporaryManufacturingExpiresAt("invalid")).toBeUndefined();
  });

  it("requires exact repository, run, artifact ID and unexpired metadata", () => {
    const now = Date.parse("2026-11-14T00:00:00Z");
    expect(matchesTemporaryManufacturingArtifact(valid, expected, "54321", now)).toBe(true);
    expect(matchesTemporaryManufacturingArtifact(valid, expected, "54322", now)).toBe(false);
    expect(matchesTemporaryManufacturingArtifact({ ...valid, expired: true }, expected, "54321", now)).toBe(false);
    expect(
      matchesTemporaryManufacturingArtifact(
        { ...valid, workflow_run: { id: 29121986403, repository_id: 987654321 } },
        expected,
        "54321",
        now,
      ),
    ).toBe(false);
    expect(
      matchesTemporaryManufacturingArtifact(
        { ...valid, workflow_run: { id: 29121986402, repository_id: 123 } },
        expected,
        "54321",
        now,
      ),
    ).toBe(false);
    expect(matchesTemporaryManufacturingArtifact(valid, expected, "54321", Date.parse("2026-11-18T00:00:00Z"))).toBe(
      false,
    );
    expect(matchesTemporaryManufacturingArtifact(null, expected, "54321", now)).toBe(false);
  });
});
