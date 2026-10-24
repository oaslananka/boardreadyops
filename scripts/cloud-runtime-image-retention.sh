#!/usr/bin/env bash
# Keep the current BoardReadyOps runtime and one proven prior deployment.
# The successful tag is an identity marker, not an additional retained image.
set -euo pipefail

repository=boardreadyops-web-runtime
rollback=boardreadyops-rollback-safety:verified
successful=boardreadyops-rollback-safety:smoke-verified
project=boardreadyops-cloud
id_format='{{.Id}}'
revision_format='{{index .Config.Labels "org.opencontainers.image.revision"}}'

fail() { printf 'cloud-image-retention: %s\n' "$*" >&2; exit 78; }

image_identity() {
  local ref="$1"
  docker image inspect "$ref" --format "$id_format" || fail "cannot inspect image $ref"
}

check_revision() {
  local image_ref="$1"
  local revision
  revision="$(docker image inspect "$image_ref" --format "$revision_format")" || fail "missing image $image_ref"
  [[ "$revision" =~ ^[0-9a-f]{40}$ ]] || fail "missing or invalid revision label for $image_ref"
}

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

mode="${1:-}"
case "$mode" in
  pin)
    [[ "$#" -eq 2 && "$2" =~ ^[0-9a-f]{40}$ ]] || fail 'usage: pin <target-revision>'
    target_revision="$2"
    active="$(running_image)"
    check_revision "$active"
    active_revision="$(docker image inspect "$active" --format "$revision_format")" || fail 'cannot inspect active revision'
    known="$(docker image inspect "$successful" --format "$id_format" 2>/dev/null || true)"
    existing="$(docker image inspect "$rollback" --format "$id_format" 2>/dev/null || true)"
    if [[ -z "$known" ]]; then
      # First commission a healthy existing stack only when there is no older
      # pinned deployment whose external-smoke outcome we cannot reconstruct.
      [[ -z "$existing" ]] || fail 'rollback exists without successful marker; refusing to overwrite it'
      docker image tag "$active" "$successful" || fail 'cannot mark initial healthy runtime'
      known="$active"
    fi
    [[ "$known" =~ ^sha256:[0-9a-f]{64}$ ]] || fail 'invalid last successful image ID'
    check_revision "$known"
    if [[ "$known" != "$active" ]]; then
      # Current stack may have passed container health but FAILED browser smoke.
      # Never promote that image over the last externally verified deployment.
      if [[ "$existing" != "$known" ]]; then
        docker image tag "$known" "$rollback" || fail 'cannot restore previous verified rollback'
      fi
      printf 'cloud-image-retention: preserved last successful runtime %s (current runtime unverified)\n' "$known"
      exit 0
    fi
    if [[ "$active_revision" == "$target_revision" && -n "$existing" && "$existing" != "$active" ]]; then
      check_revision "$existing"
      printf 'cloud-image-retention: unchanged revision; preserved existing distinct rollback %s\n' "$existing"
      exit 0
    fi
    docker image tag "$active" "$rollback" || fail 'cannot pin last known healthy image'
    printf 'cloud-image-retention: pinned healthy prior runtime %s\n' "$active"
    ;;
  confirm)
    [[ "$#" -eq 2 && "$2" =~ ^[0-9a-f]{40}$ ]] || fail 'usage: confirm <deployed-revision> (after external smoke)'
    active="$(running_image)"
    check_revision "$active"
    actual_revision="$(docker image inspect "$active" --format "$revision_format")" || fail 'cannot inspect deployed revision'
    [[ "$actual_revision" == "$2" ]] || fail 'post-smoke deployed image revision differs from requested revision'
    known="$(image_identity "$successful")"
    pinned="$(image_identity "$rollback")"
    [[ "$known" =~ ^sha256:[0-9a-f]{64}$ && "$pinned" =~ ^sha256:[0-9a-f]{64}$ ]] || fail 'invalid deployment markers'
    # If the current stack was not the last known good deployment, the old
    # successful marker MUST remain protected by the rollback tag until smoke.
    [[ "$known" == "$active" || "$pinned" == "$known" ]] || fail 'previous successful image is not protected; refusing confirmation'
    docker image tag "$active" "$successful" || fail 'cannot mark externally verified runtime'
    printf 'cloud-image-retention: recorded externally verified deployment %s\n' "$active"
    ;;
  retire)
    [[ "$#" -eq 1 || ( "$#" -eq 2 && "$2" == --apply ) || ( "$#" -eq 3 && "$2" == --apply && "$3" == --allow-unchanged ) ]] || fail 'usage: retire [--apply [--allow-unchanged]]'
    active="$(running_image)"
    check_revision "$active"
    pinned="$(docker image inspect "$rollback" --format "$id_format" 2>/dev/null)" || fail 'no verified rollback pin; refusing cleanup'
    known="$(docker image inspect "$successful" --format "$id_format" 2>/dev/null)" || fail 'no last successful deployment marker; refusing cleanup'
    [[ "$pinned" =~ ^sha256:[0-9a-f]{64}$ && "$known" =~ ^sha256:[0-9a-f]{64}$ ]] || fail 'invalid deployment markers'
    [[ "$known" == "$active" || "$known" == "$pinned" ]] || fail 'last successful deployment is not protected'
    if [[ "$pinned" == "$active" ]]; then
      if [[ "${3:-}" == --allow-unchanged && "$known" == "$active" ]]; then
        printf 'cloud-image-retention: unchanged runtime; no distinct rollback available, nothing retired\n'
        exit 0
      fi
      fail 'rollback pin equals active image; refusing cleanup'
    fi
    check_revision "$pinned"
    check_revision "$known"

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

    # No shared images, BuildKit caches, volumes, or unrelated projects.
    runtime_tags="$(docker image ls "${repository}:*" --format '{{.Repository}}:{{.Tag}}')" || fail 'cannot list runtime tags'
    legacy_tags="$(docker image ls 'boardreadyops-rollback-safety:pre-*' --format '{{.Repository}}:{{.Tag}}')" || fail 'cannot list legacy rollback tags'
    candidates="$(printf '%s\n' "$runtime_tags" "$legacy_tags" | awk 'NF' | LC_ALL=C sort -u)" || fail 'cannot enumerate retirement candidates'
    while IFS= read -r tag; do
      [[ -n "$tag" ]] || continue
      [[ "$tag" == "$repository":* || "$tag" == boardreadyops-rollback-safety:pre-* ]] || fail 'unexpected candidate tag'
      id="$(image_identity "$tag")"
      [[ "$id" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "invalid candidate ID: $tag"
      if [[ "$id" == "$active" || "$id" == "$pinned" || "$id" == "$known" ]] || grep -qxF "$id" <<< "$referenced"; then
        printf 'cloud-image-retention: protected %s\n' "$tag"
        continue
      fi
      if [[ "${2:-}" == --apply ]]; then
        [[ "$(running_image)" == "$active" ]] || fail 'running image changed during cleanup'
        [[ "$(image_identity "$rollback")" == "$pinned" ]] || fail 'rollback pin changed during cleanup'
        [[ "$(image_identity "$successful")" == "$known" ]] || fail 'successful deployment marker changed during cleanup'
        docker image rm "$tag" || fail "cannot remove $tag; stopped without force"
        printf 'cloud-image-retention: retired %s\n' "$tag"
      else
        printf 'cloud-image-retention: would retire %s\n' "$tag"
      fi
    done <<< "$candidates"
    ;;
  *) fail 'usage: pin <target-revision> | confirm <deployed-revision> | retire [--apply [--allow-unchanged]]' ;;
esac
