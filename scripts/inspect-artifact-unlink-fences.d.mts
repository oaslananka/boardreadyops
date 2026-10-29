export type FenceInventory = {
  status: "observed";
  unresolvedCount: number;
  oldestStartedAt: string | null;
};

export function inspectArtifactUnlinkFences(client: {
  query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
}): Promise<FenceInventory>;

export function classifyFenceInventoryFailure(
  error: unknown,
): "permission_denied" | "schema_unavailable" | "row_security_unverified" | "observation_failed";
