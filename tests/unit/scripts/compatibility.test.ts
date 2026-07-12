import { readFile } from "node:fs/promises";
import * as yaml from "js-yaml";
import { describe, expect, it } from "vitest";

import { buildDriftReport, findCompatibilityDrift, renderSupportMatrix } from "../../../scripts/compatibility.mjs";

type CompatibilityConfig = {
  kicad: {
    minimum: string;
    recommended: string;
    latestVerified: string;
    eol?: string[];
    tested: string[];
    notes?: Record<string, string>;
  };
  node: {
    minimum: string;
    recommended: string;
    supported: string[];
    current: string[];
    tested?: Record<string, string>;
    policy?: Record<string, string>;
  };
  cyclonedx: {
    specVersion: string;
    schemaUrl: string;
    hbomSchema: string;
    validation: string;
  };
};

type Workflow = {
  on?: {
    schedule?: Array<{ cron?: string }>;
    pull_request?: unknown;
    push?: unknown;
    workflow_dispatch?: unknown;
  };
  env?: Record<string, string>;
  permissions?: Record<string, string>;
  jobs?: Record<string, WorkflowJob>;
};

type WorkflowJob = {
  name?: string;
  env?: Record<string, string>;
  services?: Record<
    string,
    {
      image?: string;
      env?: Record<string, string>;
      ports?: Array<string | number>;
      options?: string;
    }
  >;
  strategy?: {
    matrix?: {
      include?: Array<Record<string, string | number>>;
      os?: string[];
    };
  };
  steps?: Array<{ uses?: string; run?: string; env?: Record<string, string> }>;
};

