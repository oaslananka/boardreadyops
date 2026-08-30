#!/usr/bin/env python3
try:
    import fcntl
except ImportError:  # pragma: no cover - production deployer is Linux/systemd only.
    fcntl = None

import json
import os
import re
import subprocess
import urllib.parse
import urllib.request

_OWNER_RE = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\Z")
_REPOSITORY_RE = re.compile(r"[A-Za-z0-9_.-]{1,100}\Z")
_SHA_RE = re.compile(r"[0-9a-f]{40}\Z")
_LOCAL_IDENTITY_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_.-]{0,31}\Z")
_GITHUB_API = "https://api.github.com"
_GITHUB_HEADERS = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "boardreadyops-production-deployer",
}


def validate_repository(value: str) -> str:
    if not isinstance(value, str) or value.count("/") != 1:
        raise ValueError("repository must use owner/name format")
    owner, repository = value.split("/", 1)
    if not _OWNER_RE.fullmatch(owner) or not _REPOSITORY_RE.fullmatch(repository):
        raise ValueError("repository contains unsupported characters")
    if repository in {".", ".."}:
        raise ValueError("repository name is invalid")
    return value

def latest_workflow_success(document: dict, candidate: str) -> bool:
    if not isinstance(document, dict):
        return False
    runs = document.get("workflow_runs")
    if not isinstance(runs, list):
        return False
    for run in runs:
        if not isinstance(run, dict):
            continue
        if run.get("head_sha") != candidate or run.get("event") != "push":
            continue
        return run.get("status") == "completed" and run.get("conclusion") == "success"
    return False


def github_get_json(url: str, headers: dict[str, str]) -> dict:
    request = urllib.request.Request(url, headers=headers, method="GET")
    with urllib.request.urlopen(request, timeout=15) as response:
        payload = response.read(1024 * 1024 + 1)
    if len(payload) > 1024 * 1024:
        raise ValueError("GitHub response is too large")
    document = json.loads(payload.decode("utf-8"))
    if not isinstance(document, dict):
        raise ValueError("GitHub response is invalid")
    return document

def candidate_admission(repository: str, candidate: str, http_get_json=github_get_json) -> tuple[bool, str]:
    try:
        repository = validate_repository(repository)
    except ValueError:
        return False, "invalid_repository"
    if not isinstance(candidate, str) or not _SHA_RE.fullmatch(candidate):
        return False, "invalid_candidate"

    commit_url = f"{_GITHUB_API}/repos/{repository}/commits/{candidate}"
    try:
        commit = http_get_json(commit_url, dict(_GITHUB_HEADERS))
    except Exception:
        return False, "github_unavailable"
    verification = commit.get("commit", {}).get("verification", {}) if isinstance(commit, dict) else {}
    if not isinstance(verification, dict) or verification.get("verified") is not True:
        return False, "commit_unverified"

    for workflow, rejection in (("ci.yml", "ci_not_successful"), ("security.yml", "security_not_successful")):
        url = (
            f"{_GITHUB_API}/repos/{repository}/actions/workflows/{workflow}/runs"
            f"?branch=main&event=push&head_sha={candidate}&per_page=5"
        )
        try:
            document = http_get_json(url, dict(_GITHUB_HEADERS))
        except Exception:
            return False, "github_unavailable"
        if not latest_workflow_success(document, candidate):
            return False, rejection
    return True, "admitted"

def _validate_deployment_dir(value: str) -> str:
    if not isinstance(value, str) or not value.startswith("/"):
        raise ValueError("deployment directory must be absolute")
    if not re.fullmatch(r"/[A-Za-z0-9._/-]+", value) or "//" in value or value.endswith("/"):
        raise ValueError("deployment directory is invalid")
    if any(part in {".", ".."} for part in value.split("/")):
        raise ValueError("deployment directory is not normalized")
    return value


def _validate_sha(value: str) -> str:
    if not isinstance(value, str) or not _SHA_RE.fullmatch(value):
        raise ValueError("revision must be exact lowercase 40-hex")
    return value


def deploy_commands(deployment_dir: str, candidate: str) -> list[list[str]]:
    deployment_dir = _validate_deployment_dir(deployment_dir)
    candidate = _validate_sha(candidate)
    wrapper = f"{deployment_dir}/deploy.sh"
    canary = f"boardreadyops-canary-{candidate[:12]}"
    return [
        [wrapper, "build", "migrate"],
        [wrapper, "run", "--rm", "--no-deps", "migrate"],
        [wrapper, "run", "--detach", "--no-deps", "--name", canary, "--publish", "127.0.0.1:3004:3000", "web"],
        [wrapper, "up", "-d", "--no-build", "--no-deps", "web", "worker"],
    ]

