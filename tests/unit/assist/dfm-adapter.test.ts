import { describe, expect, it } from "vitest";
import { InMemoryDfmAdapter } from "../../../packages/cloud-core/src/assist/dfm-adapter.js";

describe("InMemoryDfmAdapter", () => {
  it("submits a review artifact for DFM analysis with recorded provenance", async () => {
    const adapter = new InMemoryDfmAdapter();
    const submission = await adapter.submit({
      tenantId: "tenant-a",
      reviewId: "rev-1",
      vendor: "valor",
      artifactKey: "artifact-1",
      profile: "standard-2layer",
    });

    expect(submission.status).toBe("pending");
    expect(submission.provenance).toEqual({ vendor: "valor", profile: "standard-2layer", version: "1.0" });
  });

  it("returns null for a submission id that does not exist", async () => {
    const adapter = new InMemoryDfmAdapter();
    await expect(adapter.getStatus("tenant-a", "missing")).resolves.toBeNull();
  });

  it("looks up a previously submitted job by id", async () => {
    const adapter = new InMemoryDfmAdapter();
    const submission = await adapter.submit({
      tenantId: "tenant-a",
      reviewId: "rev-1",
      vendor: "generic",
      artifactKey: "artifact-1",
      profile: "standard-2layer",
    });
    await expect(adapter.getStatus("tenant-a", submission.id)).resolves.toMatchObject({ id: submission.id });
  });

  it("always requires human review, even for a submission reported as passed", () => {
    const adapter = new InMemoryDfmAdapter();
    expect(
      adapter.requiresHumanReview({
        id: "dfm-1",
        tenantId: "tenant-a",
        reviewId: "rev-1",
        vendor: "valor",
        artifactKey: "artifact-1",
        status: "passed",
        provenance: { vendor: "valor", profile: "standard-2layer", version: "1.0" },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    ).toBe(true);
  });
});
