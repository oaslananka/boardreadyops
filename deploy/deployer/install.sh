#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

fail() {
  printf '%s\n' "$1" >&2
  exit "${2:-1}"
}

[[ "${EUID}" -eq 0 ]] || fail "run this installer as root"

DEPLOYMENT_DIR=""
REPOSITORY=""
HEALTH_URL=""
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --deployment-dir) [[ "$#" -ge 2 ]] || fail "missing deployment directory" 2; DEPLOYMENT_DIR="$2"; shift 2 ;;
    --repository) [[ "$#" -ge 2 ]] || fail "missing repository" 2; REPOSITORY="$2"; shift 2 ;;
    --health-url) [[ "$#" -ge 2 ]] || fail "missing health URL" 2; HEALTH_URL="$2"; shift 2 ;;
    *) fail "unsupported installer argument" 2 ;;
  esac
done

for command in python3 git docker setpriv systemctl systemd-analyze install stat; do
  command -v "$command" >/dev/null || fail "$command is required"
done
command -v boardreadyops-maintenance >/dev/null || fail "boardreadyops-maintenance is required"
[[ "$DEPLOYMENT_DIR" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail "deployment directory must be a safe absolute path" 2
normalized="$(python3 - "$DEPLOYMENT_DIR" <<'PY'
import posixpath, sys
print(posixpath.normpath(sys.argv[1]))
PY
)"
[[ "$normalized" = "$DEPLOYMENT_DIR" && "$DEPLOYMENT_DIR" != "/" ]] || fail "deployment directory must be normalized" 2
[[ -d "$DEPLOYMENT_DIR" && ! -L "$DEPLOYMENT_DIR" ]] || fail "deployment directory must be a real directory"
[[ -d "$DEPLOYMENT_DIR/repo" && ! -L "$DEPLOYMENT_DIR/repo" ]] || fail "deployment repository is unavailable"
[[ -f "$DEPLOYMENT_DIR/repo/deploy/docker-compose.yml" ]] || fail "deployment compose file is unavailable"
[[ -f "$DEPLOYMENT_DIR/deploy.sh" && -x "$DEPLOYMENT_DIR/deploy.sh" && ! -L "$DEPLOYMENT_DIR/deploy.sh" ]] || fail "deployment wrapper must be an executable regular file"
DEPLOYMENT_USER="$(stat -c %U "$DEPLOYMENT_DIR/repo")"
DEPLOYMENT_GROUP="$(stat -c %G "$DEPLOYMENT_DIR/repo")"
[[ "$DEPLOYMENT_USER" =~ ^[A-Za-z_][A-Za-z0-9_.-]{0,31}$ ]] || fail "deployment repository owner must be a named local user"
[[ "$DEPLOYMENT_GROUP" =~ ^[A-Za-z_][A-Za-z0-9_.-]{0,31}$ ]] || fail "deployment repository group must be a named local group"

[[ "$REPOSITORY" =~ ^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9_.-]{1,100}$ ]] || fail "repository must use owner/name format" 2
repo_name="${REPOSITORY#*/}"
[[ "$repo_name" != "." && "$repo_name" != ".." ]] || fail "repository name is invalid" 2

python3 - "$HEALTH_URL" <<'PY' || fail "health URL must be public HTTPS without credentials" 2
import sys
from urllib.parse import urlsplit
value = sys.argv[1]
parsed = urlsplit(value)
valid = parsed.scheme == "https" and bool(parsed.hostname) and not parsed.username and not parsed.password and not parsed.fragment
valid = valid and not any(char.isspace() for char in value) and "\n" not in value and "\r" not in value
raise SystemExit(0 if valid else 1)
PY
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for asset in production-deployer.py boardreadyops-deployer.service boardreadyops-deployer.timer; do
  [[ -f "$SCRIPT_DIR/$asset" ]] || fail "missing deployer asset: $asset"
done

INSTALL_DIR=/opt/boardreadyops-deployer
CONFIG_DIR=/etc/boardreadyops-deployer
DROPIN_DIR=/etc/systemd/system/boardreadyops-deployer.service.d
SERVICE_PATH=/etc/systemd/system/boardreadyops-deployer.service
TIMER_PATH=/etc/systemd/system/boardreadyops-deployer.timer
CONFIG_PATH=/etc/boardreadyops-deployer/deployer.env
DROPIN_PATH="$DROPIN_DIR/20-deployment-scope.conf"

install -d -o root -g root -m 0755 "$INSTALL_DIR" "$DROPIN_DIR"
install -d -o root -g root -m 0700 "$CONFIG_DIR"
install -o root -g root -m 0755 "$SCRIPT_DIR/production-deployer.py" "$INSTALL_DIR/production-deployer.py"
install -o root -g root -m 0644 "$SCRIPT_DIR/boardreadyops-deployer.service" "$SERVICE_PATH"
install -o root -g root -m 0644 "$SCRIPT_DIR/boardreadyops-deployer.timer" "$TIMER_PATH"

python3 - "$DEPLOYMENT_DIR" "$REPOSITORY" "$HEALTH_URL" "$DEPLOYMENT_USER" "$DEPLOYMENT_GROUP" >"$CONFIG_PATH" <<'PY'
import sys
def escape(value):
    return value.replace("\\", "\\\\").replace('"', '\\"')
print(f'BOARDREADYOPS_DEPLOYMENT_DIR="{escape(sys.argv[1])}"')
print(f'BOARDREADYOPS_REPOSITORY="{escape(sys.argv[2])}"')
print(f'BOARDREADYOPS_HEALTH_URL="{escape(sys.argv[3])}"')
print(f'BOARDREADYOPS_DEPLOYMENT_USER="{escape(sys.argv[4])}"')
print(f'BOARDREADYOPS_DEPLOYMENT_GROUP="{escape(sys.argv[5])}"')
PY
chown root:root "$CONFIG_PATH"
chmod 0600 "$CONFIG_PATH"

cat >"$DROPIN_PATH" <<EOF
[Service]
ReadWritePaths=${DEPLOYMENT_DIR}
EOF
chown root:root "$DROPIN_PATH"
chmod 0644 "$DROPIN_PATH"

systemd-analyze verify "$SERVICE_PATH" "$TIMER_PATH" >/dev/null
systemctl daemon-reload

printf 'boardreadyops_deployer_installed deployment=%s repository=%s timer=disabled\n' "$DEPLOYMENT_DIR" "$REPOSITORY"
