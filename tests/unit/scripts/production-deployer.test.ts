import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const deployerPath = "deploy/deployer/production-deployer.py";
const pythonLauncher = process.env.BOARDREADYOPS_PYTHON ?? (process.platform === "win32" ? "python" : "python3");

function runPython(program: string) {
  return spawnSync(pythonLauncher, ["-c", program, deployerPath], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 20_000,
  });
}

describe("BoardReadyOps production deployer", () => {
  it("accepts only a bounded GitHub owner/repository identity", () => {
    const result = runPython(`
import importlib.util, sys
path = sys.argv[1]
spec = importlib.util.spec_from_file_location("boardreadyops_deployer", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
assert module.validate_repository("oaslananka/boardreadyops") == "oaslananka/boardreadyops"
for value in ["", "oaslananka", "../repo", "owner/repo/extra", "owner repo/repo"]:
    try:
        module.validate_repository(value)
    except ValueError:
        pass
    else:
        raise AssertionError(value)
`);

    expect(result.status, result.stderr).toBe(0);
  });
});

describe("production candidate admission", () => {
  it("accepts only the newest exact-SHA successful push workflow run", () => {
    const result = runPython(`
import importlib.util, sys
path = sys.argv[1]
spec = importlib.util.spec_from_file_location("boardreadyops_deployer", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
sha = "a" * 40
success = {"workflow_runs": [{"head_sha": sha, "event": "push", "status": "completed", "conclusion": "success"}]}
assert module.latest_workflow_success(success, sha) is True
for document in [
    {}, {"workflow_runs": []}, {"workflow_runs": "bad"},
    {"workflow_runs": [{"head_sha": sha, "event": "push", "status": "in_progress", "conclusion": None}]},
    {"workflow_runs": [{"head_sha": sha, "event": "push", "status": "completed", "conclusion": "failure"}]},
    {"workflow_runs": [{"head_sha": sha, "event": "push", "status": "completed", "conclusion": "cancelled"}]},
    {"workflow_runs": [{"head_sha": "b" * 40, "event": "push", "status": "completed", "conclusion": "success"}]},
]:
    assert module.latest_workflow_success(document, sha) is False
newest_pending = {"workflow_runs": [
    {"head_sha": sha, "event": "push", "status": "in_progress", "conclusion": None},
    {"head_sha": sha, "event": "push", "status": "completed", "conclusion": "success"},
]}
assert module.latest_workflow_success(newest_pending, sha) is False
`);
    expect(result.status, result.stderr).toBe(0);
  });

  it("requires verified commit plus exact-SHA ci and security success", () => {
    const result = runPython(`
import importlib.util, sys
path = sys.argv[1]
spec = importlib.util.spec_from_file_location("boardreadyops_deployer", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
sha = "c" * 40
seen = []
def get_json(url, headers):
    seen.append((url, headers))
    if url.endswith("/commits/" + sha):
        return {"commit": {"verification": {"verified": True}}}
    return {"workflow_runs": [{"head_sha": sha, "event": "push", "status": "completed", "conclusion": "success"}]}
assert module.candidate_admission("oaslananka/boardreadyops", sha, get_json) == (True, "admitted")
assert len(seen) == 3
assert seen[0][0].endswith("/repos/oaslananka/boardreadyops/commits/" + sha)
assert "actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=" + sha in seen[1][0]
assert "actions/workflows/security.yml/runs?branch=main&event=push&head_sha=" + sha in seen[2][0]
for _, headers in seen:
    assert headers["Accept"] == "application/vnd.github+json"
    assert headers["X-GitHub-Api-Version"] == "2022-11-28"
assert module.candidate_admission("oaslananka/boardreadyops", "short", get_json) == (False, "invalid_candidate")
`);
    expect(result.status, result.stderr).toBe(0);
  });
});

