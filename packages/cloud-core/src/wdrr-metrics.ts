export type WdrrInput = {
  baseRunId?: string;
  headRunId: string;
  requiredChecksComplete: boolean;
  blockerFindingsResolved: boolean;
  requiredApprovalsPresent: boolean;
  evidenceRecordProduced: boolean;
};

export function isWdrrReady(input: WdrrInput): boolean {
  return (
    Boolean(input.baseRunId) &&
    Boolean(input.headRunId) &&
    input.requiredChecksComplete === true &&
    input.blockerFindingsResolved === true &&
    input.requiredApprovalsPresent === true &&
    input.evidenceRecordProduced === true
  );
}

export type WdrrWeeklyCount = {
  weekStart: string;
  count: number;
};

export function computeWdrrWeekly(reviews: Array<{ createdAt: string; wdrrReady: boolean }>): WdrrWeeklyCount[] {
  const buckets = new Map<string, number>();
  for (const r of reviews) {
    if (!r.wdrrReady) continue;
    const d = new Date(r.createdAt);
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = monday.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    monday.setUTCDate(monday.getUTCDate() + diff);
    const key = monday.toISOString().slice(0, 10);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, count]) => ({ weekStart, count }));
}

export const allowedProductEvents = new Set([
  "local_run_succeeded",
  "cloud_review_created",
  "review_second_user_acted",
  "finding_dispositioned",
  "review_approved",
  "review_changes_requested",
  "evidence_pack_created",
  "external_review_opened",
  "trial_started",
  "subscription_activated",
  "subscription_downgraded",
  "data_export_completed",
]);

export function sanitizeProductEventPayload(payload: Record<string, unknown>): Record<string, unknown> {
  // Remove any PII or design content before storage
  const forbidden = new Set(["email", "findingMessage", "commentBody", "sourcePath", "token", "secret"]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (forbidden.has(k)) continue;
    if (typeof v === "string" && v.includes("@") && v.includes(".")) continue; // naive email filter
    out[k] = v;
  }
  return out;
}
