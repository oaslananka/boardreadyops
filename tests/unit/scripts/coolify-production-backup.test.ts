import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const backupScript = resolve("deploy/maintenance/coolify-production-backup.sh");
const validRollingUuid = "r".repeat(25);
const fakeDockerScript = [
  "#!/usr/bin/env bash",
  "set -eu",
  'cmd="$1"; shift',
  'if [ "$cmd" = info ]; then exit 0; fi',
  'if [ "$cmd" = ps ]; then',
  '  case " $* " in',
  "    *service=postgres*) echo fixture-postgres; exit 0 ;;",
  '    *service=web*) if [ "$MOCK_LEGACY" = 1 ]; then echo fixture-legacy-web; fi; exit 0 ;;',
  "    *coolify.applicationUuid=*)",
  '      if [ "$MOCK_ROLLING_AVAILABLE" = 1 ]; then',
  "        echo fixture-rolling-web",
  '        if [ "$MOCK_ROLLING_COUNT" = 2 ]; then echo fixture-extra-web; fi',
  "      fi",
  "      exit 0 ;;",
  "  esac",
  "  exit 0",
  "fi",
  'if [ "$cmd" = inspect ]; then',
  '  case " $* " in',
  '    *coolify.applicationUuid*) echo "$MOCK_LABEL"; exit 0 ;;',
  '    *State.Health*) echo "$MOCK_HEALTH"; exit 0 ;;',
  "    */var/lib/postgresql/data*) echo fixture-postgres-volume; exit 0 ;;",
  "    */data/artifacts*) echo fixture-artifact-volume; exit 0 ;;",
  "  esac",
  "fi",
  "echo 'mock docker received an unexpected request' >&2",
  "exit 29",
].join("\n");

// The production helper intentionally targets Linux. Stub GNU coreutils in the
// preflight fixture so the same repository checks run on macOS CI without
// accidentally calling real Docker or relying on host-specific stat flags.
const fakeStatScript = [
  "#!/usr/bin/env sh",
  'case "$1:$2" in',
  "  -c:%u) id -u; exit 0 ;;",
  "  -c:%a) echo 700; exit 0 ;;",
  "esac",
  "echo 'unexpected stat arguments' >&2",
  "exit 23",
].join("\n");

const fakeDfScript = [
  "#!/usr/bin/env sh",
  "echo 'Filesystem 1024-blocks Used Available Capacity Mounted on'",
  "echo 'fixture 2097152 1024 2096128 1% /'",
].join("\n");

type PreflightOptions = {
  rollingUuid?: string;
  rollingAvailable?: boolean;
  rollingCount?: number;
  legacyAvailable?: boolean;
  label?: string;
  health?: string;
};

/** Git Bash uses /c/... paths on the Windows runner rather than C: drive paths.
 * Adapt only the test fixture. The deployed backup script is Linux-only.
 */
function posixBashPath(path: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== "win32") return path;
  return path.replaceAll("\\", "/").replace(/^([a-z]):\//iu, (_match, drive: string) => `/${drive.toLowerCase()}/`);
}

function preflight(options: PreflightOptions = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bro-backup-preflight-"));
  const bin = join(dir, "bin");
  const backups = join(dir, "backups");
  mkdirSync(bin, { mode: 0o700 });
  mkdirSync(backups, { mode: 0o700 });
  writeFileSync(join(bin, "docker"), fakeDockerScript, { mode: 0o700 });
  writeFileSync(join(bin, "stat"), fakeStatScript, { mode: 0o700 });
  writeFileSync(join(bin, "df"), fakeDfScript, { mode: 0o700 });
  for (const command of ["flock", "timeout", "sha256sum"]) {
    // Preflight checks for these executables but does not invoke them.
    writeFileSync(join(bin, command), "#!/usr/bin/env sh\nexit 0\n", { mode: 0o700 });
  }
  try {
    return spawnSync("bash", [backupScript, "--preflight"], {
      encoding: "utf8",
      timeout: 10_000,
      env: {
        ...process.env,
        PATH: [bin, process.env.PATH].filter(Boolean).join(delimiter),
        BOARDREADYOPS_COMPOSE_PROJECT: "c".repeat(25),
        BOARDREADYOPS_POSTGRES_VOLUME: "fixture-postgres-volume",
        BOARDREADYOPS_ARTIFACT_VOLUME: "fixture-artifact-volume",
        BOARDREADYOPS_BACKUP_DIR: posixBashPath(backups),
        BOARDREADYOPS_BACKUP_KEEP: "7",
        BOARDREADYOPS_ROLLING_WEB_APP_UUID: options.rollingUuid ?? "",
        MOCK_LEGACY: options.legacyAvailable ? "1" : "0",
        MOCK_ROLLING_AVAILABLE: options.rollingAvailable === false ? "0" : "1",
        MOCK_ROLLING_COUNT: String(options.rollingCount ?? 1),
        MOCK_LABEL: options.label ?? validRollingUuid,
        MOCK_HEALTH: options.health ?? "healthy",
      },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("Coolify production backup preflight with independent rolling web", () => {
  it("converts native Windows drive paths to absolute Git Bash paths without touching POSIX paths", () => {
    expect(posixBashPath(["D:", "a", "_temp", "backups"].join(String.fromCharCode(92)), "win32")).toBe(
      "/d/a/_temp/backups",
    );
    expect(posixBashPath("/tmp/backups", "linux")).toBe("/tmp/backups");
  });

  it("selects one explicitly named healthy rolling web, leaving PostgreSQL in the Compose project", () => {
    const run = preflight({ rollingUuid: validRollingUuid });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("BoardReadyOps backup preflight: PASS");
  });

  it("fails closed when the requested rolling web is missing", () => {
    const run = preflight({ rollingUuid: validRollingUuid, rollingAvailable: false });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("expected exactly one current rolling production web");
  });

  it("fails closed when multiple rolling web containers would risk an inconsistent artifact snapshot", () => {
    const run = preflight({ rollingUuid: validRollingUuid, rollingCount: 2 });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("expected exactly one current rolling production web");
  });

  it("rejects an invalid or incorrect rolling web identity", () => {
    const invalid = preflight({ rollingUuid: "bad UUID" });
    expect(invalid.status).not.toBe(0);
    expect(invalid.stderr).toContain("invalid rolling web app identity");

    const mismatched = preflight({ rollingUuid: validRollingUuid, label: "x".repeat(25) });
    expect(mismatched.status).not.toBe(0);
    expect(mismatched.stderr).toContain("rolling web app identity mismatch");
  });

  it("rejects unhealthy web and retains the legacy Compose web path when no rolling UUID is set", () => {
    const unhealthy = preflight({ rollingUuid: validRollingUuid, health: "unhealthy" });
    expect(unhealthy.status).not.toBe(0);
    expect(unhealthy.stderr).toContain("production service is not healthy");

    const missing = preflight();
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain("expected exactly one running web container");

    const legacy = preflight({ legacyAvailable: true });
    expect(legacy.status, legacy.stderr).toBe(0);
    expect(legacy.stdout).toContain("BoardReadyOps backup preflight: PASS");
  });
});
