import fs from "node:fs";
import { describe, expect, it } from "vitest";

const workflowPath = ".github/workflows/control-plane-restore-drill.yml";
const documentationPath = "docs/operations/control-plane-restore-drill.md";

describe("control-plane restore drill documentation", () => {
  it("keeps restore readiness isolated, production-shaped, and privacy bounded", () => {
    expect(fs.existsSync(workflowPath)).toBe(true);
    expect(fs.existsSync(documentationPath)).toBe(true);

    const workflow = fs.readFileSync(workflowPath, "utf8");
    const documentation = fs.readFileSync(documentationPath, "utf8");
    const navigation = fs.readFileSync("mkdocs.yml", "utf8");
    const packageJson = fs.readFileSync("package.json", "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("postgres:17-alpine");
    expect(workflow).toContain("Prepare PostgreSQL 17 client wrappers");
    expect(workflow).toContain("postgres:17-alpine pg_dump");
    expect(workflow).toContain("postgres:17-alpine pg_restore");
    expect(workflow).toContain('postgres:17-alpine pg_restore "$@"');
    expect(workflow).toContain("BOARDREADYOPS_RESTORE_DRILL_CONFIRMATION: isolated-disposable-database");
    expect(workflow).toContain("pnpm run cloud:restore:verify");
    expect(workflow).toContain("apps/web/Dockerfile");
    expect(workflow).toContain("BOARDREADYOPS_RUNNER_MODE=disabled");
    expect(workflow).toContain("/api/health/ready");
    expect(workflow).toContain("/health/ready");
    expect(workflow).toContain("node --input-type=module - <<'NODE'");
    expect(workflow).toContain("retention-days: 30");
    expect(workflow).toContain("contents: read");
    expect(workflow).not.toContain("secrets.");

    expect(documentation).toContain("15-minute RPO");
    expect(documentation).toContain("60-minute RTO");
    expect(documentation).toContain("representative run state");
    expect(documentation).toContain("production runtime image");
    expect(documentation).toContain("does not prove");
    expect(documentation).toContain("issue #222");
    expect(documentation).toContain("aggregate-only");

    expect(navigation).toContain("Control-plane Restore Drill: operations/control-plane-restore-drill.md");
    expect(packageJson).toContain('"cloud:restore:verify": "node scripts/control-plane-restore-drill.mjs"');
  });
});
