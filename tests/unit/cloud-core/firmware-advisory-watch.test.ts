import { describe, expect, it, vi } from "vitest";
import type { AdvisoryLookupOutcome, AdvisoryProvider } from "../../../packages/cloud-core/src/advisory-lookup.js";
import {
  constantAdvisoryProvider,
  type DueFirmwareScan,
  type FirmwareAdvisoryStore,
  runFirmwareAdvisoryPass,
} from "../../../packages/cloud-core/src/firmware-advisory-watch.js";

/**
 * The counters are the deliverable as much as the advisories are. "No advisories found across 40
 * components, 39 of which could not be looked up" is the honest sentence, and every test here
 * exists to stop the shorter one being reachable. See #804.
 */

const now = new Date("2026-09-15T12:00:00.000Z");

function scan(overrides: Partial<DueFirmwareScan> = {}): DueFirmwareScan {
  return {
    repositoryId: "repo-1",
    installationId: "install-1",
    repositoryFullName: "acme/gateway",
    snapshotId: "snap-1",
    commitSha: "abc123",
    scannable: [{ name: "idf", manifestPath: "fw/idf_component.yml", cpe: "cpe:2.3:a:espressif:esp-idf:5.2.1:*" }],
    dependencyCount: 1,
    ...overrides,
  };
}

type CompleteScanInput = Parameters<FirmwareAdvisoryStore["completeScan"]>[0];

function store(due: DueFirmwareScan[]) {
  const completeScan = vi.fn(async (_input: CompleteScanInput) => undefined);
  const claimDueScans = vi.fn(async (_now: Date, _limit: number) => due);
  return { store: { claimDueScans, completeScan } as FirmwareAdvisoryStore, completeScan, claimDueScans };
}

function provider(outcomes: { purl?: AdvisoryLookupOutcome; cpe?: AdvisoryLookupOutcome }): AdvisoryProvider {
  return {
    findByPurl: async () => outcomes.purl ?? { status: "answered", advisories: [] },
    findByCpe: async () => outcomes.cpe ?? { status: "answered", advisories: [] },
  };
}

const critical = {
  id: "CVE-2025-66409",
  aliases: [],
  severity: "CRITICAL",
  source: "nvd" as const,
  url: "https://nvd.nist.gov/vuln/detail/CVE-2025-66409",
};

