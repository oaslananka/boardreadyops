#!/usr/bin/env bash
# One confirmed prior deployment plus the current, healthy BoardReadyOps runtime.
# Mark before a real deploy; retire only after the external post-deploy smoke test.
set -euo pipefail

repository=boardreadyops-web-runtime
rollback=boardreadyops-rollback-safety:verified
project=boardreadyops-cloud

fail() { printf 'cloud-image-retention: %s\n' "$*" >&2; exit 78; }

running_image() {
  local service cid ref status image_id first_image_id=''
  for service in web worker; do
    local -a ids=()
    mapfile -t ids < <(docker ps --filter "label=com.docker.compose.project=${project}" \
      --filter "label=com.docker.compose.service=${service}" --format '{{.ID}}')
    [[ "${#ids[@]}" -eq 1 && -n "${ids[0]}" ]] || fail "expected exactly one running ${service} container"
    cid="${ids[0]}"
    ref="$(docker inspect "$cid" --format '{{.Config.Image}}')" || fail "cannot inspect ${service} image"
    [[ "$ref" =~ ^boardreadyops-web-runtime:[0-9a-f]{40}$ ]] || fail "unexpected ${service} image reference"
    status="$(docker inspect "$cid" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}')" || fail "cannot check ${service} health"
    [[ "$status" == healthy ]] || fail "${service} is not healthy (${status})"
    image_id="$(docker inspect "$cid" --format '{{.Image}}')" || fail "cannot read ${service} image ID"
    [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "invalid ${service} image ID"
    [[ -z "$first_image_id" || "$first_image_id" == "$image_id" ]] || fail 'web and worker use different images'
    first_image_id="$image_id"
  done
  printf '%s\n' "$first_image_id"
}

check_revision() {
  local revision
  revision="$(docker image inspect "$1" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" || fail "missing image $1"
  [[ "$revision" =~ ^[0-9a-f]{40}$ ]] || fail "missing or invalid revision label for $1"
}

mode="${1:-}"
case "$mode" in
  pin)
    [[ "$#" -eq 1 ]] || fail 'usage: pin (before a real deploy)'
    active="$(running_image)"
    check_revision "$active"
    docker image tag "$active" "$rollback" || fail 'cannot pin last known healthy image'
    printf 'cloud-image-retention: pinned healthy prior runtime %s\n' "$active"
    ;;
  retire)
    [[ "$#" -eq 1 || ( "$#" -eq 2 && "$2" == --apply ) ]] || fail 'usage: retire [--apply]'
    active="$(running_image)"
    check_revision "$active"
    pinned="$(docker image inspect "$rollback" --format '{{.Id}}' 2>/dev/null)" || fail 'no verified rollback pin; refusing cleanup'
    [[ "$pinned" =~ ^sha256:[0-9a-f]{64}$ ]] || fail 'invalid rollback pin'
    [[ "$pinned" != "$active" ]] || fail 'rollback pin equals active image; refusing cleanup'
    check_revision "$pinned"

    # Honor references from *all* containers (including stopped ones); no force removal.
    mapfile -t container_ids < <(docker ps -aq)
    referenced=""
    if [[ "${#container_ids[@]}" -gt 0 ]]; then
      referenced="$(docker inspect "${container_ids[@]}" --format '{{.Image}}')" || fail 'cannot enumerate existing container image references'
    fi

    # Deliberately narrow scope; no shared images, BuildKit caches, volumes or untagged images.
    mapfile -t candidate_tags < <({
      docker image ls "${repository}:*" --format '{{.Repository}}:{{.Tag}}'
      docker image ls 'boardreadyops-rollback-safety:pre-*' --format '{{.Repository}}:{{.Tag}}'
    } | LC_ALL=C sort -u)
    for tag in "${candidate_tags[@]}"; do
      [[ "$tag" == "$repository":* || "$tag" == boardreadyops-rollback-safety:pre-* ]] || fail 'unexpected candidate tag'
      id="$(docker image inspect "$tag" --format '{{.Id}}')" || fail "cannot inspect $tag"
      [[ "$id" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "invalid candidate ID: $tag"
      if [[ "$id" == "$active" || "$id" == "$pinned" ]] || grep -qxF "$id" <<< "$referenced"; then
        printf 'cloud-image-retention: protected %s\n' "$tag"
        continue
      fi
      if [[ "${2:-}" == --apply ]]; then
        # Re-evaluate active and pinned identities immediately before mutation.
        [[ "$(running_image)" == "$active" ]] || fail 'running image changed during cleanup'
        [[ "$(docker image inspect "$rollback" --format '{{.Id}}')" == "$pinned" ]] || fail 'rollback pin changed during cleanup'
        docker image rm "$tag" || fail "cannot remove $tag; stopped without force"
        printf 'cloud-image-retention: retired %s\n' "$tag"
      else
        printf 'cloud-image-retention: would retire %s\n' "$tag"
      fi
    done
    ;;
  *) fail 'usage: pin | retire [--apply]' ;;
esac
