#!/usr/bin/env bash
# Operator-only migration of the non-secret repository allow-list bind mount.
# Merging this file does not execute it. --check is the default; --apply and
# --rollback require a separately approved production change.
set -euo pipefail

mode="${1:---check}"
case "${mode}" in --check|--apply|--rollback) ;; *) echo 'usage: migrate-cloud-release-policy.sh [--check|--apply|--rollback]' >&2; exit 64 ;; esac

deploy_root="/home/ubuntu/boardreadyops-cloud"
legacy_file="/opt/boardreadyops-cloud/release-repositories"
policy_file="${deploy_root}/release-repositories"
override="${deploy_root}/compose.release-policy.yml"
backup="${deploy_root}/compose.release-policy.legacy.yml"
runbook="${deploy_root}/deploy.sh"
container_path="/run/policies/repositories"
old_binding="${legacy_file}:${container_path}:ro"
new_binding="${policy_file}:${container_path}:ro"

fail() { printf 'release-policy migration: %s\n' "$1" >&2; exit 78; }
[[ -d "${deploy_root}" ]] && [[ ! -L "${deploy_root}" ]] || fail 'deployment root is missing or a symlink'
[[ -x "${runbook}" ]] && [[ ! -L "${runbook}" ]] || fail 'deployment runbook is missing or a symlink'
[[ -f "${override}" ]] && [[ ! -L "${override}" ]] || fail 'policy override is missing or a symlink'
[[ "$(stat -c '%u' "${override}")" = "$(id -u)" ]] || fail 'policy override is not owned by the deploy account'
[[ -w "${deploy_root}" ]] || fail 'deployment root is not writable'

count_binding() { local binding="$1"; grep -Fc -- "${binding}" "${override}" || true; }
old_count="$(count_binding "${old_binding}")"
new_count="$(count_binding "${new_binding}")"
case "${old_count}:${new_count}:${mode}" in
  2:0:--check|2:0:--apply) source_file="${legacy_file}"; target_file="${policy_file}" ;;
  0:2:--rollback) source_file="${policy_file}"; target_file="${legacy_file}" ;;
  *) fail 'unexpected policy override topology or migration mode (requires two consistent bindings)' ;;
esac
[[ -f "${source_file}" ]] && [[ ! -L "${source_file}" ]] || fail 'active policy is missing or a symlink'
[[ "$(stat -c '%s' "${source_file}")" -le 65536 ]] || fail 'active policy exceeds 64 KiB'
if [[ "${mode}" = --rollback ]]; then
  [[ -f "${backup}" ]] && [[ ! -L "${backup}" ]] || fail 'previous override backup is unavailable'
  [[ "$(grep -Fc -- "${old_binding}" "${backup}" || true)" = 2 ]] || fail 'previous override backup has unexpected bindings'
  cmp -s "${legacy_file}" "${policy_file}" || fail 'policy changed since migration; reconcile before rollback to avoid losing grants'
else
  [[ ! -e "${backup}" ]] && [[ ! -L "${backup}" ]] || fail 'previous override backup already exists'
  [[ ! -e "${policy_file}" ]] && [[ ! -L "${policy_file}" ]] || fail 'new policy location already exists'
fi

container_for() {
  local service="$1" ids count
  ids="$(docker ps --filter label=com.docker.compose.project=boardreadyops-cloud --filter "label=com.docker.compose.service=${service}" --format '{{.ID}}')"
  count="$(printf '%s\n' "${ids}" | awk 'NF { n++ } END {print n+0}')"
  [[ "${count}" = 1 ]] || fail "expected exactly one running ${service} container"
  printf '%s\n' "${ids}" | awk 'NF {print; exit}'
}
web="$(container_for web)"
worker="$(container_for worker)"
web_image_ref="$(docker inspect "${web}" --format '{{.Config.Image}}')"
worker_image_ref="$(docker inspect "${worker}" --format '{{.Config.Image}}')"
image_id="$(docker inspect "${web}" --format '{{.Image}}')"
[[ "${web_image_ref}" = "${worker_image_ref}" ]] || fail 'web and worker image tags differ'
[[ "${image_id}" = "$(docker inspect "${worker}" --format '{{.Image}}')" ]] || fail 'web and worker image IDs differ'
case "${web_image_ref}" in boardreadyops-web-runtime:*) ;; *) fail 'unexpected runtime image name' ;; esac
image_tag="${web_image_ref#boardreadyops-web-runtime:}"
[[ -n "${image_tag}" ]] || fail 'running image tag is empty'
[[ "$(docker image inspect "${web_image_ref}" --format '{{.Id}}')" = "${image_id}" ]] || fail 'running image tag no longer points to live image'

