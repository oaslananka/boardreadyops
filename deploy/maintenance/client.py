#!/usr/bin/env python3
import json
import socket
import sys

SOCKET_PATH = "/run/boardreadyops-maintenance/control.sock"
OPERATIONS = frozenset({"runtime-status", "backup-restore-verify", "topology-preflight"})
RESPONSE_LIMIT = 64 * 1024


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] not in OPERATIONS:
        print("usage: boardreadyops-maintenance {runtime-status|backup-restore-verify|topology-preflight}", file=sys.stderr)
        return 2

    operation = sys.argv[1]
    timeout = 30 if operation in {"runtime-status", "topology-preflight"} else 15 * 60
    payload = (json.dumps({"version": 1, "operation": operation}, separators=(",", ":")) + "\n").encode("utf-8")

    connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    connection.settimeout(timeout)
    try:
        connection.connect(SOCKET_PATH)
        connection.sendall(payload)
        chunks: list[bytes] = []
        size = 0
        while size <= RESPONSE_LIMIT:
            part = connection.recv(min(4096, RESPONSE_LIMIT + 1 - size))
            if not part:
                break
            chunks.append(part)
            size += len(part)
            if b"\n" in part:
                break
    except OSError:
        print("boardreadyops maintenance service is unavailable", file=sys.stderr)
        return 1
    finally:
        connection.close()

    response = b"".join(chunks)
    if not response or len(response) > RESPONSE_LIMIT:
        print("boardreadyops maintenance response is invalid", file=sys.stderr)
        return 1
    try:
        document = json.loads(response.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        print("boardreadyops maintenance response is invalid", file=sys.stderr)
        return 1
    print(json.dumps(document, separators=(",", ":"), sort_keys=True))
    return 0 if isinstance(document, dict) and document.get("ok") is True else 1


if __name__ == "__main__":
    raise SystemExit(main())
