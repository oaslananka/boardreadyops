export function reconcileBranchProtection(
  desired: unknown,
  api: (endpoint: string, body?: unknown) => unknown,
  apply?: boolean,
): "aligned" | "stale-review-drift" | "updated";
