#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

fail() {
  local message="$1"
  local exit_code="${2:-1}"
  printf '%s\n' "$message" >&2
  exit "$exit_code"
}

[[ "$#" -eq 2 && "$1" = "--deployment-dir" ]] || fail "usage: install.sh --deployment-dir /absolute/path" 2
BOARDREADYOPS_DEPLOYMENT_DIR="$2"

if [[ "${EUID}" -ne 0 ]]; then
  fail "run this installer as root"
fi

for command in python3 systemctl systemd-analyze install stat getent; do
  command -v "$command" >/dev/null || fail "$command is required"
done
command -v docker >/dev/null || fail "docker is required"
getent passwd exec-agent >/dev/null || fail "exec-agent account is required"
getent group exec-agent >/dev/null || fail "exec-agent group is required"

[[ "$BOARDREADYOPS_DEPLOYMENT_DIR" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail "deployment directory must be a safe absolute path" 2
normalized="$(python3 - "$BOARDREADYOPS_DEPLOYMENT_DIR" <<'PY'
import posixpath
import sys
print(posixpath.normpath(sys.argv[1]))
PY
)"
[[ "$normalized" = "$BOARDREADYOPS_DEPLOYMENT_DIR" ]] || fail "deployment directory must be normalized" 2
[[ -d "$BOARDREADYOPS_DEPLOYMENT_DIR" && ! -L "$BOARDREADYOPS_DEPLOYMENT_DIR" ]] || fail "deployment directory must be a real directory"
[[ -d "$BOARDREADYOPS_DEPLOYMENT_DIR/repo" && ! -L "$BOARDREADYOPS_DEPLOYMENT_DIR/repo" ]] || fail "deployment repository is unavailable"
[[ -f "$BOARDREADYOPS_DEPLOYMENT_DIR/repo/deploy/docker-compose.yml" ]] || fail "deployment compose file is unavailable"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for asset in server.py client.py runtime-status.sh backup-restore-verify.sh topology-preflight.sh boardreadyops-maintenance.service; do
  [[ -f "$SCRIPT_DIR/$asset" ]] || fail "missing maintenance asset: $asset"
done

INSTALL_DIR=/opt/boardreadyops-maintenance
CONFIG_DIR=/etc/boardreadyops-maintenance
DROPIN_DIR=/etc/systemd/system/boardreadyops-maintenance.service.d
SERVICE_PATH=/etc/systemd/system/boardreadyops-maintenance.service
CLIENT_PATH=/usr/local/bin/boardreadyops-maintenance

install -d -o root -g root -m 0755 "$INSTALL_DIR" "$CONFIG_DIR" "$DROPIN_DIR"
install -o root -g root -m 0755 "$SCRIPT_DIR/server.py" "$INSTALL_DIR/server.py"
install -o root -g root -m 0755 "$SCRIPT_DIR/runtime-status.sh" "$INSTALL_DIR/runtime-status.sh"
install -o root -g root -m 0755 "$SCRIPT_DIR/backup-restore-verify.sh" "$INSTALL_DIR/backup-restore-verify.sh"
install -o root -g root -m 0755 "$SCRIPT_DIR/topology-preflight.sh" "$INSTALL_DIR/topology-preflight.sh"
install -o root -g root -m 0755 "$SCRIPT_DIR/client.py" "$CLIENT_PATH"
install -o root -g root -m 0644 "$SCRIPT_DIR/boardreadyops-maintenance.service" "$SERVICE_PATH"

cat >"$CONFIG_DIR/maintenance.env" <<EOF
BOARDREADYOPS_DEPLOYMENT_DIR=${BOARDREADYOPS_DEPLOYMENT_DIR}
EOF
chown root:root "$CONFIG_DIR/maintenance.env"
chmod 0600 "$CONFIG_DIR/maintenance.env"

cat >"$DROPIN_DIR/20-deployment-scope.conf" <<EOF
[Service]
BindReadOnlyPaths=${BOARDREADYOPS_DEPLOYMENT_DIR}
EOF
chown root:root "$DROPIN_DIR/20-deployment-scope.conf"
chmod 0644 "$DROPIN_DIR/20-deployment-scope.conf"

systemd-analyze verify "$SERVICE_PATH" >/dev/null
systemctl daemon-reload
systemctl enable --now boardreadyops-maintenance.service
systemctl restart boardreadyops-maintenance.service

socket_path=/run/boardreadyops-maintenance/control.sock
for _ in $(seq 1 50); do
  [[ -S "$socket_path" ]] && break
  sleep 0.1
done
[[ -S "$socket_path" ]] || fail "maintenance socket did not become ready"
[[ "$(stat -c '%U:%G %a' "$socket_path")" = "root:exec-agent 660" ]] || fail "maintenance socket permissions are invalid"
systemctl is-active --quiet boardreadyops-maintenance.service || fail "maintenance service is not active"

printf 'boardreadyops_maintenance_installed deployment=%s\n' "$BOARDREADYOPS_DEPLOYMENT_DIR"
