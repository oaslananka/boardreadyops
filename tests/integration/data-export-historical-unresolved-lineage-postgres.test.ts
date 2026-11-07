import { describe, expect, it } from "vitest";
import { assessHistoricalUserUnresolvedSourceLineage } from "../../packages/db/src/data-export-historical-unresolved-lineage.js";
import { createPgQueryExecutor } from "../../packages/db/src/pg-executor.js";
import { getPostgresTestConnectionString } from "../../scripts/postgres-test-contract.mjs";

const connectionString = getPostgresTestConnectionString();
const describeDb = connectionString ? describe : describe.skip;

describeDb("disposable PostgreSQL: 63-class structural FK lineage, no customer data", () => {
  it("reports the exact catalog-only classes without granting historic USER ownership or ZIP delivery", async () => {
    if (!connectionString) throw new Error("Disposable PostgreSQL is required");
    const db = createPgQueryExecutor({ connectionString });
    try {
      const report = await assessHistoricalUserUnresolvedSourceLineage(db);
      expect(report).toMatchObject({
        status: "structural-lineage-only-unapproved",
        reviewedClasses: 63,
        completeCustomerExport: false,
        customerDeliveryAllowed: false,
        originalUserOwnershipVerified: false,
        thirdPartyDisclosureRightsVerified: false,
        releaseDecision: "NO_GO",
      });
      expect(report?.entries).toHaveLength(63);
      // A deliberate 0126 schema review baseline: all 123 public FK edges,
      // but 29 of 63 unresolved tables have NO FK path to installations.
      expect(report?.fkCatalogEdges).toBe(123);
      expect(report?.pathToInstallationCount).toBe(34);
      expect(report?.noPathCount).toBe(29);
      const byTrack = (track: string) => {
        const entries = report?.entries.filter((entry) => entry.reviewTrack === track) ?? [];
        return {
          withPath: entries.filter((entry) => entry.installationPath !== null).length,
          withoutPath: entries.filter((entry) => entry.installationPath === null).length,
        };
      };
      expect(byTrack("privacy_lifecycle")).toEqual({ withPath: 4, withoutPath: 13 });
      expect(byTrack("billing_and_marketplace")).toEqual({ withPath: 0, withoutPath: 5 });
      expect(byTrack("hardware_and_release")).toEqual({ withPath: 19, withoutPath: 0 });
      expect(byTrack("collaboration_and_workspace")).toEqual({ withPath: 2, withoutPath: 8 });
      expect(byTrack("platform_operations")).toEqual({ withPath: 9, withoutPath: 3 });
      expect(report?.entries.find((entry) => entry.table === "data_exports")?.installationPath).toBeNull();
      expect(report?.entries.find((entry) => entry.table === "workspaces")?.installationPath).toBeNull();
      expect(report?.entries.find((entry) => entry.table === "boards")).toMatchObject({
        installationPath: ["boards", "repositories", "installations"],
        reportedPathUsesNonNullableFKs: true,
      });
      expect(report?.entries.find((entry) => entry.table === "manufacturing_share_authorizations")).toMatchObject({
        reportedPathUsesNonNullableFKs: false,
      });
      expect(report?.entries.find((entry) => entry.table === "installations")).toMatchObject({
        installationPath: ["installations"],
      });
      // Report only public schema names and FK structure, never actual rows.
      expect(report?.entries.every((entry) => entry.table.length <= 128)).toBe(true);
    } finally {
      await db.close();
    }
  });
});
