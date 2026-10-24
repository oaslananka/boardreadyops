import fs from "node:fs";
import { describe, expect, it } from "vitest";

const workflowPath = ".github/workflows/cloud-deploy.yml";
const deploymentDocsPath = "docs/deployment/self-hosted.md";

describe("cloud-deploy topology preflight", () => {
  it("fails closed before mutating a stale or uncommissioned deployment checkout", () => {
    const workflow = fs.readFileSync(workflowPath, "utf8");
    const repoDir = "$" + "{repo_dir}";
    const checkoutPreflight = workflow.indexOf(`test -d "${repoDir}/.git"`);
    const deployRoot = "$" + "{deploy_root}";
    const runbookPreflight = workflow.indexOf(`test -x "${deployRoot}/deploy.sh"`);
    const fetch = workflow.indexOf("git fetch origin --prune");

    expect(checkoutPreflight).toBeGreaterThan(0);
    expect(runbookPreflight).toBeGreaterThan(checkoutPreflight);
    expect(fetch).toBeGreaterThan(runbookPreflight);
    expect(workflow).toContain("deployment checkout is not commissioned");
    expect(workflow).toContain("deployment runbook is not commissioned");
  });

  it("keeps a commissioned release-policy override attached on every future deploy", () => {
    const workflow = fs.readFileSync(workflowPath, "utf8");
    const documentation = fs.readFileSync(deploymentDocsPath, "utf8");
    const deployRoot = "$" + "{deploy_root}";
    const policyOverrideFile = "$" + "{policy_override_file}";
    const oldBindings = "$" + "{old_bindings}";
    const newBindings = "$" + "{new_bindings}";
    const legacyPolicyFile = "$" + "{legacy_policy_file}";
    const migratedPolicyFile = "$" + "{migrated_policy_file}";

    expect(workflow).toContain(`policy_override_file="${deployRoot}/compose.release-policy.yml"`);
    expect(workflow).toContain("run_deploy()");
    expect(workflow).toContain(`if [ -f "${policyOverrideFile}" ]; then`);
    expect(workflow).toContain(`./deploy.sh -f "${policyOverrideFile}" "$@"`);
    expect(workflow).toContain('./deploy.sh "$@"');
    expect(workflow).toContain("run_deploy build migrate web worker");
    expect(workflow).toContain("run_deploy up -d --build migrate web worker");
    expect(workflow).toContain("verify_release_policy_mount");
    expect(workflow).toContain('legacy_policy_file="/opt/boardreadyops-cloud/release-repositories"');
    expect(workflow).toContain(`migrated_policy_file="${deployRoot}/release-repositories"`);
    expect(workflow).toContain(`case "${oldBindings}:${newBindings}" in`);
    expect(workflow).toContain(`2:0) policy_file="${legacyPolicyFile}"`);
    expect(workflow).toContain(`0:2) policy_file="${migratedPolicyFile}"`);
    expect(workflow).toContain("release-policy override has ambiguous or unsupported policy mounts");
    expect(workflow).toContain("BOARDREADYOPS_RELEASE_REPOSITORIES_FILE");
    expect(workflow).not.toContain("sed -i");
    expect(documentation).toContain("compose.release-policy.yml");
    expect(documentation).toContain("automatically reuses");
  });

  it("verifies exactly one live consumer and parses release-policy mounts line by line", () => {
    const workflow = fs.readFileSync(workflowPath, "utf8");
    const containerPolicyPath = "$" + "{container_policy_path}";
    const configuredFile = "$" + "{configured_file}";
    const ids = "$" + "{ids}";
    const count = "$" + "{count}";

    expect(workflow).toContain('container_policy_path="/run/policies/repositories"');
    expect(workflow).toContain("local ids");
    expect(workflow).toContain("local count");
    expect(workflow).toContain('ids="$(');
    expect(workflow).toContain(`count="$(printf '%s\\n' "${ids}" | awk 'NF { count += 1 } END { print count + 0 }')"`);
    expect(workflow).toContain(`test "${count}" = "1"`);
    expect(workflow).toContain("expected exactly one running");
    expect(workflow).toContain('{{range .Mounts}}{{printf "%s|%s\\n" .Source .Destination}}{{end}}');
    expect(workflow).not.toContain('{{range .Mounts}}{{printf "%s|%s\\\\n" .Source .Destination}}{{end}}');
    expect(workflow).toContain(`-v destination="${containerPolicyPath}"`);
    expect(workflow).toContain(`test "${configuredFile}" = "${containerPolicyPath}"`);
  });

  it("fully reclaims BuildKit cache before a low-space build and caps it after every build", () => {
    const workflow = fs.readFileSync(workflowPath, "utf8");

    const buildCacheMaxUsedSpace = "$" + "{build_cache_max_used_space}";
    const availableMib = "$" + "{available_mib}";
    const requiredMib = "$" + "{required_mib}";
    const repoDir = "$" + "{repo_dir}";
    const deployArgs = "$" + "{deploy_args}";

    expect(workflow).toContain("build_cache_max_used_space=3GB");
    expect(workflow).toContain("docker builder prune --all --force || true");
    expect(workflow).toContain(`docker buildx prune --all --force --max-used-space "${buildCacheMaxUsedSpace}"`);
    expect(workflow).toContain("cloud-deploy cache: unable to enforce");
    expect(workflow).not.toContain(`--max-used-space "${buildCacheMaxUsedSpace}" || true`);
    expect(workflow).not.toContain("--filter until=168h");

    const lowSpaceCheck = workflow.indexOf(`if [ "${availableMib}" -lt "${requiredMib}" ]; then`);
    const preflightReclaim = workflow.indexOf("            reclaim_build_cache_for_preflight", lowSpaceCheck);
    const checkout = workflow.indexOf(`cd "${repoDir}"`);
    const caseStart = workflow.indexOf(`case "${deployArgs}" in`);
    const caseEnd = workflow.indexOf("          esac", caseStart);
    const finalTrim = workflow.indexOf("          if ! trim_build_cache; then", caseEnd);

    expect(lowSpaceCheck).toBeGreaterThan(0);
    expect(preflightReclaim).toBeGreaterThan(lowSpaceCheck);
    expect(preflightReclaim).toBeGreaterThan(checkout);
    expect(caseStart).toBeGreaterThan(preflightReclaim);
    expect(caseEnd).toBeGreaterThan(caseStart);
    expect(finalTrim).toBeGreaterThan(caseEnd);
    expect(workflow).toContain("if ! trim_build_cache; then");
    expect(workflow).toContain("report_disk_summary\n            exit 78");
    const finalSummary = workflow.indexOf("          report_disk_summary", finalTrim);
    expect(finalSummary).toBeGreaterThan(finalTrim);
    expect(workflow).not.toContain("docker system prune");
    expect(workflow).not.toContain("docker volume prune");
  });

  it("only retires old runtime tags during opted-in low-space preflight with a verified rollback pin", () => {
    const workflow = fs.readFileSync(workflowPath, "utf8");
    const documentation = fs.readFileSync(deploymentDocsPath, "utf8");
    const retireOptIn = "$" + "{retire_superseded_images}";
    const cacheReclaim = workflow.indexOf("docker image prune --force || true");
    const repoDir = "$" + "{repo_dir}";
    const preflightRetire = workflow.indexOf(`"${repoDir}/scripts/cloud-runtime-image-retention.sh" retire --apply`);
    const optInCheck = workflow.indexOf(`if [ "${retireOptIn}" = "1" ]; then`, cacheReclaim);
    const availableMib = "$" + "{available_mib}";
    const requiredMib = "$" + "{required_mib}";
    const capacityFailure = workflow.indexOf(
      `          if [ "${availableMib}" -lt "${requiredMib}" ]; then`,
      optInCheck,
    );

    expect(workflow).toContain("retire_superseded_images:");
    expect(workflow).toContain("default: false");
    expect(workflow).toContain('retire_superseded_images="$2"');
    expect(workflow).not.toContain("rollback_images_to_keep:");
    expect(preflightRetire).toBeGreaterThan(optInCheck);
    expect(capacityFailure).toBeGreaterThan(preflightRetire);
    expect(workflow).not.toContain("retire_superseded_runtime_images");
    expect(workflow).not.toContain("docker system prune");
    expect(workflow).not.toContain("docker volume prune");
    expect(documentation).toContain("explicit operator opt-in");
    expect(documentation).toContain("verified rollback pin");
  });

  it("pins the last healthy runtime before real replacement, then retires only after browser smoke", () => {
    const workflow = fs.readFileSync(workflowPath, "utf8");
    const documentation = fs.readFileSync(deploymentDocsPath, "utf8");
    const repoDir = "$" + "{repo_dir}";
    const pin = workflow.indexOf(`"${repoDir}/scripts/cloud-runtime-image-retention.sh" pin`);
    const productionUp = workflow.indexOf("run_deploy up -d --build migrate web worker");
    const smoke = workflow.indexOf("      - name: Verify production browser security headers");
    const retention = workflow.indexOf("      - name: Retire superseded runtime images after successful browser smoke");
    const keyCleanup = workflow.indexOf("      - name: Remove temporary SSH key");

    expect(pin).toBeGreaterThan(0);
    expect(pin).toBeLessThan(productionUp);
    expect(retention).toBeGreaterThan(smoke);
    expect(keyCleanup).toBeGreaterThan(retention);
    const successMarker = workflow.indexOf(
      'scripts/cloud-runtime-image-retention.sh confirm "$(git -C /home/ubuntu/boardreadyops-cloud/repo rev-parse HEAD)"',
    );
    const successfulRetirement = workflow.indexOf(
      "scripts/cloud-runtime-image-retention.sh retire --apply --allow-unchanged'",
    );
    expect(successMarker).toBeGreaterThan(retention);
    expect(successfulRetirement).toBeGreaterThan(successMarker);
    expect(workflow).toContain(
      "&& /home/ubuntu/boardreadyops-cloud/repo/scripts/cloud-runtime-image-retention.sh retire",
    );
    expect(workflow).toContain(`"$(git -C "${repoDir}" rev-parse HEAD)"`);
    expect(workflow).not.toContain('retire_superseded_runtime_images "3"');
    expect(documentation).toContain("single proven prior image");
  });

  it("keeps rehearsal to build + cache trim without touching running runtime-image retention", () => {
    const workflow = fs.readFileSync(workflowPath, "utf8");
    const documentation = fs.readFileSync(deploymentDocsPath, "utf8");

    expect(workflow).toContain(
      "description: Build only on the production host; no container replacement, migrations, canary, or health check. Checkout/images/cache may change.",
    );
    expect(workflow).toContain("inputs.dry_run && 'build migrate web worker'");
    expect(workflow).toContain("run_deploy build migrate web worker");
    expect(workflow).toContain("git reset --hard origin/main");
    expect(workflow).toContain("          if ! trim_build_cache; then");
    expect(documentation).toContain("no canary or automatic rollback");
    expect(documentation).toContain("without touching the running containers");
    expect(documentation).toContain("repeated rehearsals can still accumulate tagged build results");
  });

  it("verifies the browser security baseline after a real deploy but not during dry-run", () => {
    const workflow = fs.readFileSync(workflowPath, "utf8");

    const remoteDeployEnd = workflow.indexOf("          REMOTE_DEPLOY");
    const securitySmoke = workflow.indexOf("      - name: Verify production browser security headers");
    const cleanup = workflow.indexOf("      - name: Remove temporary SSH key");

    expect(securitySmoke).toBeGreaterThan(remoteDeployEnd);
    expect(cleanup).toBeGreaterThan(securitySmoke);
    expect(workflow).toContain("if: $" + "{{ !inputs.dry_run }}");
    expect(workflow).toContain("BOARDREADYOPS_PUBLIC_URL");
    expect(workflow).toContain("cloud-deploy security smoke");
    expect(workflow).toContain("for path in / /dashboard; do");
    expect(workflow).toContain("Content-Security-Policy");
    expect(workflow).toContain(`"frame-ancestors 'none'" "base-uri 'self'" "object-src 'none'"`);
    expect(workflow).toContain("Strict-Transport-Security");
    expect(workflow).toContain("max-age=31536000");
    expect(workflow).toContain("X-Content-Type-Options");
    expect(workflow).toContain("Referrer-Policy");
    expect(workflow).toContain("Permissions-Policy");
    expect(workflow).toContain("X-Frame-Options");
    expect(workflow).toContain("require_header_directives");
    expect(workflow).toContain(`"frame-ancestors 'none'" "base-uri 'self'" "object-src 'none'"`);
    expect(workflow).toContain('"camera=()" "geolocation=()" "microphone=()" "usb=()"');
    expect(workflow).not.toContain("grep -Fxiq");
    expect(workflow).not.toContain("https://boardreadyops.com");
  });

  it("emits aggregate-only disk diagnostics before a low-space preflight exits", () => {
    const workflow = fs.readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("cloud-deploy disk: docker system summary");
    expect(workflow).toContain("docker system df");
    expect(workflow).toContain("cloud-deploy disk: runtime images count=");
    expect(workflow).toContain("docker image inspect");
    expect(workflow).not.toContain("docker system df -v");
  });

  it("documents the remote path as a commissioned contract, not a permanently live host claim", () => {
    const documentation = fs.readFileSync(deploymentDocsPath, "utf8");

    expect(documentation).toContain("operator-commissioned deployment target");
    expect(documentation).toContain("preflight fails before `git fetch`");
    expect(documentation).toContain("do not create the missing production tree automatically");
    expect(documentation).not.toContain("The current production host does not run");
  });
});
