import { describe, expect, it } from "vitest";
import { repositoriesRequiringReview } from "../../../apps/web/lib/dashboard-next-action.js";
import type { RepositoryGroup, RepositorySummary } from "../../../apps/web/lib/repository-dashboard.js";

const repo = (
  id: string,
  at: string | undefined,
  count: number,
  overrides: Partial<RepositorySummary> = {},
): RepositorySummary => ({
  id,
  installationId: "installation-1",
  githubInstallationId: 1,
  accountLogin: "hardware",
  owner: "hardware",
  name: id,
  private: false,
  latestRunId: `run-${id}`,
  latestRunStatus: "completed",
  latestRunDecision: "fail",
  latestRunAt: at,
  openFindings: count,
  watchedBoards: 0,
  openSupplyFindings: 0,
  ...overrides,
});
const groups = (...repositories: RepositorySummary[]): RepositoryGroup[] => [
  { accountLogin: "hardware", repositories },
];

describe("Dashboard next-action selection", () => {
  it("ranks recent unresolved latest runs ahead of older ones regardless of group order", () => {
    const older = repo("older", "2026-10-02T12:00:00Z", 200);
    const newer = repo("newer", "2026-10-15T12:00:00Z", 1);
    expect(repositoriesRequiringReview(groups(older, newer)).map((r) => r.id)).toEqual(["newer", "older"]);
    expect(repositoriesRequiringReview(groups(newer, older)).map((r) => r.id)).toEqual(["newer", "older"]);
  });

  it("uses owner/repository and id as stable tie-breakers, never finding count", () => {
    const a = repo("alpha", "2026-10-15T12:00:00Z", 1);
    const b = repo("beta", "2026-10-15T12:00:00Z", 100);
    expect(
      repositoriesRequiringReview([
        { accountLogin: "A", repositories: [b] },
        { accountLogin: "B", repositories: [a] },
      ]).map((r) => r.id),
    ).toEqual(["alpha", "beta"]);
  });

  it("does not present runs without findings, supply-only alerts or unconfigured repositories as an open finding", () => {
    const clean = repo("clean", "2026-10-15T12:00:00Z", 0);
    const supplyOnly = repo("supply-only", "2026-10-15T12:00:00Z", 0, { openSupplyFindings: 3 });
    const noRun = repo("unconfigured", undefined, 10, { latestRunId: undefined });
    expect(repositoriesRequiringReview(groups(clean, supplyOnly, noRun))).toEqual([]);
  });

  it("places dated runs ahead of missing/invalid dates and never relies on group ordering", () => {
    const dated = repo("dated", "2026-10-15T12:00:00Z", 1);
    const invalid = repo("invalid", "invalid date", 2);
    const absent = repo("absent", undefined, 3);
    expect(repositoriesRequiringReview(groups(invalid, dated, absent)).map((r) => r.id)).toEqual([
      "dated",
      "absent",
      "invalid",
    ]);
  });
});