describe("production rollout command contract", () => {
  it("uses fixed Compose wrapper commands for build, migration, canary, and live replacement", () => {
    const result = runPython(`
import importlib.util, sys
path = sys.argv[1]
spec = importlib.util.spec_from_file_location("boardreadyops_deployer", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
sha = "d" * 40
commands = module.deploy_commands("/srv/boardreadyops", sha)
wrapper = "/srv/boardreadyops/deploy.sh"
assert commands == [
    [wrapper, "build", "migrate"],
    [wrapper, "run", "--rm", "--no-deps", "migrate"],
    [wrapper, "run", "--detach", "--no-deps", "--name", "boardreadyops-canary-" + sha[:12], "--publish", "127.0.0.1:3004:3000", "web"],
    [wrapper, "up", "-d", "--no-build", "--no-deps", "web", "worker"],
]
flat = " ".join(part for command in commands for part in command)
for forbidden in [" reset ", " rebase ", " push ", "/bin/sh", "bash -c"]:
    assert forbidden not in " " + flat + " "
`);
    expect(result.status, result.stderr).toBe(0);
  });

  it("rolls back checkout and live services without reversing migrations", () => {
    const result = runPython(`
import importlib.util, sys
path = sys.argv[1]
spec = importlib.util.spec_from_file_location("boardreadyops_deployer", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
sha = "e" * 40
wrapper = "/srv/boardreadyops/deploy.sh"
checkout = ["git", "-C", "/srv/boardreadyops/repo", "checkout", "--detach", sha]
assert module.rollback_commands("/srv/boardreadyops", sha, False) == [checkout]
assert module.rollback_commands("/srv/boardreadyops", sha, True) == [
    checkout,
    [wrapper, "up", "-d", "--no-build", "--no-deps", "web", "worker"],
]
flat = " ".join(part for command in module.rollback_commands("/srv/boardreadyops", sha, True) for part in command)
assert "migrate" not in flat
for forbidden in ["reset", "rebase", "push", "--force"]:
    assert forbidden not in flat
`);
    expect(result.status, result.stderr).toBe(0);
  });
});

