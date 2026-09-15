import { describe, expect, it } from "vitest";
import { listVendorProfiles, resolveVendorProfile, vendorProfileAssurance } from "../../../src/vendor/profiles.js";

/**
 * A profile is nine numbers in a TypeScript file until it says where they came from and when
 * somebody last checked. #754's argument is that a stale profile which looks authoritative is
 * worse than an honest one, so the assertions here are mostly about the product refusing to claim
 * more than it knows.
 */

describe("vendor profile provenance", () => {
  it("gives every shipped profile a provenance record", () => {
    const profiles = listVendorProfiles();
    expect(profiles.length).toBeGreaterThan(0);

    for (const profile of profiles) {
      expect(profile.provenance, profile.id).toBeDefined();
      expect(profile.provenance.revision, profile.id).toBeTruthy();
    }
  });

  it("does not claim a verification that nobody performed", () => {
    for (const profile of listVendorProfiles()) {
      // Every value in this file was typed from a vendor page at a point nobody recorded. Writing
      // a `verifiedAt` would fabricate the record the type exists to provide, so these must stay
      // unverified until a person and a date are attached to each one.
      expect(profile.provenance.confidence, profile.id).toBe("unverified");
      expect(profile.provenance.verifiedAt, profile.id).toBeUndefined();
      expect(profile.provenance.verifiedBy, profile.id).toBeUndefined();
    }
  });

  it("refuses to let an unverified profile block a release", () => {
    for (const profile of listVendorProfiles()) {
      const assurance = vendorProfileAssurance(profile);
      expect(assurance.state, profile.id).toBe("unverified");
      expect(assurance.mayBlock, profile.id).toBe(false);
    }
  });

  describe("assurance", () => {
    const base = listVendorProfiles()[0];

    function withProvenance(provenance: Partial<NonNullable<typeof base>["provenance"]>) {
      if (!base) throw new Error("no vendor profiles are registered");
      return { ...base, provenance: { ...base.provenance, ...provenance } };
    }

    const now = new Date("2026-09-15T00:00:00.000Z");

    it("lets a freshly verified profile block", () => {
      const assurance = vendorProfileAssurance(
        withProvenance({ confidence: "verified", verifiedAt: "2026-09-01", verifiedBy: "oaslananka" }),
        now,
      );

      expect(assurance).toEqual({ state: "verified", ageDays: 14, mayBlock: true });
    });

    it("stops a lapsed profile blocking, without discarding it", () => {
      const assurance = vendorProfileAssurance(
        withProvenance({ confidence: "verified", verifiedAt: "2025-09-01", verifiedBy: "oaslananka" }),
        now,
      );

      // Still usable and still reported -- the age is the point, so a reviewer can see that the
      // limit they are being held to was last checked a year ago.
      expect(assurance.state).toBe("stale");
      expect(assurance.mayBlock).toBe(false);
      expect(assurance.state === "stale" && assurance.ageDays).toBeGreaterThan(300);
    });

    it("treats a verification date with nobody attached as no verification", () => {
      const assurance = vendorProfileAssurance(
        withProvenance({ confidence: "verified", verifiedAt: "2026-09-01" }),
        now,
      );

      // "Verified" with no verifier is a claim with no author behind it.
      expect(assurance).toEqual({ state: "unverified", mayBlock: false });
    });

    it("treats an unparseable date as no verification rather than as very old", () => {
      const assurance = vendorProfileAssurance(
        withProvenance({ confidence: "verified", verifiedAt: "last Tuesday", verifiedBy: "oaslananka" }),
        now,
      );

      // Reading it as epoch zero would report an age of twenty thousand days, which looks like a
      // measurement of something.
      expect(assurance).toEqual({ state: "unverified", mayBlock: false });
    });

    it("lets a derived profile block once it carries a date and a verifier", () => {
      const assurance = vendorProfileAssurance(
        withProvenance({ confidence: "derived", verifiedAt: "2026-09-10", verifiedBy: "outcome-ingest" }),
        now,
      );

      // A capability learned from accepted and rejected packages is evidence about this vendor,
      // not a guess -- which is the direction #754 wants profiles to move.
      expect(assurance.mayBlock).toBe(true);
    });
  });

  it("carries provenance through a resolved profile rather than defaulting it", () => {
    const resolved = resolveVendorProfile({ profile: "jlcpcb" });

    // The clone used to hardcode the unverified default, which would have thrown away a real
    // verification record every time a profile was resolved.
    expect(resolved?.profile.provenance).toEqual(
      listVendorProfiles().find((profile) => profile.id === "jlcpcb")?.provenance,
    );
  });
});
