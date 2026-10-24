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
    local ids_list
    ids_list="$(docker ps --filter "label=com.docker.compose.project=${project}" \
      --filter "label=com.docker.compose.service=${service}" --format '{{.ID}}')" || fail "cannot list ${service} containers"
    [[ -n "$ids_list" && "$ids_list" != *$'\n'* ]] || fail "expected exactly one running ${service} container"
    cid="$ids_list"
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
  local image_ref="$1"
  local revision
  revision="$(docker image inspect "$image_ref" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" || fail "missing image $image_ref"
  [[ "$revision" =~ ^[0-9a-f]{40}$ ]] || fail "missing or invalid revision label for $image_ref"
}

mode="${1:-}"
case "$mode" in
  pin)
    [[ "$#" -eq 2 && "$2" =~ ^[0-9a-f]{40}$ ]] || fail 'usage: pin <target-revision>'
    target_revision="$2"
    active="$(running_image)"
    check_revision "$active"
    active_revision="$(docker image inspect "$active" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" || fail 'cannot inspect active revision'
    if [[ "$active_revision" == "$target_revision" ]]; then
      # An unchanged-code redeploy must not replace an older proven rollback
      # with the currently running image merely to rebuild the same commit.
      existing="$(docker image inspect "$rollback" --format '{{.Id}}' 2>/dev/null || true)"
      if [[ -n "$existing" && "$existing" != "$active" ]]; then
        check_revision "$existing"
        printf 'cloud-image-retention: unchanged revision; preserved existing distinct rollback %s\n' "$existing"
        exit 0
      fi
    fi
    docker image tag "$active" "$rollback" || fail 'cannot pin last known healthy image'
    printf 'cloud-image-retention: pinned healthy prior runtime %s\n' "$active"
    ;;
  retire)
    [[ "$#" -eq 1 || ( "$#" -eq 2 && "$2" == --apply ) || ( "$#" -eq 3 && "$2" == --apply && "$3" == --allow-unchanged ) ]] || fail 'usage: retire [--apply [--allow-unchanged]]'
    active="$(running_image)"
    check_revision "$active"
    pinned="$(docker image inspect "$rollback" --format '{{.Id}}' 2>/dev/null)" || fail 'no verified rollback pin; refusing cleanup'
    [[ "$pinned" =~ ^sha256:[0-9a-f]{64}$ ]] || fail 'invalid rollback pin'
    if [[ "$pinned" == "$active" ]]; then
      if [[ "${3:-}" == --allow-unchanged ]]; then
        printf 'cloud-image-retention: unchanged runtime; no distinct rollback available, nothing retired\n'
        exit 0
      fi
      fail 'rollback pin equals active image; refusing cleanup'
    fi
    check_revision "$pinned"

    # Honor references from *all* containers (including stopped ones); no force removal.
    container_list="$(docker ps -aq)" || fail 'cannot list other container image references'
    referenced=""
    if [[ -n "$container_list" ]]; then
      container_ids=()
      while IFS= read -r container_id; do
        [[ "$container_id" =~ ^[a-fA-F0-9]+$ ]] || fail 'invalid container ID returned by Docker'
        container_ids+=("$container_id")
      done <<< "$container_list"
      referenced="$(docker inspect "${container_ids[@]}" --format '{{.Image}}')" || fail 'cannot enumerate existing container image references'
    fi

    # Deliberately narrow scope; no shared images, BuildKit caches, volumes or untagged images.
    runtime_tags="$(docker image ls "${repository}:*" --format '{{.Repository}}:{{.Tag}}')" || fail 'cannot list runtime tags'
    legacy_tags="$(docker image ls 'boardreadyops-rollback-safety:pre-*' --format '{{.Repository}}:{{.Tag}}')" || fail 'cannot list legacy rollback tags'
    candidates="$(printf '%s\n' "$runtime_tags" "$legacy_tags" | awk 'NF' | LC_ALL=C sort -u)" || fail 'cannot enumerate retirement candidates'
    while IFS= read -r tag; do
      [[ -n "$tag" ]] || continue
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
    done <<< "$candidates"
    ;;
  *) fail 'usage: pin <target-revision> | retire [--apply [--allow-unchanged]]' ;;
esac