describe("production rollout orchestration", () => {
  it("runs all admission and recovery gates before checking out or mutating the candidate", () => {
    const result = runPython(`
import importlib.util, sys
path = sys.argv[1]
spec = importlib.util.spec_from_file_location("boardreadyops_deployer", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
previous, candidate = "1" * 40, "2" * 40
events = []
state = {"checkout": previous, "runtime": previous}
repo_dir = "/srv/boardreadyops/repo"
def runner(command, cwd, timeout):
    events.append(("run", tuple(command)))
    if command == ["git", "-C", repo_dir, "rev-parse", "HEAD"]: return state["checkout"]
    if command == ["git", "-C", repo_dir, "status", "--porcelain"]: return ""
    if command == ["git", "-C", repo_dir, "rev-parse", "origin/main"]: return candidate
    if command[:5] == ["git", "-C", repo_dir, "checkout", "--detach"]:
        state["checkout"] = command[5]; return ""
    if command[-4:] == ["--no-build", "--no-deps", "web", "worker"]: state["runtime"] = state["checkout"]
    return ""
def maintenance(operation):
    events.append(("maintenance", operation))
    if operation == "runtime-status":
        sha = state["runtime"]
        return {"ready": True, "releaseSha": state["checkout"], "imageRevision": sha}
    if operation == "topology-preflight": return {"ready": True}
    if operation == "backup-restore-verify": return {"event": "verified"}
    raise AssertionError(operation)
def get_json(url, headers):
    events.append(("github", url))
    if "/commits/" in url: return {"commit": {"verification": {"verified": True}}}
    return {"workflow_runs": [{"head_sha": candidate, "event": "push", "status": "completed", "conclusion": "success"}]}
def health(url): events.append(("health", url))
ok, reason = module.run_deployment(
    "/srv/boardreadyops", "oaslananka/boardreadyops", "https://prod.example/api/health",
    runner=runner, maintenance=maintenance, http_get_json=get_json, health_check=health,
)
assert (ok, reason) == (True, "deployed")
checkout_event = ("run", ("git", "-C", repo_dir, "checkout", "--detach", candidate))
assert events.index(checkout_event) > events.index(("maintenance", "backup-restore-verify"))
assert events[:events.index(checkout_event)].count(("maintenance", "runtime-status")) == 2
assert ("health", "http://127.0.0.1:3004/api/health/ready") in events
assert ("health", "https://prod.example/api/health") in events
`);
    expect(result.status, result.stderr).toBe(0);
  });

  it("fails closed for dirty checkout, non-fast-forward candidates, and preflight failure", () => {
    const result = runPython(`
import importlib.util, sys
path = sys.argv[1]
spec = importlib.util.spec_from_file_location("boardreadyops_deployer", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
previous, candidate = "3" * 40, "4" * 40
repo_dir = "/srv/boardreadyops/repo"
def runtime(_): return {"ready": True, "releaseSha": previous, "imageRevision": previous}
def unused_get(url, headers): raise AssertionError(url)
def unused_health(url): raise AssertionError(url)

def dirty_runner(command, cwd, timeout):
    if command[-2:] == ["rev-parse", "HEAD"]: return previous
    if command[-2:] == ["status", "--porcelain"]: return "M deploy/file"
    raise AssertionError(command)
assert module.run_deployment(
    "/srv/boardreadyops", "oaslananka/boardreadyops", "https://prod.example/api/health",
    runner=dirty_runner, maintenance=runtime, http_get_json=unused_get, health_check=unused_health,
) == (False, "dirty_checkout")
events = []
def nonff_runner(command, cwd, timeout):
    events.append(tuple(command))
    if command[-2:] == ["rev-parse", "HEAD"]: return previous
    if command[-2:] == ["status", "--porcelain"]: return ""
    if command[-3:] == ["fetch", "origin", "main"]: return ""
    if command[-2:] == ["rev-parse", "origin/main"]: return candidate
    if "merge-base" in command: raise RuntimeError("not ancestor")
    raise AssertionError(command)
assert module.run_deployment(
    "/srv/boardreadyops", "oaslananka/boardreadyops", "https://prod.example/api/health",
    runner=nonff_runner, maintenance=runtime, http_get_json=unused_get, health_check=unused_health,
) == (False, "non_fast_forward")
assert not any("deploy.sh" in part for command in events for part in command)

def admitted(url, headers):
    if "/commits/" in url: return {"commit": {"verification": {"verified": True}}}
    return {"workflow_runs": [{"head_sha": candidate, "event": "push", "status": "completed", "conclusion": "success"}]}
events = []
def gated_runner(command, cwd, timeout):
    events.append(tuple(command))
    if command[-2:] == ["rev-parse", "HEAD"]: return previous
    if command[-2:] == ["status", "--porcelain"]: return ""
    if command[-3:] == ["fetch", "origin", "main"]: return ""
    if command[-2:] == ["rev-parse", "origin/main"]: return candidate
    if "merge-base" in command: return ""
    raise AssertionError(command)
def failed_preflight(operation):
    if operation == "runtime-status": return runtime(operation)
    if operation == "topology-preflight": raise RuntimeError("drift")
    raise AssertionError(operation)
assert module.run_deployment(
    "/srv/boardreadyops", "oaslananka/boardreadyops", "https://prod.example/api/health",
    runner=gated_runner, maintenance=failed_preflight, http_get_json=admitted, health_check=unused_health,
) == (False, "topology_preflight_failed")
assert not any("deploy.sh" in part or "checkout" in command for command in events for part in command)
`);
    expect(result.status, result.stderr).toBe(0);
  });

  it("restores the previous checkout when the localhost canary fails", () => {
    const result = runPython(`
import importlib.util, sys
path = sys.argv[1]
spec = importlib.util.spec_from_file_location("boardreadyops_deployer", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
previous, candidate = "5" * 40, "6" * 40
repo_dir = "/srv/boardreadyops/repo"
events, state = [], {"checkout": previous, "runtime": previous}
def runner(command, cwd, timeout):
    events.append(tuple(command))
    if command[-2:] == ["rev-parse", "HEAD"]: return state["checkout"]
    if command[-2:] == ["status", "--porcelain"]: return ""
    if command[-3:] == ["fetch", "origin", "main"]: return ""
    if command[-2:] == ["rev-parse", "origin/main"]: return candidate
    if "merge-base" in command: return ""
    if "checkout" in command: state["checkout"] = command[-1]; return ""
    return ""
def maintenance(operation):
    if operation == "runtime-status": return {"ready": True, "releaseSha": state["checkout"], "imageRevision": state["runtime"]}
    if operation == "topology-preflight": return {"ready": True}
    if operation == "backup-restore-verify": return {"event": "verified"}
    raise AssertionError(operation)
def admitted(url, headers):
    if "/commits/" in url: return {"commit": {"verification": {"verified": True}}}
    return {"workflow_runs": [{"head_sha": candidate, "event": "push", "status": "completed", "conclusion": "success"}]}
def health(url):
    if "127.0.0.1:3004" in url: raise RuntimeError("canary failed")
assert module.run_deployment(
    "/srv/boardreadyops", "oaslananka/boardreadyops", "https://prod.example/api/health",
    runner=runner, maintenance=maintenance, http_get_json=admitted, health_check=health,
) == (False, "deployment_failed_rolled_back")
assert ("git", "-C", repo_dir, "checkout", "--detach", candidate) in events
assert ("git", "-C", repo_dir, "checkout", "--detach", previous) in events
live = ("/srv/boardreadyops/deploy.sh", "up", "-d", "--no-build", "--no-deps", "web", "worker")
assert live not in events
`);
    expect(result.status, result.stderr).toBe(0);
  });

  it("recreates the previous web and worker when post-rollout health fails", () => {
    const result = runPython(`
import importlib.util, sys
path = sys.argv[1]
spec = importlib.util.spec_from_file_location("boardreadyops_deployer", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
previous, candidate = "7" * 40, "8" * 40
repo_dir = "/srv/boardreadyops/repo"
state = {"checkout": previous, "runtime": previous, "public_checks": 0}
events = []
def runner(command, cwd, timeout):
    events.append(tuple(command))
    if command[-2:] == ["rev-parse", "HEAD"]: return state["checkout"]
    if command[-2:] == ["status", "--porcelain"]: return ""
    if command[-3:] == ["fetch", "origin", "main"]: return ""
    if command[-2:] == ["rev-parse", "origin/main"]: return candidate
    if "merge-base" in command: return ""
    if "checkout" in command: state["checkout"] = command[-1]; return ""
    if command[-3:] == ["--no-deps", "web", "worker"]: state["runtime"] = state["checkout"]
    return ""
def maintenance(operation):
    if operation == "runtime-status": return {"ready": True, "releaseSha": state["checkout"], "imageRevision": state["runtime"]}
    if operation == "topology-preflight": return {"ready": True}
    if operation == "backup-restore-verify": return {"event": "verified"}
    raise AssertionError(operation)
def admitted(url, headers):
    if "/commits/" in url: return {"commit": {"verification": {"verified": True}}}
    return {"workflow_runs": [{"head_sha": candidate, "event": "push", "status": "completed", "conclusion": "success"}]}
def health(url):
    if "127.0.0.1:3004" in url: return None
    state["public_checks"] += 1
    if state["public_checks"] == 1: raise RuntimeError("new release unhealthy")
assert module.run_deployment(
    "/srv/boardreadyops", "oaslananka/boardreadyops", "https://prod.example/api/health",
    runner=runner, maintenance=maintenance, http_get_json=admitted, health_check=health,
) == (False, "deployment_failed_rolled_back")
live = ("/srv/boardreadyops/deploy.sh", "up", "-d", "--no-build", "--no-deps", "web", "worker")
assert events.count(live) == 2
assert state["checkout"] == previous and state["runtime"] == previous
assert state["public_checks"] == 2
`);
    expect(result.status, result.stderr).toBe(0);
  });

  it("requires manual intervention when rollback cannot restore live services", () => {
    const result = runPython(`
import importlib.util, sys
path = sys.argv[1]
spec = importlib.util.spec_from_file_location("boardreadyops_deployer", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
previous, candidate = "9" * 40, "a" * 40
repo_dir = "/srv/boardreadyops/repo"
state = {"checkout": previous, "runtime": previous, "live_calls": 0}
def runner(command, cwd, timeout):
    if command[-2:] == ["rev-parse", "HEAD"]: return state["checkout"]
    if command[-2:] == ["status", "--porcelain"]: return ""
    if command[-3:] == ["fetch", "origin", "main"]: return ""
    if command[-2:] == ["rev-parse", "origin/main"]: return candidate
    if "merge-base" in command: return ""
    if "checkout" in command: state["checkout"] = command[-1]; return ""
    if command[-3:] == ["--no-deps", "web", "worker"]:
        state["live_calls"] += 1
        if state["live_calls"] == 2: raise RuntimeError("rollback failed")
        state["runtime"] = state["checkout"]
    return ""
def maintenance(operation):
    if operation == "runtime-status": return {"ready": True, "releaseSha": state["checkout"], "imageRevision": state["runtime"]}
    if operation == "topology-preflight": return {"ready": True}
    if operation == "backup-restore-verify": return {"event": "verified"}
    raise AssertionError(operation)
def admitted(url, headers):
    if "/commits/" in url: return {"commit": {"verification": {"verified": True}}}
    return {"workflow_runs": [{"head_sha": candidate, "event": "push", "status": "completed", "conclusion": "success"}]}
def health(url):
    if "127.0.0.1:3004" in url: return None
    raise RuntimeError("public health failed")
assert module.run_deployment(
    "/srv/boardreadyops", "oaslananka/boardreadyops", "https://prod.example/api/health",
    runner=runner, maintenance=maintenance, http_get_json=admitted, health_check=health,
) == (False, "manual_intervention_required")
assert state["live_calls"] == 2
`);
    expect(result.status, result.stderr).toBe(0);
  });
});