verify_mounts() {
  local expected="$1" service cid env_path mount_path actual_image
  for service in web worker; do
    cid="$(container_for "${service}")"
    env_path="$(docker inspect "${cid}" --format '{{range .Config.Env}}{{println .}}{{end}}' | awk -F= '$1=="BOARDREADYOPS_RELEASE_REPOSITORIES_FILE" {print $2; exit}')"
    mount_path="$(docker inspect "${cid}" --format '{{range .Mounts}}{{printf "%s|%s\n" .Source .Destination}}{{end}}' | awk -F'|' -v dest="${container_path}" '$2==dest {print $1; exit}')"
    actual_image="$(docker inspect "${cid}" --format '{{.Image}}')"
    [[ "${env_path}" = "${container_path}" ]] && [[ "${mount_path}" = "${expected}" ]] && [[ "${actual_image}" = "${image_id}" ]] || return 1
    docker exec "${cid}" node -e "fetch('http://127.0.0.1:$([[ "${service}" = web ]] && echo 3000 || echo 3001)/$([[ "${service}" = web ]] && echo api/health/ready || echo health/ready)',{cache:'no-store'}).then(async r=>{const b=await r.json();if(!r.ok||b?.ok!==true)process.exit(1)}).catch(()=>process.exit(1))" >/dev/null 2>&1 || return 1
    docker exec "${cid}" cat "${container_path}" | cmp -s - "${expected}" || return 1
  done
}
# Allow a bounded warm-up after replacement; wrong images and mounts still fail closed.
wait_for_mounts() {
  local expected="$1" attempt
  for attempt in $(seq 1 30); do
    if verify_mounts "${expected}"; then return 0; fi
    if [[ "${attempt}" != 30 ]]; then sleep 2; fi
  done
  return 1
}
verify_mounts "${source_file}" || fail 'current mounts, pinned image, policy contents or readiness are not consistent'

candidate=""
policy_stage=""
cutover=0
committed=0
backup_created=0
policy_installed=0
cleanup() {
  [[ -z "${candidate}" ]] || rm -f "${candidate}"
  [[ -z "${policy_stage}" ]] || rm -f "${policy_stage}"
}
restore_legacy() {
  # The old policy and previous override are retained unchanged on success.
  local stage
  stage="$(mktemp "${override}.restore.XXXXXX")" || return 1
  if ! cp -p "${backup}" "${stage}"; then rm -f "${stage}"; return 1; fi
  if ! mv "${stage}" "${override}"; then rm -f "${stage}"; return 1; fi
  if ! BOARDREADYOPS_IMAGE_TAG="${image_tag}" "${runbook}" -f "${override}" up -d --no-deps --force-recreate web worker >/dev/null; then return 1; fi
  wait_for_mounts "${legacy_file}" || return 1
}
finish() {
  local result="$?"
  trap - EXIT
  if [[ "${cutover}" = 1 ]] && [[ "${committed}" = 0 ]]; then
    if ! restore_legacy; then
      echo 'release-policy migration: CRITICAL: rollback FAILED; old file and backup retained, operator must inspect deployment' >&2
      cleanup
      exit 79
    fi
    echo 'release-policy migration: previous override and consumers restored' >&2
    if [[ "${mode}" = --apply ]]; then
      [[ "${policy_installed}" = 0 ]] || rm -f "${policy_file}"
      [[ "${backup_created}" = 0 ]] || rm -f "${backup}"
    fi
  elif [[ "${cutover}" = 0 ]] && [[ "${committed}" = 0 ]] && [[ "${mode}" = --apply ]]; then
    [[ "${policy_installed}" = 0 ]] || rm -f "${policy_file}"
    [[ "${backup_created}" = 0 ]] || rm -f "${backup}"
  fi
  cleanup
  exit "${result}"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ "${mode}" = --rollback ]]; then
  # Preflight the restored topology before touching the live override.
  candidate="$(mktemp "${override}.check.XXXXXX")"
  cp -p "${backup}" "${candidate}"
