import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const migrationScript = path.join(repoRoot, "scripts/migrate-cloud-release-policy.sh");
const fixtures: string[] = [];

afterEach(() => {
  for (const dir of fixtures.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function createDockerMock(bin: string) {
  fs.writeFileSync(
    path.join(bin, "docker"),
    `#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  ps)
    case "$*" in *service=web*) echo web-id ;; *service=worker*) echo worker-id ;; *) exit 8 ;; esac ;;
  image) echo sha256:live-image ;;
  inspect)
    case "$*" in
      *'.Config.Image'*) echo boardreadyops-web-runtime:running-tag ;;
      *'.Image'*) echo sha256:live-image ;;
      *'.Config.Env'*) echo 'BOARDREADYOPS_RELEASE_REPOSITORIES_FILE=/run/policies/repositories' ;;
      *'.Mounts'*) printf '%s|/run/policies/repositories\\n' "$(cat "${"$"}MOCK_ACTIVE_SOURCE_FILE")" ;;
      *) exit 9 ;;
    esac ;;
  exec)
    if [ "$3" = node ] && [ -f "${"$"}MOCK_DELAY_READINESS_FILE" ]; then
      rm -f "${"$"}MOCK_DELAY_READINESS_FILE"
      exit 26
    fi
    if [ "$3" = cat ]; then cat "$(cat "${"$"}MOCK_ACTIVE_SOURCE_FILE")"; fi ;;
  *) exit 10 ;;
esac
`,
    { mode: 0o700 },
  );
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "boardreadyops-policy-test-"));
  fixtures.push(root);
  const deployment = path.join(root, "deployment");
  const legacy = path.join(root, "privileged", "release-repositories");
  const current = path.join(deployment, "release-repositories");
  const override = path.join(deployment, "compose.release-policy.yml");
  const backup = path.join(deployment, "compose.release-policy.legacy.yml");
  const activePathFile = path.join(root, "active.txt");
  const failOnceFile = path.join(root, "fail-once");
  const delayedReadinessFile = path.join(root, "delayed-readiness");
  const bin = path.join(root, "bin");
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  fs.mkdirSync(deployment, { recursive: true });
  fs.mkdirSync(bin);
  fs.writeFileSync(legacy, "boardreadyops/private-synthetic\n");
  fs.writeFileSync(activePathFile, legacy);
  fs.writeFileSync(
    override,
    `services:\n  web:\n    volumes:\n      - ${legacy}:/run/policies/repositories:ro\n  worker:\n    volumes:\n      - ${legacy}:/run/policies/repositories:ro\n`,
    { mode: 0o600 },
  );
  const script = fs
    .readFileSync(migrationScript, "utf8")
    .replaceAll("/opt/boardreadyops-cloud/release-repositories", legacy)
    .replaceAll("/home/ubuntu/boardreadyops-cloud", deployment);
  const file = path.join(root, "migrate.sh");
  fs.writeFileSync(file, script, { mode: 0o700 });
  createDockerMock(bin);
  fs.writeFileSync(
    path.join(deployment, "deploy.sh"),
    `#!/usr/bin/env bash
set -euo pipefail
[ "$1" = -f ] || exit 15
override="$2"
operation="$3"
if grep -Fq "${current}:/run/policies/repositories:ro" "$override"; then source_path="${current}"; else source_path="${legacy}"; fi
case "$operation" in
  config)
    [ "$4" = --format ] && [ "$5" = json ] || exit 16
    if [ "${"$"}MOCK_BAD_PIN" = 1 ]; then image='boardreadyops-web-runtime:wrong-tag'; else image="boardreadyops-web-runtime:${"$"}BOARDREADYOPS_IMAGE_TAG"; fi
    python3 - "$image" "$source_path" <<'PY'
import json,sys
image,source=sys.argv[1:]
service={"image":image,"volumes":[{"source":source,"target":"/run/policies/repositories","read_only":True}]}
print(json.dumps({"services":{"web":service,"worker":service}}))
PY
    ;;
  up)
    if [ -e "${"$"}MOCK_FAIL_ONCE_FILE" ]; then rm -f "${"$"}MOCK_FAIL_ONCE_FILE"; exit 20; fi
    printf '%s' "$source_path" > "${"$"}MOCK_ACTIVE_SOURCE_FILE"
    if [ "${"$"}MOCK_SLOW_READINESS" = 1 ]; then : > "${"$"}MOCK_DELAY_READINESS_FILE"; fi ;;
  *) exit 17 ;;
esac
`,
    { mode: 0o700 },
  );
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    MOCK_ACTIVE_SOURCE_FILE: activePathFile,
    MOCK_FAIL_ONCE_FILE: failOnceFile,
    MOCK_DELAY_READINESS_FILE: delayedReadinessFile,
    MOCK_SLOW_READINESS: "0",
    MOCK_BAD_PIN: "0",
  };
  return {
    root,
    file,
    deployment,
    legacy,
    current,
    override,
    backup,
    activePathFile,
    failOnceFile,
    env,
    run: (mode: string, badPin = false, delayedReadiness = false) =>
      spawnSync("bash", [file, mode], {
        encoding: "utf8",
        env: {
          ...env,
          MOCK_BAD_PIN: badPin ? "1" : "0",
          MOCK_SLOW_READINESS: delayedReadiness ? "1" : "0",
        },
        timeout: 15000,
      }),
  };
}