describe("firmware advisory pass", () => {
  it("records no_provider rather than a clean result when lookups are not enabled", async () => {
    const { store: s, completeScan } = store([scan()]);

    const report = await runFirmwareAdvisoryPass(s, constantAdvisoryProvider(undefined), now);

    // This is the default deployment. Nothing looked at the repository, and the recorded outcome
    // has to say so -- an unconfigured control plane must not imply a checked fleet.
    expect(completeScan).toHaveBeenCalledWith(expect.objectContaining({ outcome: "no_provider" }));
    expect(report.repositoriesScanned).toBe(1);
    expect(report.dependenciesQueried).toBe(0);
    expect(report.advisoriesFound).toBe(0);
  });

  it("counts the components nobody can look up even when no provider is configured", async () => {
    const { store: s } = store([scan({ dependencyCount: 40, scannable: [] })]);

    const report = await runFirmwareAdvisoryPass(s, constantAdvisoryProvider(undefined), now);

    // The standing gap is the 39 that carry no usable identifier. A pass that only counted them
    // when a provider happened to be configured would hide the gap exactly when there is nothing
    // else to report.
    expect(report.dependenciesSkippedUnidentified).toBe(40);
  });

  it("finds a real advisory and reports it once", async () => {
    const { store: s, completeScan } = store([scan()]);
    const onAdvisoriesFound = vi.fn();

    const report = await runFirmwareAdvisoryPass(
      s,
      constantAdvisoryProvider(provider({ cpe: { status: "answered", advisories: [critical] } })),
      now,
      { onAdvisoriesFound },
    );

    expect(report.advisoriesFound).toBe(1);
    expect(report.dependenciesQueried).toBe(1);
    expect(onAdvisoriesFound).toHaveBeenCalledTimes(1);
    expect(completeScan).toHaveBeenCalledWith(expect.objectContaining({ outcome: "answered" }));
  });

  it("does not notify when the databases answered and found nothing", async () => {
    const { store: s, completeScan } = store([scan()]);
    const onAdvisoriesFound = vi.fn();

    await runFirmwareAdvisoryPass(s, constantAdvisoryProvider(provider({})), now, { onAdvisoriesFound });

    // A genuinely clean answer is worth recording and not worth a message.
    expect(onAdvisoriesFound).not.toHaveBeenCalled();
    expect(completeScan).toHaveBeenCalledWith(expect.objectContaining({ outcome: "answered" }));
  });

  it("records unavailable, not answered, when a lookup could not complete", async () => {
    const { store: s, completeScan } = store([scan()]);

    const report = await runFirmwareAdvisoryPass(
      s,
      constantAdvisoryProvider(provider({ cpe: { status: "unavailable", reason: "429 Too Many Requests" } })),
      now,
      {},
    );

    // A throttled pass that recorded "answered" would mark the fleet clean without asking it.
    expect(completeScan).toHaveBeenCalledWith(expect.objectContaining({ outcome: "unavailable" }));
    expect(report.unavailable).toBe(1);
    expect(report.advisoriesFound).toBe(0);
  });

  it("records rejected when the identifier itself was refused", async () => {
    const { store: s, completeScan } = store([scan()]);

    const report = await runFirmwareAdvisoryPass(
      s,
      constantAdvisoryProvider(provider({ cpe: { status: "rejected", reason: "404 Not Found" } })),
      now,
      {},
    );

    expect(completeScan).toHaveBeenCalledWith(expect.objectContaining({ outcome: "rejected" }));
    expect(report.rejected).toBe(1);
  });

  it("will not call a pass answered when one of two identifiers was refused", async () => {
    const { store: s, completeScan } = store([
      scan({
        scannable: [
          { name: "mcuboot", manifestPath: "fw/idf_component.yml", purl: "pkg:golang/github.com/mcu-tools/mcuboot" },
          { name: "idf", manifestPath: "fw/idf_component.yml", cpe: "cpe:2.3:a:espressif:esp-idf:5.2.1:*" },
        ],
        dependencyCount: 2,
      }),
    ]);

    const report = await runFirmwareAdvisoryPass(
      s,
      constantAdvisoryProvider(provider({ cpe: { status: "rejected", reason: "404" } })),
      now,
      {},
    );

    // One clean answer plus one refusal is not a clean pass. The gap is exactly what a reader
    // would otherwise never learn about.
    expect(completeScan).toHaveBeenCalledWith(expect.objectContaining({ outcome: "rejected" }));
    expect(report.dependenciesQueried).toBe(2);
    expect(report.rejected).toBe(1);
  });

  it("marks a dependency unanswered when its own lookup did not complete", async () => {
    const { store: s } = store([
      scan({
        scannable: [
          { name: "both", manifestPath: "fw/idf_component.yml", purl: "pkg:npm/x", cpe: "cpe:2.3:a:v:p:1.0:*" },
        ],
      }),
    ]);
    const onAdvisoriesFound = vi.fn();

    await runFirmwareAdvisoryPass(
      s,
      constantAdvisoryProvider(
        provider({ purl: { status: "answered", advisories: [critical] }, cpe: { status: "unavailable", reason: "x" } }),
      ),
      now,
      { onAdvisoriesFound },
    );

    // It found something, so it notifies -- but the dependency is flagged unanswered so a report
    // cannot claim the rest of its surface was checked.
    const [call] = onAdvisoriesFound.mock.calls;
    expect(call?.[0].results[0].answered).toBe(false);
    expect(call?.[0].results[0].advisories).toHaveLength(1);
  });

  it("reports nothing_searchable when a repository has no usable identifier at all", async () => {
    const { store: s, completeScan } = store([scan({ scannable: [], dependencyCount: 12 })]);

    const report = await runFirmwareAdvisoryPass(s, constantAdvisoryProvider(provider({})), now, {});

    // Distinct from "answered": nothing was searched, and the twelve are counted as the gap.
    expect(completeScan).toHaveBeenCalledWith(expect.objectContaining({ outcome: "nothing_searchable" }));
    expect(report.dependenciesSkippedUnidentified).toBe(12);
    expect(report.dependenciesQueried).toBe(0);
  });

  it("comes back sooner after an incomplete pass than after a complete one", async () => {
    const options = { intervalMs: 86_400_000, retryIntervalMs: 3_600_000 };

    const answered = store([scan()]);
    await runFirmwareAdvisoryPass(answered.store, constantAdvisoryProvider(provider({})), now, options);
    const unavailable = store([scan()]);
    await runFirmwareAdvisoryPass(
      unavailable.store,
      constantAdvisoryProvider(provider({ cpe: { status: "unavailable", reason: "x" } })),
      now,
      options,
    );

    // A transient outage must not cost a full interval of coverage.
    expect(answered.completeScan.mock.calls[0]?.[0].nextDueAt).toEqual(new Date(now.getTime() + 86_400_000));
    expect(unavailable.completeScan.mock.calls[0]?.[0].nextDueAt).toEqual(new Date(now.getTime() + 3_600_000));
  });

  it("keeps going past a failing repository, and records why", async () => {
    const onError = vi.fn();
    const { store: s, completeScan } = store([scan({ repositoryId: "repo-1" }), scan({ repositoryId: "repo-2" })]);
    let calls = 0;
    const flaky: AdvisoryProvider = {
      findByPurl: async () => ({ status: "answered", advisories: [] }),
      findByCpe: async () => {
        calls += 1;
        if (calls === 1) throw new Error("boom");
        return { status: "answered", advisories: [] };
      },
    };

    const report = await runFirmwareAdvisoryPass(s, constantAdvisoryProvider(flaky), now, { onError });

    // "Kept going" must never quietly mean "gave up", and an unrecorded failure would leave the
    // repository due forever with the reason invisible.
    expect(report.failures).toBe(1);
    expect(report.repositoriesScanned).toBe(1);
    expect(onError).toHaveBeenCalledWith("repo-1", expect.any(Error));
    expect(completeScan).toHaveBeenCalledWith(expect.objectContaining({ repositoryId: "repo-1", outcome: "failed" }));
    expect(completeScan).toHaveBeenCalledWith(expect.objectContaining({ repositoryId: "repo-2", outcome: "answered" }));
  });

  it("surfaces a failure to record a failure rather than swallowing it", async () => {
    const onError = vi.fn();
    const s: FirmwareAdvisoryStore = {
      claimDueScans: async () => [scan()],
      completeScan: async () => {
        throw new Error("write failed");
      },
    };

    const report = await runFirmwareAdvisoryPass(
      s,
      constantAdvisoryProvider({
        findByPurl: async () => ({ status: "answered", advisories: [] }),
        findByCpe: async () => {
          throw new Error("boom");
        },
      }),
      now,
      { onError },
    );

    expect(report.failures).toBe(1);
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it("claims nothing and reports zeroes when no repository is due", async () => {
    const { store: s, claimDueScans } = store([]);

    const report = await runFirmwareAdvisoryPass(s, constantAdvisoryProvider(provider({})), now, {
      maximumRepositoriesPerRun: 7,
    });

    expect(claimDueScans).toHaveBeenCalledWith(now, 7);
    expect(report).toEqual({
      repositoriesScanned: 0,
      dependenciesQueried: 0,
      dependenciesSkippedUnidentified: 0,
      advisoriesFound: 0,
      rejected: 0,
      unavailable: 0,
      failures: 0,
    });
  });
});