describe("production deployer systemd boundary", () => {
  it("uses a hardened outbound-only oneshot and bounded non-persistent timer", () => {
    const result = runPython(`
from pathlib import Path
service = Path("deploy/deployer/boardreadyops-deployer.service").read_text()
timer = Path("deploy/deployer/boardreadyops-deployer.timer").read_text()
for expected in [
    "Type=oneshot", "User=root", "NoNewPrivileges=true", "ProtectSystem=strict",
    "ProtectHome=read-only", "PrivateTmp=true", "PrivateDevices=true",
    "ProtectKernelTunables=true", "ProtectKernelModules=true", "ProtectControlGroups=true",
    "RestrictSUIDSGID=true", "LockPersonality=true", "RuntimeDirectory=boardreadyops-deployer",
    "UMask=0077", "RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6",
    "CapabilityBoundingSet=CAP_DAC_OVERRIDE CAP_SETUID CAP_SETGID",
]:
    assert expected in service
assert "ListenStream" not in service and "0.0.0.0" not in service
for expected in ["OnBootSec=3m", "OnUnitActiveSec=5m", "RandomizedDelaySec=30s", "Persistent=false"]:
    assert expected in timer
assert "boardreadyops-deployer.service" in timer
`);
    expect(result.status, result.stderr).toBe(0);
  });

  it("installs fixed root-owned assets without enabling or starting the deploy timer", () => {
    const result = runPython(`
from pathlib import Path
installer = Path("deploy/deployer/install.sh").read_text()
for expected in [
    "--deployment-dir", "--repository", "--health-url", "EUID",
    "boardreadyops-maintenance", "deploy.sh", "setpriv", "systemd-analyze verify",
    "/opt/boardreadyops-deployer", "/etc/boardreadyops-deployer/deployer.env",
    "chmod 0600", "ReadWritePaths=", "systemctl daemon-reload",
    "BOARDREADYOPS_DEPLOYMENT_USER=", "BOARDREADYOPS_DEPLOYMENT_GROUP=",
]:
    assert expected in installer
for forbidden in ["enable --now boardreadyops-deployer", "start boardreadyops-deployer", "sudoers", "NOPASSWD", "usermod", "docker group"]:
    assert forbidden not in installer
assert "BOARDREADYOPS_DEPLOYMENT_DIR=" in installer
assert "BOARDREADYOPS_REPOSITORY=" in installer
assert "BOARDREADYOPS_HEALTH_URL=" in installer
`);
    expect(result.status, result.stderr).toBe(0);
  });
});