def rollback_commands(deployment_dir: str, previous: str, live_replaced: bool) -> list[list[str]]:
    deployment_dir = _validate_deployment_dir(deployment_dir)
    previous = _validate_sha(previous)
    repo_dir = f"{deployment_dir}/repo"
    commands = [["git", "-C", repo_dir, "checkout", "--detach", previous]]
    if live_replaced:
        commands.append(
            [f"{deployment_dir}/deploy.sh", "up", "-d", "--no-build", "--no-deps", "web", "worker"]
        )
    return commands

_SAFE_ENV = {
    "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    "LANG": "C.UTF-8",
    "LC_ALL": "C.UTF-8",
}
_MAINTENANCE_OPERATIONS = frozenset({"runtime-status", "topology-preflight", "backup-restore-verify"})


def execution_command(command: list[str], environment=None) -> list[str]:
    if not command:
        raise ValueError("command must not be empty")
    env = os.environ if environment is None else environment
    deployment_dir = env.get("BOARDREADYOPS_DEPLOYMENT_DIR", "")
    wrapper = f"{deployment_dir}/deploy.sh" if deployment_dir else ""
    if command[0] != "git" and command[0] != wrapper:
        return list(command)
    user = env.get("BOARDREADYOPS_DEPLOYMENT_USER", "")
    group = env.get("BOARDREADYOPS_DEPLOYMENT_GROUP", "")
    if not _LOCAL_IDENTITY_RE.fullmatch(user) or not _LOCAL_IDENTITY_RE.fullmatch(group):
        raise ValueError("deployment identity is invalid")
    return ["setpriv", "--reuid", user, "--regid", group, "--init-groups", "--", *command]


def run_command(command: list[str], cwd: str, timeout: int) -> str:
    capture_stdout = bool(command and command[0] == "git")
    result = subprocess.run(
        execution_command(command),
        cwd=cwd,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE if capture_stdout else subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=_SAFE_ENV,
        timeout=timeout,
        check=False,
        shell=False,
    )
    if result.returncode != 0:
        raise RuntimeError("command_failed")
    return str(result.stdout or "").strip()

def maintenance_operation(operation: str) -> dict:
    if operation not in _MAINTENANCE_OPERATIONS:
        raise ValueError("unsupported maintenance operation")
    timeout = 16 * 60 if operation == "backup-restore-verify" else 45
    result = subprocess.run(
        ["boardreadyops-maintenance", operation],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=_SAFE_ENV,
        timeout=timeout,
        check=False,
        shell=False,
    )
    payload = str(result.stdout or "")
    if result.returncode != 0 or len(payload.encode("utf-8")) > 64 * 1024:
        raise RuntimeError("maintenance_failed")
    document = json.loads(payload)
    if not isinstance(document, dict) or document.get("ok") is not True:
        raise RuntimeError("maintenance_failed")
    inner = document.get("result")
    if not isinstance(inner, dict):
        raise RuntimeError("maintenance_failed")
    return inner

def _validate_public_health_url(value: str) -> str:
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
        raise ValueError("health URL must be public HTTPS without credentials")
    return value


def wait_http_health(url: str) -> None:
    for attempt in range(1, 61):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "boardreadyops-production-deployer"}, method="GET")
            with urllib.request.urlopen(request, timeout=5) as response:
                payload = response.read(64 * 1024 + 1)
            if len(payload) <= 64 * 1024:
                document = json.loads(payload.decode("utf-8"))
                if isinstance(document, dict) and document.get("ok") is True:
                    return
        except Exception:
            pass
        if attempt < 60:
            import time
            time.sleep(1)
    raise RuntimeError("health_check_failed")


def _runtime_matches(document: dict, revision: str) -> bool:
    return (
        isinstance(document, dict)
        and document.get("ready") is True
        and document.get("releaseSha") == revision
        and document.get("imageRevision") == revision
    )

def _cleanup_canary(runner, deployment_dir: str, candidate: str) -> None:
    canary = f"boardreadyops-canary-{candidate[:12]}"
    try:
        runner(["docker", "rm", "-f", canary], deployment_dir, 60)
    except Exception:
        pass


def _rollback(deployment_dir: str, previous: str, live_replaced: bool, runner, maintenance, health_check, health_url: str) -> bool:
    try:
        for command in rollback_commands(deployment_dir, previous, live_replaced):
            runner(command, deployment_dir, 10 * 60)
        if live_replaced:
            runtime = maintenance("runtime-status")
            if not _runtime_matches(runtime, previous):
                return False
            health_check(health_url)
        return True
    except Exception:
        return False