// This operator script targets Linux Docker hosts; BSD stat/Windows shells are not its contract.
const describeOnLinux = process.platform === "linux" ? describe : describe.skip;

describeOnLinux("non-secret policy bind-mount migration", () => {
  it("checks image pinning before any write or consumer recreation", () => {
    const f = fixture();
    const ok = f.run("--check");
    expect(ok.status).toBe(0);
    expect(fs.existsSync(f.current)).toBe(false);
    expect(fs.existsSync(f.backup)).toBe(false);
    const blocked = f.run("--apply", true);
    expect(blocked.status).not.toBe(0);
    expect(blocked.stderr).toContain("deployer does not preserve the pinned live image");
    expect(fs.readFileSync(f.activePathFile, "utf8")).toBe(f.legacy);
    expect(fs.existsSync(f.current)).toBe(false);
  });

  it("migrates unchanged non-secret data and explicitly rolls back", () => {
    const f = fixture();
    const source = fs.readFileSync(f.legacy, "utf8");
    const result = f.run("--apply");
    expect(result.status, result.stderr).toBe(0);
    expect(fs.readFileSync(f.current, "utf8")).toBe(source);
    expect(fs.readFileSync(f.legacy, "utf8")).toBe(source);
    expect(fs.readFileSync(f.activePathFile, "utf8")).toBe(f.current);
    expect(fs.existsSync(f.backup)).toBe(true);
    const rolledBack = f.run("--rollback");
    expect(rolledBack.status, rolledBack.stderr).toBe(0);
    expect(fs.readFileSync(f.activePathFile, "utf8")).toBe(f.legacy);
    expect(fs.readFileSync(f.override, "utf8")).toContain(`${f.legacy}:/run/policies/repositories:ro`);
  });

  it("waits for transient consumer warm-up after recreation", () => {
    const f = fixture();
    const result = f.run("--apply", false, true);
    expect(result.status, result.stderr).toBe(0);
    expect(fs.readFileSync(f.activePathFile, "utf8")).toBe(f.current);
  });

  it("refuses a stale rollback that would erase later repository grants", () => {
    const f = fixture();
    expect(f.run("--apply").status).toBe(0);
    fs.appendFileSync(f.current, "another-owner/synthetic-private\n");
    const result = f.run("--rollback");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("policy changed since migration");
    expect(fs.readFileSync(f.activePathFile, "utf8")).toBe(f.current);
  });

  it("restores the original mounts if recreation fails", () => {
    const f = fixture();
    fs.writeFileSync(f.failOnceFile, "yes");
    const result = f.run("--apply");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("previous override and consumers restored");
    expect(fs.readFileSync(f.activePathFile, "utf8")).toBe(f.legacy);
    expect(fs.existsSync(f.current)).toBe(false);
    expect(fs.existsSync(f.backup)).toBe(false);
    expect(fs.readFileSync(f.override, "utf8")).toContain(`${f.legacy}:/run/policies/repositories:ro`);
  });
});
