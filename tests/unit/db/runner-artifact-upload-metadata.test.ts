import { describe, expect, it, vi } from "vitest";
import { createSqlRunnerArtifactStore } from "../../../packages/db/src/runner-artifact-store.js";

const id = "e81ec5a4-c6d0-4d87-a520-f7ab922ba183";
const lease = "5422e4e1-778f-4819-8314-fae19d8b9991";
const attempt = "11e46ec0-2048-49c7-99e1-f77965218f0b";
const row = {
  outcome: "accepted",
  run_id: id,
  lease_id: lease,
  execution_attempt_id: attempt,
  storage_path: `${id}/${attempt}/${id}.bin`,
  declared_bytes: 42,
  expected_sha256: "a".repeat(64),
};

function storeFor(override: Record<string, unknown> = {}) {
  const query = vi.fn().mockResolvedValue({ rows: [{ ...row, ...override }] });
  return createSqlRunnerArtifactStore({ query });
}

const input = { artifactId: id, uploadToken: "A".repeat(43) };

describe("runner artifact upload metadata", () => {
  it("accepts valid persisted capability data", async () => {
    await expect(storeFor().beginUpload(input)).resolves.toMatchObject({
      status: "accepted",
      artifactId: id,
      runId: id,
      leaseId: lease,
      declaredBytes: 42,
    });
  });

  it.each([
    ["traversal", { storage_path: "../escape.bin" }],
    ["absolute", { storage_path: "/escape.bin" }],
    ["invalid run identity", { run_id: "not-a-uuid" }],
    ["negative size", { declared_bytes: -1 }],
    ["oversized size", { declared_bytes: 2_147_483_648 }],
    ["invalid digest", { expected_sha256: "invalid" }],
  ])("rejects %s from persisted upload metadata", async (_name, override) => {
    await expect(storeFor(override).beginUpload(input)).rejects.toThrow(
      "artifact upload begin returned incomplete capability metadata",
    );
  });
});
