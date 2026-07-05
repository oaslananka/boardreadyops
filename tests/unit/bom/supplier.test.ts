import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildSupplierIntelligenceSummary, createStaticSupplierProvider } from "../../../src/bom/supplier.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "brops-supplier-"));
  tempDirs.push(dir);
  return dir;
}

const SAMPLE_DB = {
  schemaVersion: 1,
  updatedAt: new Date().toISOString(),
  records: [
    {
      mpn: "TPS62840DLCT",
      manufacturer: "Texas Instruments",
      lifecycleStatus: "active",
      supplierCount: 5,
      available: true,
      alternates: ["TPS62840DLCR"],
      restrictedSubstances: false,
      complianceNotes: ["RoHS compliant"],
      leadTimeWeeks: 8,
      trust: "verified",
    },
    {
      mpn: "LM358DR",
      manufacturer: "Texas Instruments",
      lifecycleStatus: "nrnd",
      supplierCount: 2,
      available: true,
      trust: "estimated",
    },
  ],
};

describe("createStaticSupplierProvider", () => {
  it("returns matched records for known MPNs", async () => {
    const dir = await makeTempDir();
    const dbPath = path.join(dir, "supplier-db.json");
    await fs.writeFile(dbPath, JSON.stringify(SAMPLE_DB), "utf8");

    const provider = createStaticSupplierProvider({ dataFile: dbPath });
    const result = await provider.query({
      components: [
        { reference: "U1", mpn: "TPS62840DLCT" },
        { reference: "U2", mpn: "LM358DR" },
      ],
    });

    expect(result.records.size).toBe(2);
    expect(result.records.get("TPS62840DLCT")?.lifecycleStatus).toBe("active");
    expect(result.records.get("TPS62840DLCT")?.trust).toBe("verified");
    expect(result.records.get("LM358DR")?.lifecycleStatus).toBe("nrnd");
    expect(result.warnings).toHaveLength(0);
  });

  it("returns empty records for unknown MPNs", async () => {
    const dir = await makeTempDir();
    const dbPath = path.join(dir, "supplier-db.json");
    await fs.writeFile(dbPath, JSON.stringify(SAMPLE_DB), "utf8");

    const provider = createStaticSupplierProvider({ dataFile: dbPath });
    const result = await provider.query({
      components: [{ reference: "R1", mpn: "UNKNOWN-PART" }],
    });

    expect(result.records.size).toBe(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("is case-insensitive on MPN matching", async () => {
    const dir = await makeTempDir();
    const dbPath = path.join(dir, "supplier-db.json");
    await fs.writeFile(dbPath, JSON.stringify(SAMPLE_DB), "utf8");

    const provider = createStaticSupplierProvider({ dataFile: dbPath });
    const result = await provider.query({
      components: [{ reference: "U1", mpn: "tps62840dlct" }],
    });

    expect(result.records.get("TPS62840DLCT")).toBeDefined();
  });

  it("warns when database file is missing", async () => {
    const provider = createStaticSupplierProvider({ dataFile: "/nonexistent/supplier-db.json" });
    const result = await provider.query({ components: [{ reference: "R1", mpn: "ABC" }] });

    expect(result.records.size).toBe(0);
    expect((result.warnings ?? [])[0]).toContain("could not load");
  });

  it("warns when database is stale (> 90 days old)", async () => {
    const dir = await makeTempDir();
    const dbPath = path.join(dir, "supplier-db.json");
    const staleDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    await fs.writeFile(dbPath, JSON.stringify({ ...SAMPLE_DB, updatedAt: staleDate }), "utf8");

    const provider = createStaticSupplierProvider({ dataFile: dbPath });
    const result = await provider.query({ components: [{ reference: "U1", mpn: "TPS62840DLCT" }] });

    expect((result.warnings ?? []).join("\n")).toContain("consider refreshing");
  });
});

describe("buildSupplierIntelligenceSummary", () => {
  it("builds a summary from multiple results", () => {
    const result1 = {
      records: new Map([
        [
          "TPS62840DLCT",
          {
            mpn: "TPS62840DLCT",
            lifecycleStatus: "active" as const,
            available: true,
            trust: "verified" as const,
          },
        ],
      ]),
      queriedAt: new Date().toISOString(),
    };
    const result2 = {
      records: new Map([
        [
          "LM358DR",
          {
            mpn: "LM358DR",
            lifecycleStatus: "nrnd" as const,
            available: true,
            trust: "estimated" as const,
          },
        ],
      ]),
      queriedAt: new Date().toISOString(),
    };

    const summary = buildSupplierIntelligenceSummary([result1, result2], 2);

    expect(summary.providerCount).toBe(2);
    expect(summary.recordCount).toBe(2);
    expect(summary.freshness).toBe("fresh");
    const nrndComponent = summary.components.find((component) => component.mpn === "LM358DR");
    expect(nrndComponent?.warnings).toContain("lifecycle status: nrnd");
  });

  it("reports stale freshness when queriedAt is old", () => {
    const staleDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const result = {
      records: new Map([["ABC123", { mpn: "ABC123", trust: "verified" as const }]]),
      queriedAt: staleDate,
    };

    const summary = buildSupplierIntelligenceSummary([result], 1);
    expect(summary.freshness).toBe("stale");
  });
});
