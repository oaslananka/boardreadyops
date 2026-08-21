import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { describe, expect, it } from "vitest";

const root = "deploy/maintenance";
const serverPath = `${root}/server.py`;
const clientPath = `${root}/client.py`;
const installerPath = `${root}/install.sh`;
const servicePath = `${root}/boardreadyops-maintenance.service`;
const runtimeStatusPath = `${root}/runtime-status.sh`;
const backupVerifyPath = `${root}/backup-restore-verify.sh`;
const pythonLauncher = process.env.BOARDREADYOPS_PYTHON ?? (process.platform === "win32" ? "python" : "python3");

function read(path: string): string {
  return fs.readFileSync(path, "utf8");
}

function runPython(program: string) {
  return spawnSync(pythonLauncher, ["-c", program, serverPath], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

describe("BoardReadyOps production maintenance boundary", () => {
  it("accepts only the two versioned maintenance operations and maps them to fixed helper argv", () => {
    const result = runPython(String.raw`
import builtins, importlib.util, json, sys
path = sys.argv[1]
real_import = builtins.__import__
def import_without_posix_accounts(name, *args, **kwargs):
    if name in {"grp", "pwd"}:
        raise ModuleNotFoundError(name)
    return real_import(name, *args, **kwargs)
spec = importlib.util.spec_from_file_location("boardreadyops_maintenance", path)
module = importlib.util.module_from_spec(spec)
builtins.__import__ = import_without_posix_accounts
try:
    spec.loader.exec_module(module)
finally:
    builtins.__import__ = real_import
assert module.parse_request(b'{"version":1,"operation":"runtime-status"}\n') == "runtime-status"
assert module.parse_request(b'{"version":1,"operation":"backup-restore-verify"}\n') == "backup-restore-verify"
assert module.command_for_operation("runtime-status", "/srv/boardreadyops") == [
    "/opt/boardreadyops-maintenance/runtime-status.sh", "--deployment-dir", "/srv/boardreadyops"
]
assert module.command_for_operation("backup-restore-verify", "/srv/boardreadyops") == [
    "/opt/boardreadyops-maintenance/backup-restore-verify.sh", "--deployment-dir", "/srv/boardreadyops"
]
for payload in [
    b'{"version":1,"operation":"shell","command":"id"}\n',
    b'{"version":1,"operation":"runtime-status","path":"/tmp"}\n',
    b'{"version":1,"operation":"runtime-status","env":{}}\n',
    b'{"version":2,"operation":"runtime-status"}\n',
]:
    try:
        module.parse_request(payload)
    except ValueError:
        pass
    else:
        raise AssertionError(payload)
`);

    expect(result.status, result.stderr).toBe(0);
  });

  it("binds the control socket to the dedicated exec-agent peer and never exposes generic root execution", () => {
    const server = read(serverPath);
    const client = read(clientPath);

    expect(server).toContain("SO_PEERCRED");
    expect(server).toContain('ALLOWED_USER = "exec-agent"');
    expect(server).toContain("REQUEST_LIMIT = 1024");
    expect(server).toContain("os.chown(SOCKET_PATH, 0, socket_gid)");
    expect(server).toContain(
      "os.chmod(SOCKET_PATH, 0o660)  # nosemgrep: python.lang.security.audit.insecure-file-permissions.insecure-file-permissions",
    );
    expect(server).toContain("subprocess.run(");
    expect(server).toContain("shell=False");
    expect(server).not.toMatch(/sudoers|NOPASSWD|docker group|\/bin\/sh -c|shell=True/u);

    expect(client).toContain('"runtime-status"');
    expect(client).toContain('"backup-restore-verify"');
    expect(client).not.toMatch(/command|deployment-dir|environment|env_file/u);
  });

  it("installs a root-only hardened service while keeping exec-agent unprivileged", () => {
    const installer = read(installerPath);
    const service = read(servicePath);

    expect(installer).toContain("--deployment-dir");
    expect(installer).toContain("EUID");
    expect(installer).toContain("exec-agent");
    expect(installer).toContain("BOARDREADYOPS_DEPLOYMENT_DIR");
    expect(installer).toContain("BindReadOnlyPaths=");
    expect(installer).toContain("systemctl enable --now boardreadyops-maintenance.service");
    expect(installer).not.toMatch(/sudoers|NOPASSWD|usermod.*docker|groupadd.*docker/u);

    expect(service).toContain("User=root");
    expect(service).toContain("Group=exec-agent");
    expect(service).toContain("NoNewPrivileges=true");
    expect(service).toContain("ProtectSystem=strict");
    expect(service).toContain("ProtectHome=tmpfs");
    expect(service).toContain("PrivateTmp=true");
    expect(service).toContain("RestrictAddressFamilies=AF_UNIX");
    expect(service).toContain("RuntimeDirectory=boardreadyops-maintenance");
    expect(service).not.toMatch(/sudo|docker\.sock.*rw|0\.0\.0\.0|ListenStream/u);
  });

  it("keeps runtime status aggregate-only and binds the running web image revision to the checkout SHA", () => {
    const script = read(runtimeStatusPath);

    expect(script).toContain('readonly project="boardreadyops-cloud"');
    for (const service of ["postgres", "redis", "web", "worker"]) {
      expect(script).toContain(service);
    }
    expect(script).toContain("org.opencontainers.image.revision");
    expect(script).toContain('git -c safe.directory="$repo_dir" -C');
    expect(script).toContain("restart_count");
    expect(script).not.toMatch(/Env|runtime\.env|POSTGRES_PASSWORD|DATABASE_URL|GITHUB_APP|PRIVATE_KEY/u);
  });

  it("restores production PostgreSQL only into disposable internal resources and verifies cleanup before success", () => {
    const script = read(backupVerifyPath);

    expect(script).toContain('git -c safe.directory="$repo_dir" -C');
    expect(script).toContain("pg_dump");
    expect(script).toContain("--format=custom");
    expect(script).toContain("--no-owner");
    expect(script).toContain("--no-privileges");
    expect(script).toContain("pg_restore");
    expect(script).toContain("--exit-on-error");
    expect(script).toContain("docker network create --internal");
    expect(script).toContain("BOARDREADYOPS_RUNNER_MODE=disabled");
    expect(script).toContain("/api/health/ready");
    expect(script).toContain("/health/ready");
    expect(script).toContain("cleanup_verified");
    expect(script.indexOf("cleanup_verified")).toBeLessThan(
      script.indexOf("boardreadyops_production_backup_restore_verified"),
    );
    expect(script).not.toMatch(
      /env_file|runtime\.env|GITHUB_APP_PRIVATE_KEY|GITHUB_CLIENT_SECRET|RUNNER_CALLBACK_SECRET/u,
    );

    const sourceQueries = [...script.matchAll(/query_source\s+"([^"]+)"/gu)]
      .map((match) => match[1])
      .filter((query): query is string => query !== undefined);
    expect(sourceQueries.length).toBeGreaterThan(1);
    for (const query of sourceQueries) {
      expect(query.trim().toLowerCase()).toMatch(/^select\b/u);
    }
  });
});
