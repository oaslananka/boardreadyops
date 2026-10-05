import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const guidePath = "docs/operations/production-outcome-pilot-validation.md";

describe("production outcome design-partner validation guide", () => {
  it("is registered in the docs navigation and linked from the pilot contract", async () => {
    const [mkdocs, pilot] = await Promise.all([
      readFile("mkdocs.yml", "utf8"),
      readFile("docs/production-outcomes.md", "utf8"),
    ]);

    expect(mkdocs).toContain("Production Outcome Pilot Validation: operations/production-outcome-pilot-validation.md");
    expect(pilot).toContain(
      "[Production outcome design-partner validation](operations/production-outcome-pilot-validation.md)",
    );
  });

  it("requires real external evidence rather than synthetic fixture completion", async () => {
    const guide = await readFile(guidePath, "utf8");

    expect(guide).toContain("real design-partner run");
    expect(guide).toContain("Do not close #450 because synthetic fixtures pass.");
    expect(guide).toContain("Real partner batch linked to the exact release");
    expect(guide).toContain("At least one useful production-risk workflow demonstrated");
  });

  it("locks immutable replay and provenance checks into the validation procedure", async () => {
    const guide = await readFile(guidePath, "utf8");

    expect(guide).toContain("A new immutable batch returns `201`");
    expect(guide).toContain("replay must return `200`");
    expect(guide).toContain("fail closed with `409`");
    expect(guide).toContain("source SHA-256");
    expect(guide).toContain("`runs:write`");
  });

  it("keeps customer data and causal claims outside the GitHub validation record", async () => {
    const guide = await readFile(guidePath, "utf8");

    expect(guide).toContain("Do not commit the partner CSV/JSON");
    expect(guide).toContain("No partner payload or credential committed to Git");
    expect(guide).toContain("No unsupported causal claim made");
    expect(guide).toContain("correlation does not establish causality");
  });
});
