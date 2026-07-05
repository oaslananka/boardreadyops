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

  it("uses custom name from options", async () => {
    const dir = await makeTempDir();
    const dbPath = path.join(dir, "db.json");
    await fs.writeFile(dbPath, JSON.stringify(SAMPLE_DB), "utf8");

    const provider = createStaticSupplierProvider({ dataFile: dbPath, name: "My Custom DB" });
    expect(provider.name).toBe("My Custom DB");
  });

  it("sets unverified trust default when record has no trust field", async () => {
    const dir = await makeTempDir();
    const dbPath = path.join(dir, "db.json");
    const db = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      records: [{ mpn: "NOTRUSTPART", manufacturer: "Acme" }],
    };
    await fs.writeFile(dbPath, JSON.stringify(db), "utf8");

    const provider = createStaticSupplierProvider({ dataFile: dbPath });
    const result = await provider.query({ components: [{ reference: "R1", mpn: "NOTRUSTPART" }] });

    expect(result.records.get("NOTRUSTPART")?.trust).toBe("unverified");
  });

  it("skips components without mpn when querying", async () => {
    const dir = await makeTempDir();
    const dbPath = path.join(dir, "db.json");
    await fs.writeFile(dbPath, JSON.stringify(SAMPLE_DB), "utf8");

    const provider = createStaticSupplierProvider({ dataFile: dbPath });
    const result = await provider.query({
      components: [{ reference: "R1" }, { reference: "U1", mpn: "TPS62840DLCT" }],
    });

    expect(result.records.size).toBe(1);
  });

  it("handles database with no updatedAt without warnings", async () => {
    const dir = await makeTempDir();
    const dbPath = path.join(dir, "db.json");
    const db = { schemaVersion: 1, records: [{ mpn: "SOMEPART", manufacturer: "Acme" }] };
    await fs.writeFile(dbPath, JSON.stringify(db), "utf8");

    const provider = createStaticSupplierProvider({ dataFile: dbPath });
    const result = await provider.query({ components: [{ reference: "R1", mpn: "SOMEPART" }] });

    expect(result.warnings).toHaveLength(0);
  });

  it("resolves a relative dataFile path against projectRoot", async () => {
    const dir = await makeTempDir();
    await fs.writeFile(path.join(dir, "db.json"), JSON.stringify(SAMPLE_DB), "utf8");

    const provider = createStaticSupplierProvider({ dataFile: "db.json" });
    const result = await provider.query({
      projectRoot: dir,
      components: [{ reference: "U1", mpn: "TPS62840DLCT" }],
    });

    expect(result.records.get("TPS62840DLCT")).toBeDefined();
  });

  it("uses process.cwd() when relative path given with no projectRoot", async () => {
    const dbName = `brops-test-${Date.now()}.json`;
    const dbPath = path.join(process.cwd(), dbName);
    await fs.writeFile(dbPath, JSON.stringify(SAMPLE_DB), "utf8");
    try {
      const provider = createStaticSupplierProvider({ dataFile: dbName });
      const result = await provider.query({ components: [{ reference: "U1", mpn: "TPS62840DLCT" }] });
      expect(result.records.get("TPS62840DLCT")).toBeDefined();
    } finally {
      await fs.unlink(dbPath).catch(() => {});
    }
  });

  it("wraps non-Error thrown exception in warning message", async () => {
    // Pass a dataFile that will cause JSON.parse to throw a non-Error (corrupted file)
    const dir = await makeTempDir();
    const dbPath = path.join(dir, "bad.json");
    await fs.writeFile(dbPath, "not valid json {{", "utf8");

    const provider = createStaticSupplierProvider({ dataFile: dbPath });
    const result = await provider.query({ components: [{ reference: "R1", mpn: "X" }] });

    // Should get a warning but not throw
    expect(result.warnings?.[0]).toContain("could not load");
  });

  it("handles database with no records field gracefully", async () => {
    const dir = await makeTempDir();
    const dbPath = path.join(dir, "empty.json");
    await fs.writeFile(dbPath, JSON.stringify({ schemaVersion: 1 }), "utf8");

    const provider = createStaticSupplierProvider({ dataFile: dbPath });
    const result = await provider.query({ components: [{ reference: "R1", mpn: "ANY" }] });

    expect(result.records.size).toBe(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("skips records with no mpn when building the index", async () => {
    const dir = await makeTempDir();
    const dbPath = path.join(dir, "db.json");
    const db = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      records: [
        { manufacturer: "Acme" }, // no mpn
        { mpn: "VALIDPART", manufacturer: "Acme", trust: "verified" },
      ],
    };
    await fs.writeFile(dbPath, JSON.stringify(db), "utf8");

    const provider = createStaticSupplierProvider({ dataFile: dbPath });
    const result = await provider.query({ components: [{ reference: "R1", mpn: "VALIDPART" }] });

    expect(result.records.get("VALIDPART")).toBeDefined();
    expect(result.records.size).toBe(1);
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

  it("reports unknown freshness when no queriedAt is available", () => {
    const result = {
      records: new Map([["ABC123", { mpn: "ABC123", trust: "verified" as const }]]),
    };

    const summary = buildSupplierIntelligenceSummary([result], 1);
    expect(summary.freshness).toBe("unknown");
  });

  it("includes restricted substances warning", () => {
    const result = {
      records: new Map([
        [
          "XYZ001",
          { mpn: "XYZ001", lifecycleStatus: "active" as const, restrictedSubstances: true, trust: "verified" as const },
        ],
      ]),
      queriedAt: new Date().toISOString(),
    };

    const summary = buildSupplierIntelligenceSummary([result], 1);
    const component = summary.components.find((c) => c.mpn === "XYZ001");
    expect(component?.warnings).toContain("restricted substances flag set");
  });

  it("prefers verified trust over unverified when merging providers", () => {
    const result1 = {
      records: new Map([
        ["ABC123", { mpn: "ABC123", trust: "unverified" as const, lifecycleStatus: "active" as const }],
      ]),
      queriedAt: new Date().toISOString(),
    };
    const result2 = {
      records: new Map([["ABC123", { mpn: "ABC123", trust: "verified" as const, lifecycleStatus: "active" as const }]]),
      queriedAt: new Date().toISOString(),
    };

    const summary = buildSupplierIntelligenceSummary([result1, result2], 2);
    const component = summary.components.find((c) => c.mpn === "ABC123");
    expect(component?.trust).toBe("verified");
  });

  it("propagates warnings from all results", () => {
    const result1 = {
      records: new Map<string, { mpn: string; trust: "verified" }>(),
      warnings: ["provider 1 warning"],
    };
    const result2 = {
      records: new Map<string, { mpn: string; trust: "verified" }>(),
      warnings: ["provider 2 warning"],
    };

    const summary = buildSupplierIntelligenceSummary([result1, result2], 2);
    expect(summary.warnings).toContain("provider 1 warning");
    expect(summary.warnings).toContain("provider 2 warning");
  });

  it("keeps existing record when new record has same or lower trust than existing", () => {
    // First result: verified record
    const result1 = {
      records: new Map([["ABC123", { mpn: "ABC123", trust: "verified" as const, lifecycleStatus: "active" as const }]]),
      queriedAt: new Date().toISOString(),
    };
    // Second result: also verified — should not replace (same level)
    const result2 = {
      records: new Map([["ABC123", { mpn: "ABC123", trust: "verified" as const, lifecycleStatus: "nrnd" as const }]]),
      queriedAt: new Date().toISOString(),
    };

    const summary = buildSupplierIntelligenceSummary([result1, result2], 2);
    // First verified record should be kept (result2 doesn't displace it since existing.trust IS "verified")
    const component = summary.components.find((c) => c.mpn === "ABC123");
    expect(component?.lifecycleStatus).toBe("active");
  });
});