describe("compatibility matrix", () => {
  it("renders docs/support-matrix.md from docs/compatibility.yaml", async () => {
    const config = yaml.load(await readFile("docs/compatibility.yaml", "utf8")) as CompatibilityConfig;
    const supportMatrix = await readFile("docs/support-matrix.md", "utf8");

    expect(supportMatrix).toBe(renderSupportMatrix(config));
    expect(supportMatrix).toContain("| KiCad | 9.0 | Minimum supported, upstream EOL, not CI-tested |");
    expect(supportMatrix).toContain("| KiCad | 10.0 | Recommended CI-tested line |");
    expect(supportMatrix).toContain("Latest verified patch: **10.0.4**");
    expect(supportMatrix).toContain("| KiCad | 10.0 | Recommended CI-tested line | 10.0.4 |");
    expect(supportMatrix).not.toContain("| KiCad | 9.1 | Supported |");
    expect(supportMatrix).not.toContain("| KiCad | 10.1 | Supported |");
    expect(supportMatrix).toContain("| Node.js | 22 | Minimum supported runtime |");
    expect(supportMatrix).toContain("| Node.js | 24 | Recommended Active LTS runtime |");
    expect(supportMatrix).toContain("| Node.js | 26 | Current, not supported |");
    expect(supportMatrix).toContain("| CycloneDX JSON | 1.7 | Pinned HBOM contract |");
    expect(config.cyclonedx.schemaUrl).toBe("https://cyclonedx.org/schema/bom-1.7.schema.json");
    expect(config.cyclonedx.hbomSchema).toBe("schemas/hbom.schema.json");
  });

  it("escapes Markdown table notes before rendering", () => {
    const markdown = renderSupportMatrix({
      kicad: {
        minimum: "9.0",
        recommended: "10.0",
        latestVerified: "10.0.4",
        tested: ["9.0"],
        notes: {
          "9.0": String.raw`Backslash \ and pipe | are literal.`,
          "10.0": "Recommended.",
        },
      },
      node: {
        minimum: "22",
        minimumVersion: "22.14.0",
        recommended: "24",
        supported: ["22"],
        current: ["26"],
        tested: {
          "22": "22.23.1",
        },
        policy: {
          "22": "Maintenance LTS.",
          "26": "Current line tracked but not supported until LTS.",
        },
      },
      cyclonedx: {
        specVersion: "1.7",
        schemaUrl: "https://cyclonedx.org/schema/bom-1.7.schema.json",
        hbomSchema: "schemas/hbom.schema.json",
        validation: "AJV validation in unit tests.",
      },
    });

    expect(markdown).toContain(String.raw`| KiCad | 9.0 | CI-tested line |  | Backslash \\ and pipe \| are literal. |`);
  });

  it("detects untested KiCad release series and Node minor drift", () => {
    const drift = findCompatibilityDrift(
      {
        kicad: {
          minimum: "9.0",
          recommended: "10.0",
          latestVerified: "10.0.4",
          tested: ["9.0", "10.0"],
          notes: {
            "9.0": "Variants are partially supported.",
            "10.0": "Current stable line.",
          },
        },
        node: {
          minimum: "22",
          recommended: "24",
          supported: ["22", "24"],
          current: ["26"],
          tested: {
            "22": "22.23.1",
            "24": "24.18.0",
          },
          policy: {
            "22": "Maintenance LTS.",
            "24": "Active LTS.",
            "26": "Current line tracked but not supported until LTS.",
          },
        },
        cyclonedx: {
          specVersion: "1.7",
          schemaUrl: "https://cyclonedx.org/schema/bom-1.7.schema.json",
          hbomSchema: "schemas/hbom.schema.json",
          validation: "AJV validation in unit tests.",
        },
      },
      {
        kicadReleases: ["11.0.0", "10.1.2", "10.0.4", "9.1.1"],
        nodeReleases: [
          { version: "v26.2.0", date: "2026-05-20", lts: false },
          { version: "v24.19.0", date: "2026-06-18", lts: "Krypton" },
          { version: "v22.23.1", date: "2026-05-13", lts: "Jod" },
        ],
        cycloneDxSchema: {
          $id: "http://cyclonedx.org/schema/bom-1.7.schema.json",
          properties: { specVersion: { examples: ["1.7"] } },
        },
      },
    );

    expect(drift.kicad).toEqual([
      { series: "9.1", latest: "9.1.1" },
      { series: "10.1", latest: "10.1.2" },
      { series: "11.0", latest: "11.0.0" },
    ]);
    expect(drift.node).toEqual([
      {
        major: "24",
        latest: "24.19.0",
        tested: "24.18.0",
        reason: "new-minor",
      },
    ]);
    expect(drift.cyclonedx).toEqual([]);
    expect(buildDriftReport(drift)).toContain("KiCad 11.0");
    expect(buildDriftReport(drift)).toContain("Node.js 24.19.0");
    expect(buildDriftReport(drift)).not.toContain("Node.js 26.2.0");
  });

  it("flags Node current lines when they become LTS before support policy changes", () => {
    const drift = findCompatibilityDrift(
      {
        kicad: {
          minimum: "9.0",
          recommended: "10.0",
          latestVerified: "10.0.4",
          tested: ["9.0", "10.0"],
        },
        node: {
          minimum: "22",
          recommended: "24",
          supported: ["22", "24"],
          current: ["26"],
          tested: {
            "22": "22.23.1",
            "24": "24.18.0",
          },
          policy: {
            "26": "Current line tracked but not supported until LTS.",
          },
        },
        cyclonedx: {
          specVersion: "1.7",
          schemaUrl: "https://cyclonedx.org/schema/bom-1.7.schema.json",
          hbomSchema: "schemas/hbom.schema.json",
          validation: "AJV validation in unit tests.",
        },
      },
      {
        nodeReleases: [{ version: "v26.8.0", date: "2026-11-01", lts: "Nitrogen" }],
        cycloneDxSchema: {
          $id: "http://cyclonedx.org/schema/bom-1.7.schema.json",
          properties: { specVersion: { examples: ["1.7"] } },
        },
      },
    );

    expect(drift.node).toEqual([
      {
        major: "26",
        latest: "26.8.0",
        tested: null,
        reason: "current-promoted-lts",
      },
    ]);
    expect(buildDriftReport(drift)).toContain("Node.js 26.8.0 moved to LTS");
  });

  it("flags CycloneDX schema drift against the pinned HBOM spec version", () => {
    const drift = findCompatibilityDrift(
      {
        kicad: {
          minimum: "9.0",
          recommended: "10.0",
          latestVerified: "10.0.4",
          tested: ["9.0", "10.0"],
        },
        node: {
          minimum: "22",
          recommended: "24",
          supported: ["22", "24"],
          current: ["26"],
          tested: {
            "22": "22.23.1",
            "24": "24.18.0",
          },
        },
        cyclonedx: {
          specVersion: "1.7",
          schemaUrl: "https://cyclonedx.org/schema/bom-1.7.schema.json",
          hbomSchema: "schemas/hbom.schema.json",
          validation: "AJV validation in unit tests.",
        },
      },
      {
        cycloneDxSchema: {
          $id: "http://cyclonedx.org/schema/bom-1.8.schema.json",
          properties: { specVersion: { examples: ["1.8"] } },
        },
      },
    );

    expect(drift.cyclonedx).toEqual([
      {
        expected: "1.7",
        observed: "1.8",
        schemaUrl: "https://cyclonedx.org/schema/bom-1.7.schema.json",
        reason: "schema-version-mismatch",
      },
    ]);
    expect(buildDriftReport(drift)).toContain("CycloneDX schema reports 1.8");
  });

  it("handles non-array CycloneDX schema version metadata defensively", () => {
    const drift = findCompatibilityDrift(
      {
        kicad: {
          minimum: "9.0",
          recommended: "10.0",
          latestVerified: "10.0.4",
          tested: ["9.0", "10.0"],
        },
        node: {
          minimum: "22",
          recommended: "24",
          supported: ["22", "24"],
          current: ["26"],
          tested: {
            "22": "22.23.1",
            "24": "24.18.0",
          },
        },
        cyclonedx: {
          specVersion: "1.7",
          schemaUrl: "https://cyclonedx.org/schema/bom-1.7.schema.json",
          hbomSchema: "schemas/hbom.schema.json",
          validation: "AJV validation in unit tests.",
        },
      },
      {
        cycloneDxSchema: {
          properties: {
            specVersion: {
              enum: { unsupported: "1.7" },
              examples: { unsupported: "1.7" },
            },
          },
        },
      },
    );

    expect(drift.cyclonedx).toEqual([
      {
        expected: "1.7",
        observed: null,
        schemaUrl: "https://cyclonedx.org/schema/bom-1.7.schema.json",
        reason: "schema-version-unreadable",
      },
    ]);
  });

  it("flags KiCad patch drift for the latest verified recommended line", () => {
    const drift = findCompatibilityDrift(
      {
        kicad: {
          minimum: "9.0",
          recommended: "10.0",
          latestVerified: "10.0.2",
          tested: ["10.0"],
        },
        node: {
          minimum: "22",
          recommended: "24",
          supported: ["22", "24"],
          current: ["26"],
          tested: {
            "22": "22.23.1",
            "24": "24.18.0",
          },
        },
        cyclonedx: {
          specVersion: "1.7",
          schemaUrl: "https://cyclonedx.org/schema/bom-1.7.schema.json",
          hbomSchema: "schemas/hbom.schema.json",
          validation: "AJV validation in unit tests.",
        },
      },
      {
        kicadReleases: ["10.0.4", "10.0.2"],
        cycloneDxSchema: {
          $id: "http://cyclonedx.org/schema/bom-1.7.schema.json",
          properties: { specVersion: { examples: ["1.7"] } },
        },
      },
    );

    expect(drift.kicad).toEqual([
      {
        series: "10.0",
        latest: "10.0.4",
        tested: "10.0.2",
        reason: "new-verified-patch",
      },
    ]);
    expect(buildDriftReport(drift)).toContain("KiCad 10.0.4 is newer than latest verified 10.0.2");
  });

  it("keeps CI integration tests explicit per KiCad and Node pair", async () => {
    const config = yaml.load(await readFile("docs/compatibility.yaml", "utf8")) as CompatibilityConfig;
    const workflow = yaml.load(await readFile(".github/workflows/ci.yml", "utf8")) as Workflow;
    const integration = workflow.jobs?.["test-int"];
    const crossPlatform = workflow.jobs?.["cross-platform-paths"];
    const lintRuns = (workflow.jobs?.lint?.steps ?? []).map((step) => step.run ?? "").join("\n");
    const integrationRuns = (integration?.steps ?? []).map((step) => step.run ?? "").join("\n");

    const kicadExpression = "${" + "{ matrix.kicad-version }}";
    const nodeExpression = "${" + "{ matrix.node-version }}";
    expect(integration?.name).toBe(`ci / test-int (KiCad ${kicadExpression}, Node ${nodeExpression})`);
    expect(integration?.strategy?.matrix?.include).toEqual([
      {
        "kicad-version": "10.0",
        "kicad-ppa-series": "10.0",
        "node-version": 22,
      },
      {
        "kicad-version": "10.0",
        "kicad-ppa-series": "10.0",
        "node-version": 24,
      },
    ]);
    expect(integration?.env?.DATABASE_URL).toBe("postgresql://boardreadyops@127.0.0.1:5432/boardreadyops_test");
    expect(integration?.services?.postgres).toMatchObject({
      image: "postgres:16-alpine",
      env: {
        POSTGRES_USER: "boardreadyops",
        POSTGRES_DB: "boardreadyops_test",
        POSTGRES_HOST_AUTH_METHOD: "trust",
      },
      ports: ["5432:5432"],
    });
    expect(integration?.services?.postgres?.options).toContain("pg_isready -U boardreadyops -d boardreadyops_test");
    expect(integrationRuns).toContain("pnpm --filter @boardreadyops/db db:migrate");
    expect(integrationRuns).toContain("pnpm run test:int");
    expect(config.kicad.tested).toEqual(["10.0"]);
    expect(config.kicad.eol).toEqual(["9.0"]);
    expect(config.kicad.latestVerified).toBe("10.0.4");
    expect(config.node.supported).toEqual(["22", "24"]);
    expect(config.node.current).toEqual(["26"]);
    expect(crossPlatform?.strategy?.matrix?.os).toEqual(["ubuntu-24.04", "macos-latest", "windows-2025-vs2026"]);
    expect(lintRuns).toContain("pnpm run compatibility:check");
  });

  it("keeps package engines, README, binary build, and container defaults aligned with the support policy", async () => {
    const config = yaml.load(await readFile("docs/compatibility.yaml", "utf8")) as CompatibilityConfig;
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      engines?: { node?: string };
    };
    const readme = await readFile("README.md", "utf8");
    const binaryWorkflow = yaml.load(await readFile(".github/workflows/binary-build.yml", "utf8")) as Workflow;
    const containerWorkflow = yaml.load(await readFile(".github/workflows/container-build.yml", "utf8")) as Workflow;
    const dockerfile = await readFile("apps/container/Dockerfile", "utf8");

    expect(packageJson.engines?.node).toBe("^22.14.0 || ^24.0.0");
    expect(packageJson.engines?.node).not.toContain("26");
    expect(binaryWorkflow.env?.NODE_VERSION).toBe(config.node.recommended);
    expect(containerWorkflow.env?.NODE_VERSION).toBe(config.node.tested?.[config.node.recommended]);
    expect(containerWorkflow.env?.KICAD_PPA_SERIES).toBe(config.kicad.recommended);
    expect(dockerfile).toContain(`ARG NODE_VERSION=${config.node.tested?.[config.node.recommended]}`);
    expect(dockerfile).toContain(`ARG KICAD_PPA_SERIES=${config.kicad.recommended}`);
    expect(readme).toContain("Node.js 22.14+ and 24");
    expect(readme).toMatch(/Node\.js 26\s+Current is tracked but not supported/);
    expect(readme).toContain("CI-tested on KiCad 10.0");
    expect(readme).toMatch(/10\.0\.4 as the latest\s+verified patch/);
    expect(readme).not.toContain("KiCad 9.0 and 10.0");
    expect(readme).toContain("docs/support-matrix.md");
  });

  it("defines a scheduled drift workflow that can open GitHub issues", async () => {
    const workflow = yaml.load(await readFile(".github/workflows/compatibility-drift.yml", "utf8")) as Workflow;
    const job = workflow.jobs?.["check-drift"];
    const runCommands = (job?.steps ?? []).map((step) => step.run ?? "").join("\n");

    expect(workflow.on?.schedule).toEqual([{ cron: "23 5 * * 1" }]);
    expect(workflow.permissions).toMatchObject({
      contents: "read",
      issues: "write",
    });
    expect(job?.steps?.some((step) => step.uses?.startsWith("actions/checkout@"))).toBe(true);
    expect(job?.steps?.some((step) => step.uses?.startsWith("actions/setup-node@"))).toBe(true);
    expect(runCommands).toContain("pnpm run compatibility:drift");
    expect(runCommands).toContain("gh issue create");
  });
});
