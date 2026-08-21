#!/usr/bin/env python3
import json
import os
import socket
import stat
import struct
import subprocess
from pathlib import PurePosixPath

ALLOWED_USER = "exec-agent"
SOCKET_GROUP = "exec-agent"
SOCKET_PATH = "/run/boardreadyops-maintenance/control.sock"
SOCKET_MODE = stat.S_IRUSR | stat.S_IWUSR | stat.S_IRGRP | stat.S_IWGRP
INSTALL_ROOT = "/opt/boardreadyops-maintenance"
REQUEST_LIMIT = 1024
RESPONSE_LIMIT = 64 * 1024
OPERATIONS = frozenset({"runtime-status", "backup-restore-verify"})
SAFE_ENV = {
    "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    "LANG": "C.UTF-8",
    "LC_ALL": "C.UTF-8",
}


def parse_request(payload: bytes) -> str:
    if not payload or len(payload) > REQUEST_LIMIT:
        raise ValueError("invalid request size")
    try:
        document = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("invalid request") from exc
    if not isinstance(document, dict) or set(document) != {"version", "operation"}:
        raise ValueError("invalid request fields")
    if document.get("version") != 1:
        raise ValueError("unsupported request version")
    operation = document.get("operation")
    if not isinstance(operation, str) or operation not in OPERATIONS:
        raise ValueError("unsupported operation")
    return operation


def validate_deployment_dir(value: str) -> str:
    if not value.startswith("/") or "\x00" in value:
        raise ValueError("deployment directory must be absolute")
    normalized = str(PurePosixPath(value))
    if normalized != value or not value.strip("/"):
        raise ValueError("deployment directory must be normalized")
    return value


def command_for_operation(operation: str, deployment_dir: str) -> list[str]:
    deployment_dir = validate_deployment_dir(deployment_dir)
    if operation == "runtime-status":
        helper = f"{INSTALL_ROOT}/runtime-status.sh"
    elif operation == "backup-restore-verify":
        helper = f"{INSTALL_ROOT}/backup-restore-verify.sh"
    else:
        raise ValueError("unsupported operation")
    return [helper, "--deployment-dir", deployment_dir]


def response_bytes(value: dict) -> bytes:
    encoded = (json.dumps(value, separators=(",", ":"), sort_keys=True) + "\n").encode("utf-8")
    if len(encoded) > RESPONSE_LIMIT:
        return b'{"error":"response_too_large","ok":false}\n'
    return encoded


def run_operation(operation: str, deployment_dir: str) -> dict:
    timeout = 30 if operation == "runtime-status" else 15 * 60
    try:
        result = subprocess.run(
            command_for_operation(operation, deployment_dir),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=SAFE_ENV,
            timeout=timeout,
            check=False,
            shell=False,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "operation": operation, "error": "operation_timeout"}
    except OSError:
        return {"ok": False, "operation": operation, "error": "operation_unavailable"}

    if result.returncode != 0:
        return {
            "ok": False,
            "operation": operation,
            "error": "operation_failed",
            "exitCode": int(result.returncode),
        }
    if len(result.stdout.encode("utf-8")) > RESPONSE_LIMIT // 2:
        return {"ok": False, "operation": operation, "error": "operation_output_too_large"}
    try:
        parsed = json.loads(result.stdout)
    except json.JSONDecodeError:
        return {"ok": False, "operation": operation, "error": "operation_output_invalid"}
    if not isinstance(parsed, dict):
        return {"ok": False, "operation": operation, "error": "operation_output_invalid"}
    return {"ok": True, "operation": operation, "result": parsed}


def peer_uid(connection: socket.socket) -> int:
    raw = connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i"))
    _pid, uid, _gid = struct.unpack("3i", raw)
    return uid


def read_request(connection: socket.socket) -> bytes:
    chunks: list[bytes] = []
    size = 0
    while size <= REQUEST_LIMIT:
        chunk = connection.recv(min(256, REQUEST_LIMIT + 1 - size))
        if not chunk:
            break
        chunks.append(chunk)
        size += len(chunk)
        if b"\n" in chunk:
            break
    payload = b"".join(chunks)
    if len(payload) > REQUEST_LIMIT:
        raise ValueError("invalid request size")
    return payload


def remove_stale_socket(path: str) -> None:
    try:
        metadata = os.lstat(path)
    except FileNotFoundError:
        return
    if metadata.st_uid != 0 or not stat.S_ISSOCK(metadata.st_mode):
        raise RuntimeError("maintenance socket path is unsafe")
    os.unlink(path)


def main() -> int:
    import grp
    import pwd

    if os.geteuid() != 0:
        raise SystemExit("maintenance server must run as root")
    deployment_dir = validate_deployment_dir(os.environ.get("BOARDREADYOPS_DEPLOYMENT_DIR", ""))
    allowed_uid = pwd.getpwnam(ALLOWED_USER).pw_uid
    socket_gid = grp.getgrnam(SOCKET_GROUP).gr_gid
    runtime_dir = os.path.dirname(SOCKET_PATH)
    if not os.path.isdir(runtime_dir):
        raise SystemExit("maintenance runtime directory is unavailable")

    remove_stale_socket(SOCKET_PATH)
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        listener.bind(SOCKET_PATH)
        os.chown(SOCKET_PATH, 0, socket_gid)
        # Intentionally root:exec-agent rw only; SOCKET_MODE contains no world permission bits.
        os.chmod(SOCKET_PATH, SOCKET_MODE)
        listener.listen(8)
        while True:
            connection, _ = listener.accept()
            with connection:
                if peer_uid(connection) != allowed_uid:
                    connection.sendall(response_bytes({"ok": False, "error": "unauthorized_peer"}))
                    continue
                try:
                    operation = parse_request(read_request(connection))
                    response = run_operation(operation, deployment_dir)
                except ValueError:
                    response = {"ok": False, "error": "invalid_request"}
                connection.sendall(response_bytes(response))
    finally:
        listener.close()
        try:
            remove_stale_socket(SOCKET_PATH)
        except RuntimeError:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