describe("production deployer process entrypoint", () => {
  it("uses a local lock and persistent manual-intervention latch with bounded aggregate output", () => {
    const result = runPython(`
from pathlib import Path
source = Path("deploy/deployer/production-deployer.py").read_text()
for expected in [
    "fcntl.flock", "/run/boardreadyops-deployer/deploy.lock",
    "/var/lib/boardreadyops-deployer/manual-intervention-required",
    "BOARDREADYOPS_DEPLOYMENT_DIR", "BOARDREADYOPS_REPOSITORY", "BOARDREADYOPS_HEALTH_URL",
    "boardreadyops_production_deployer", "json.dumps", 'if __name__ == "__main__"',
]:
    assert expected in source
for forbidden in ["GITHUB_TOKEN", "DOPPLER_TOKEN", "print(os.environ)", "response.read()"]:
    assert forbidden not in source
`);
    expect(result.status, result.stderr).toBe(0);
  });
});

describe("production deployment identity boundary", () => {
  it("runs git and the deployment wrapper as the repository owner with initialized groups", () => {
    const result = runPython(`
import importlib.util, sys
path = sys.argv[1]
spec = importlib.util.spec_from_file_location("boardreadyops_deployer", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
env = {
    "BOARDREADYOPS_DEPLOYMENT_DIR": "/srv/boardreadyops",
    "BOARDREADYOPS_DEPLOYMENT_USER": "deploy-user",
    "BOARDREADYOPS_DEPLOYMENT_GROUP": "deploy-group",
}
prefix = ["setpriv", "--reuid", "deploy-user", "--regid", "deploy-group", "--init-groups", "--"]
assert module.execution_command(["git", "-C", "/srv/boardreadyops/repo", "status"], env) == prefix + ["git", "-C", "/srv/boardreadyops/repo", "status"]
assert module.execution_command(["/srv/boardreadyops/deploy.sh", "build", "migrate"], env) == prefix + ["/srv/boardreadyops/deploy.sh", "build", "migrate"]
assert module.execution_command(["docker", "rm", "-f", "canary"], env) == ["docker", "rm", "-f", "canary"]
for key, value in [("BOARDREADYOPS_DEPLOYMENT_USER", "../bad"), ("BOARDREADYOPS_DEPLOYMENT_GROUP", "bad group")]:
    invalid = dict(env)
    invalid[key] = value
    try:
        module.execution_command(["git", "status"], invalid)
    except ValueError:
        pass
    else:
        raise AssertionError((key, value))
`);
    expect(result.status, result.stderr).toBe(0);
  });

  it("does not call GitHub admission or maintenance backup when main already matches production", () => {
    const result = runPython(`
import importlib.util, sys
path = sys.argv[1]
spec = importlib.util.spec_from_file_location("boardreadyops_deployer", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
sha = "f" * 40
events = []
def runner(command, cwd, timeout):
    events.append(("run", tuple(command)))
    if command[-2:] == ["rev-parse", "HEAD"] or command[-2:] == ["rev-parse", "origin/main"]:
        return sha
    if command[-2:] == ["status", "--porcelain"]:
        return ""
    return ""
def maintenance(operation):
    events.append(("maintenance", operation))
    if operation != "runtime-status":
        raise AssertionError(operation)
    return {"ready": True, "releaseSha": sha, "imageRevision": sha}
def http_get_json(url, headers):
    raise AssertionError(url)
ok, reason = module.run_deployment(
    "/srv/boardreadyops", "oaslananka/boardreadyops", "https://prod.example/health",
    runner=runner, maintenance=maintenance, http_get_json=http_get_json,
)
assert (ok, reason) == (True, "no_change")
assert events.count(("maintenance", "runtime-status")) == 1
`);
    expect(result.status, result.stderr).toBe(0);
  });
});
