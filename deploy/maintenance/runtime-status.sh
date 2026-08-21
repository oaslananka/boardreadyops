#!/usr/bin/env bash
set -Eeuo pipefail

readonly project="boardreadyops-cloud"
readonly services=(postgres redis web worker)

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

release_sha="$(/usr/bin/git -C "$repo_dir" rev-parse --verify HEAD 2>/dev/null || true)"
[[ "$release_sha" =~ ^[0-9a-f]{40}$ ]] || fail "BoardReadyOps release identity is unavailable"

container_for_service() {
  local service="$1"
  local -a ids=()
  mapfile -t ids < <(
    /usr/bin/docker ps \
      --filter "label=com.docker.compose.project=${project}" \
      --filter "label=com.docker.compose.service=${service}" \
      --format '{{.ID}}'
  )
  [[ "${#ids[@]}" -eq 1 ]] || fail "BoardReadyOps runtime topology is unavailable"
  printf '%s\n' "${ids[0]}"
}

records=()
web_container=""
all_ready=true
for service in "${services[@]}"; do
  container="$(container_for_service "$service")"
  [[ "$service" != "web" ]] || web_container="$container"
  state="$(/usr/bin/docker inspect --format '{{.State.Status}}' "$container" 2>/dev/null || true)"
  health="$(/usr/bin/docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container" 2>/dev/null || true)"
  restart_count="$(/usr/bin/docker inspect --format '{{.RestartCount}}' "$container" 2>/dev/null || true)"
  [[ "$restart_count" =~ ^[0-9]+$ ]] || fail "BoardReadyOps runtime state is unavailable"
  [[ "$state" = "running" && "$health" = "healthy" ]] || all_ready=false
  records+=("${service}|${state}|${health}|${restart_count}")
done

[[ -n "$web_container" ]] || fail "BoardReadyOps web runtime is unavailable"
image_revision="$(/usr/bin/docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$web_container" 2>/dev/null || true)"
[[ "$image_revision" =~ ^[0-9a-f]{40}$ ]] || all_ready=false
[[ "$image_revision" = "$release_sha" ]] || all_ready=false

/usr/bin/python3 - "$release_sha" "$image_revision" "$all_ready" "${records[@]}" <<'PY'
import json
import sys

release_sha, image_revision, ready, *records = sys.argv[1:]
services = []
for record in records:
    service, state, health, restart_count = record.split("|", 3)
    services.append({
        "service": service,
        "state": state,
        "health": health,
        "restart_count": int(restart_count),
    })
print(json.dumps({
    "event": "boardreadyops_production_runtime_status",
    "releaseSha": release_sha,
    "imageRevision": image_revision if len(image_revision) == 40 else None,
    "ready": ready == "true",
    "services": services,
}, separators=(",", ":")))
PY
