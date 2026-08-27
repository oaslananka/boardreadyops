import { describe, expect, it } from "vitest";

describe("Performance and scale envelope", () => {
  it("handles 10k findings virtualized payload within budget", () => {
    const findings = Array.from({ length: 10_000 }, (_, i) => ({
      fingerprint: i.toString(16).padStart(64, "0"),
      ruleId: `rule.${i % 100}`,
      severity: (["error", "high", "medium", "low", "info"] as const)[i % 5] as string,
      message: `Finding ${i}`,
      diffState: (["new", "persistent", "regressed", "resolved"] as const)[i % 4],
    }));

    const start = performance.now();
    // Simulate filtering 10k findings by severity
    const filtered = findings.filter((f) => f.severity === "error");
    const sorted = filtered.sort((a, b) => a.ruleId.localeCompare(b.ruleId));
    const duration = performance.now() - start;

    expect(filtered.length).toBeGreaterThan(0);
    expect(sorted.length).toBe(filtered.length);
    // Local filter/sort should be <100ms per spec
    expect(duration).toBeLessThan(100);
  });

  it("evidence digest remains deterministic at scale", async () => {
    const { calculateEvidenceDigest } = await import("@boardreadyops/cloud-core");
    const manifest = Array.from({ length: 100 }, (_, i) => ({
      name: `file${i}.json`,
      path: `artifacts/file${i}.json`,
      type: "report",
      sizeBytes: 1024,
      sha256: i.toString(16).padStart(64, "0"),
    }));
    const digest1 = calculateEvidenceDigest({ manifest, decisions: [], approvals: [], checklist: [] });
    const digest2 = calculateEvidenceDigest({
      manifest: [...manifest].reverse(),
      decisions: [],
      approvals: [],
      checklist: [],
    });
    expect(digest1).toBe(digest2);
    expect(digest1).toMatch(/^[0-9a-f]{64}$/);
  });
});