def run_deployment(
    deployment_dir: str,
    repository: str,
    health_url: str,
    *,
    runner=run_command,
    maintenance=maintenance_operation,
    http_get_json=github_get_json,
    health_check=wait_http_health,
) -> tuple[bool, str]:
    try:
        deployment_dir = _validate_deployment_dir(deployment_dir)
        repository = validate_repository(repository)
        health_url = _validate_public_health_url(health_url)
    except ValueError:
        return False, "invalid_configuration"

    repo_dir = f"{deployment_dir}/repo"
    try:
        previous = _validate_sha(runner(["git", "-C", repo_dir, "rev-parse", "HEAD"], deployment_dir, 30))
        runtime = maintenance("runtime-status")
    except Exception:
        return False, "runtime_identity_failed"
    if not _runtime_matches(runtime, previous):
        return False, "runtime_identity_drift"

    try:
        if runner(["git", "-C", repo_dir, "status", "--porcelain"], deployment_dir, 30):
            return False, "dirty_checkout"
        runner(["git", "-C", repo_dir, "fetch", "origin", "main"], deployment_dir, 120)
        candidate = _validate_sha(
            runner(["git", "-C", repo_dir, "rev-parse", "origin/main"], deployment_dir, 30)
        )
    except Exception:
        return False, "candidate_resolution_failed"

    if candidate == previous:
        return True, "no_change"
    try:
        runner(
            ["git", "-C", repo_dir, "merge-base", "--is-ancestor", previous, candidate],
            deployment_dir,
            30,
        )
    except Exception:
        return False, "non_fast_forward"

    admitted, admission_reason = candidate_admission(repository, candidate, http_get_json)
    if not admitted:
        return False, admission_reason

    try:
        topology = maintenance("topology-preflight")
    except Exception:
        return False, "topology_preflight_failed"
    if topology.get("ready") is not True:
        return False, "topology_preflight_failed"

    try:
        maintenance("backup-restore-verify")
    except Exception:
        return False, "backup_verification_failed"

    try:
        if runner(["git", "-C", repo_dir, "status", "--porcelain"], deployment_dir, 30):
            return False, "current_identity_changed"
        current = _validate_sha(runner(["git", "-C", repo_dir, "rev-parse", "HEAD"], deployment_dir, 30))
        runtime = maintenance("runtime-status")
    except Exception:
        return False, "current_identity_changed"
    if current != previous or not _runtime_matches(runtime, previous):
        return False, "current_identity_changed"

    live_replaced = False
    commands = deploy_commands(deployment_dir, candidate)
    try:
        runner(["git", "-C", repo_dir, "checkout", "--detach", candidate], deployment_dir, 60)
        runner(commands[0], deployment_dir, 30 * 60)
        runner(commands[1], deployment_dir, 15 * 60)
        _cleanup_canary(runner, deployment_dir, candidate)
        runner(commands[2], deployment_dir, 5 * 60)
        health_check("http://127.0.0.1:3004/api/health/ready")
        runner(["docker", "rm", "-f", f"boardreadyops-canary-{candidate[:12]}"], deployment_dir, 60)
        live_replaced = True
        runner(commands[3], deployment_dir, 10 * 60)
        runtime = maintenance("runtime-status")
        if not _runtime_matches(runtime, candidate):
            raise RuntimeError("runtime_identity_drift")
        health_check(health_url)
        return True, "deployed"
    except Exception:
        _cleanup_canary(runner, deployment_dir, candidate)
        if _rollback(
            deployment_dir,
            previous,
            live_replaced,
            runner,
            maintenance,
            health_check,
            health_url,
        ):
            return False, "deployment_failed_rolled_back"
        return False, "manual_intervention_required"

_LOCK_PATH = "/run/boardreadyops-deployer/deploy.lock"
_LATCH_PATH = "/var/lib/boardreadyops-deployer/manual-intervention-required"


def _emit_result(ok: bool, result: str) -> None:
    print(
        json.dumps(
            {"event": "boardreadyops_production_deployer", "ok": ok, "result": result},
            separators=(",", ":"),
            sort_keys=True,
        )
    )


def _write_manual_intervention_latch() -> None:
    fd = os.open(_LATCH_PATH, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.write(fd, b"manual_intervention_required\n")
    finally:
        os.close(fd)


def main() -> int:
    if fcntl is None:
        _emit_result(False, "unsupported_platform")
        return 1
    deployment_dir = os.environ.get("BOARDREADYOPS_DEPLOYMENT_DIR", "")
    repository = os.environ.get("BOARDREADYOPS_REPOSITORY", "")
    health_url = os.environ.get("BOARDREADYOPS_HEALTH_URL", "")

    try:
        lock_fd = os.open(_LOCK_PATH, os.O_WRONLY | os.O_CREAT, 0o600)
    except OSError:
        _emit_result(False, "lock_unavailable")
        return 1

    try:
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            _emit_result(False, "already_running")
            return 1
        if os.path.exists(_LATCH_PATH):
            _emit_result(False, "manual_intervention_required")
            return 1
        ok, result = run_deployment(deployment_dir, repository, health_url)
        if result == "manual_intervention_required":
            _write_manual_intervention_latch()
        _emit_result(ok, result)
        return 0 if ok else 1
    finally:
        os.close(lock_fd)


if __name__ == "__main__":
    raise SystemExit(main())
