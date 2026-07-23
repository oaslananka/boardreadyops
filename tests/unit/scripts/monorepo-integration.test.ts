import { describe, expect, it } from "vitest";
import {
  buildKicadCliCandidates,
  buildMonorepoIntegrationPlan,
  isSupportedKicadVersion,
  TOOLCHAIN_DATABASE_URL,
} from "../../../scripts/run-monorepo-integration.mjs";
import { renderVerificationSummary } from "../../../scripts/verification-summary.mjs";

describe("complete monorepo integration", () => {
  it("always runs environment-independent integration tests and leaves PostgreSQL explicit", () => {
    const plan = buildMonorepoIntegrationPlan({ environment: {}, kicadAvailable: false });

    expect(plan.requiredTests).toContain("tests/integration/cli.test.ts");
    expect(plan.requiredTests.some((file) => file.includes("postgres"))).toBe(false);
    expect(plan.postgres).toEqual({ status: "environment-dependent" });
    expect(plan.kicad).toEqual({
      status: "skipped",
      detail: "environment-dependent: requires a supported kicad-cli",
    });
  });

  it("rejects PostgreSQL opt-in without a real disposable database URL", () => {
    expect(() =>
      buildMonorepoIntegrationPlan({
        environment: { BOARDREADYOPS_POSTGRES_TESTS: "true" },
        kicadAvailable: false,
      }),
    ).toThrow(/DATABASE_URL/u);

    expect(() =>
      buildMonorepoIntegrationPlan({
        environment: {
          BOARDREADYOPS_POSTGRES_TESTS: "true",
          DATABASE_URL: TOOLCHAIN_DATABASE_URL,
        },
        kicadAvailable: false,
      }),
    ).toThrow(/placeholder/u);
  });

  it("uses the same explicit PostgreSQL contract for local and CI execution", () => {
    const plan = buildMonorepoIntegrationPlan({
      environment: {
        BOARDREADYOPS_POSTGRES_TESTS: "true",
        DATABASE_URL: "postgresql://boardreadyops@127.0.0.1:5432/boardreadyops_test",
      },
      kicadAvailable: true,
    });

    expect(plan.postgres.status).toBe("tested");
    expect(plan.postgresTests).toContain("tests/integration/control-plane-job-store-postgres.test.ts");
    expect(plan.kicad.status).toBe("tested");
  });

  it("uses only fixed absolute KiCad CLI paths", () => {
    expect(buildKicadCliCandidates({ environment: {}, platform: "linux" })).toEqual(["/usr/bin/kicad-cli"]);
    expect(
      buildKicadCliCandidates({
        environment: { BOARDREADYOPS_KICAD_CLI: "/opt/kicad/bin/kicad-cli" },
        platform: "linux",
      }),
    ).toEqual(["/opt/kicad/bin/kicad-cli"]);
    expect(() =>
      buildKicadCliCandidates({
        environment: { BOARDREADYOPS_KICAD_CLI: "kicad-cli" },
        platform: "linux",
      }),
    ).toThrow(/absolute/u);
  });

  it("reports KiCad as tested only for supported major versions", () => {
    expect(isSupportedKicadVersion("10.0.2")).toBe(true);
    expect(isSupportedKicadVersion("9.0.5")).toBe(true);
    expect(isSupportedKicadVersion("11.0.0")).toBe(false);
    expect(isSupportedKicadVersion("not installed")).toBe(false);
  });

  it("renders the final summary from recorded integration status", () => {
    const markdown = renderVerificationSummary({
      required: { status: "tested", detail: "8 files" },
      postgres: { status: "environment-dependent" },
      kicad: { status: "skipped", detail: "environment-dependent: requires a supported kicad-cli" },
    });

    expect(markdown).toContain("| Required integration | tested | 8 files |");
    expect(markdown).toContain("| PostgreSQL integration | environment-dependent |");
    expect(markdown).toContain("| KiCad integration | skipped | environment-dependent:");
  });
});