else
  candidate="$(mktemp "${override}.next.XXXXXX")"
  sed "s|${old_binding}|${new_binding}|g" "${override}" > "${candidate}"
  chmod --reference="${override}" "${candidate}"
  [[ "$(grep -Fc -- "${new_binding}" "${candidate}" || true)" = 2 ]] || fail 'new override bindings are not consistent'
fi

# Fail before mutation unless the host-local runbook really honors the pinned
# image (current legacy host wrappers can overwrite BOARDREADYOPS_IMAGE_TAG).
# Parse in memory; never print or persist Doppler-provided Compose configuration.
if ! BOARDREADYOPS_IMAGE_TAG="${image_tag}" "${runbook}" -f "${candidate}" config --format json | \
  python3 -c '
import json,sys
expected_image, expected_source, target = sys.argv[1:]
try:
  services=json.load(sys.stdin)["services"]
  for name in ("web", "worker"):
    service=services[name]
    assert service.get("image") == expected_image
    mounts=[m for m in service.get("volumes",[]) if m.get("target")==target]
    assert len(mounts)==1 and mounts[0].get("source")==expected_source and mounts[0].get("read_only") is True
except (ValueError, KeyError, AssertionError, TypeError):
  sys.exit(1)
' "${web_image_ref}" "${target_file}" "${container_path}" >/dev/null; then
  fail 'deployer does not preserve the pinned live image or expected read-only policy mount'
fi

if [[ "${mode}" = --check ]]; then
  echo 'release-policy migration: preflight passed; no deployment changes performed'
  exit 0
fi
if [[ "${mode}" = --apply ]]; then
  policy_stage="$(mktemp "${policy_file}.next.XXXXXX")"
  cp "${legacy_file}" "${policy_stage}"
  chmod 0644 "${policy_stage}"
  cmp -s "${legacy_file}" "${policy_stage}" || fail 'staged policy differs from original'
  cp -p "${override}" "${backup}" || fail 'cannot preserve previous override'
  backup_created=1
  mv "${policy_stage}" "${policy_file}" || fail 'cannot install new policy'
  policy_installed=1
  policy_stage=""
  # EXIT trap restores the old mount and tests health if anything fails after this point.
  cutover=1
  mv "${candidate}" "${override}" || fail 'cannot install new override'
  candidate=""
  BOARDREADYOPS_IMAGE_TAG="${image_tag}" "${runbook}" -f "${override}" up -d --no-deps --force-recreate web worker >/dev/null || fail 'consumer recreation failed'
  wait_for_mounts "${policy_file}" || fail 'new consumer mount, image or readiness verification failed'
  committed=1
  echo 'release-policy migration: committed; original root-owned file and previous override retained for rollback'
else
  cutover=1
  mv "${candidate}" "${override}" || fail 'cannot restore previous override'
  candidate=""
  BOARDREADYOPS_IMAGE_TAG="${image_tag}" "${runbook}" -f "${override}" up -d --no-deps --force-recreate web worker >/dev/null || fail 'legacy consumer recreation failed'
  wait_for_mounts "${legacy_file}" || fail 'restored legacy mount, image or readiness verification failed'
  committed=1
  echo 'release-policy migration: legacy override and consumers restored; new non-secret file kept for review'
fi
