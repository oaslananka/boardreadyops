#!/usr/bin/env bash
set -Eeuo pipefail

readonly project="boardreadyops-cloud"
readonly services=(postgres redis web worker caddy)
declare -Ar expected_names=(
  [postgres]="boardreadyops-cloud-postgres-1"
  [redis]="boardreadyops-cloud-redis-1"
  [web]="boardreadyops-cloud-web-1"
  [worker]="boardreadyops-cloud-worker-1"
  [caddy]="boardreadyops-cloud-caddy-1"
)

fail() {
  local message="$1"
  local exit_code="${2:-3}"
  printf '%s\n' "$message" >&2
  exit "$exit_code"
}

[[ "$#" -eq 2 && "$1" = "--deployment-dir" ]] || fail "deployment scope is required" 2
deployment_dir="$2"
[[ "$deployment_dir" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail "deployment scope is invalid" 2
normalized="$(/usr/bin/python3 - "$deployment_dir" <<'PY'
import posixpath
import sys
print(posixpath.normpath(sys.argv[1]))
PY
)"
[[ "$normalized" = "$deployment_dir" ]] || fail "deployment scope is invalid" 2
repo_dir="${deployment_dir}/repo"
[[ -d "$repo_dir" && ! -L "$repo_dir" ]] || fail "BoardReadyOps deployment is unavailable"

records=()
ready=true
for service in "${services[@]}"; do
  expected_name="${expected_names[$service]}"
  mapfile -t ids < <(
    /usr/bin/docker ps -a --filter "name=^/${expected_name}$" --format '{{.ID}}'
  )
  if [[ "${#ids[@]}" -ne 1 ]]; then
    records+=("${service}|${expected_name}|missing|missing|false")
    ready=false
    continue
  fi

  id="${ids[0]}"
  compose_project="$(/usr/bin/docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$id" 2>/dev/null || true)"
  compose_service="$(/usr/bin/docker inspect --format '{{ index .Config.Labels "com.docker.compose.service" }}' "$id" 2>/dev/null || true)"
  state="$(/usr/bin/docker inspect --format '{{ .State.Status }}' "$id" 2>/dev/null || true)"
  health="$(/usr/bin/docker inspect --format '{{ if .State.Health }}{{ .State.Health.Status }}{{ else }}none{{ end }}' "$id" 2>/dev/null || true)"
  owned=false
  [[ "$compose_project" = "$project" && "$compose_service" = "$service" ]] && owned=true

  [[ "$owned" = true && "$state" = running ]] || ready=false
  if [[ "$service" != caddy && "$health" != healthy ]]; then
    ready=false
  fi
  records+=("${service}|${expected_name}|${state:-unknown}|${health:-unknown}|${owned}")
done
mapfile -t prefixed_ids < <(
  /usr/bin/docker ps -a --filter "name=^/${project}-" --format '{{.ID}}'
)
for id in "${prefixed_ids[@]}"; do
  state="$(/usr/bin/docker inspect --format '{{ .State.Status }}' "$id" 2>/dev/null || true)"
  [[ "$state" = running ]] || continue
  compose_project="$(/usr/bin/docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$id" 2>/dev/null || true)"
  if [[ "$compose_project" != "$project" ]]; then
    ready=false
  fi
done

/usr/bin/python3 - "$ready" "${records[@]}" <<'PY'
import json
import sys

ready, *records = sys.argv[1:]
services = []
for record in records:
    service, name, state, health, owned = record.split("|", 4)
    services.append({"service": service, "name": name, "state": state, "health": health, "owned": owned == "true"})
print(json.dumps({
    "event": "boardreadyops_production_topology_preflight",
    "ready": ready == "true",
    "services": services,
}, separators=(",", ":")))
PY

[[ "$ready" = true ]] || exit 3
