#!/usr/bin/env bash
# Read-only early guard: a separately managed BoardReadyOps runtime is not
# the commissioned Compose stack and must never be treated as its rollback.
set -euo pipefail

fail() {
  printf 'cloud-deploy topology preflight: %s\n' "$1" >&2
  exit 78
}

[[ "$#" -eq 2 && "$1" =~ ^[a-z0-9][a-z0-9_-]*$ ]] \
  || fail 'usage: cloud-deploy-topology-preflight.sh <compose-project> <worker-quiesced:0|1>'
project="$1"
quiesced="$2"
[[ "$quiesced" == 0 || "$quiesced" == 1 ]] || fail 'invalid worker-quiesced mode'

# A failed Docker query must never look like an empty or safe host. This
# inventory only reads running containers; it does not stop or recreate them.
containers="$(docker ps --format '{{.ID}}')" || fail 'cannot inspect active Docker containers'

web_count=0
worker_count=0
foreign_count=0
unexpected_count=0
while IFS= read -r container; do
  [[ -n "$container" ]] || continue
  metadata="$(
    docker inspect "$container" --format \
      '{{.Config.Image}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}'
  )" || fail 'cannot inspect active Docker container metadata'
  IFS='|' read -r image compose_project service <<< "$metadata"
  case "$image" in
    boardreadyops-web-runtime:*|boardreadyops-web-runtime@*)
      if [[ "$compose_project" != "$project" ]]; then
        foreign_count=$((foreign_count + 1))
      else
        case "$service" in
          web) web_count=$((web_count + 1)) ;;
          worker) worker_count=$((worker_count + 1)) ;;
          *) unexpected_count=$((unexpected_count + 1)) ;;
        esac
      fi
      ;;
  esac
done <<< "$containers"

[[ "$foreign_count" -eq 0 ]] \
  || fail 'a BoardReadyOps runtime is active under a different container owner; do not deploy a second stack'
[[ "$unexpected_count" -eq 0 ]] \
  || fail 'an unexpected BoardReadyOps process is active in the commissioned Compose project'
[[ "$web_count" -eq 1 ]] \
  || fail 'expected exactly one running web process in the commissioned Compose project'
if [[ "$quiesced" == 0 ]]; then
  [[ "$worker_count" -eq 1 ]] \
    || fail 'expected exactly one running worker in the commissioned Compose project'
else
  [[ "$worker_count" -eq 0 ]] \
    || fail 'a pre-quiesced worker must not be running in the commissioned Compose project'
  # The downstream image-retention pin still requires exactly one *stopped*
  # existing worker with clean exit before allowing any real replacement.
fi

printf '%s\n' 'cloud-deploy topology preflight: commissioned runtime owner verified'
