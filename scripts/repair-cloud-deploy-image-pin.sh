#!/usr/bin/env bash
# Operator-only, exact-match repair of the commissioned host-local deploy.sh.
# Never run --apply/--rollback without separately authorized production change.
# This script never reads the runtime token or touches running containers.
set -euo pipefail

mode="${1:---check}"
case "${mode}" in
  --check|--apply|--rollback) ;;
  *) printf '%s\n' 'usage: repair-cloud-deploy-image-pin.sh [--check|--apply|--rollback]' >&2; exit 64 ;;
esac

deploy_root="/home/ubuntu/boardreadyops-cloud"
wrapper="${deploy_root}/deploy.sh"
backup="${deploy_root}/deploy.sh.pre-image-pin.bak"
legacy='export BOARDREADYOPS_IMAGE_TAG="${BOARDREADYOPS_GIT_SHA}"'
new_line='export BOARDREADYOPS_IMAGE_TAG="${BOARDREADYOPS_IMAGE_TAG:-${BOARDREADYOPS_GIT_SHA}}"'
guard='if [[ -n "${BOARDREADYOPS_IMAGE_TAG:-}" && ! "${BOARDREADYOPS_IMAGE_TAG}" =~ ^[0-9a-f]{40}$ ]]; then'
guard_error='  fail "explicit image tag must be a 40-character lowercase Git commit SHA"'
guard_end='fi'

fail() { printf 'cloud-image-pin: %s\n' "$1" >&2; exit 78; }
[[ -d "${deploy_root}" && ! -L "${deploy_root}" ]] || fail 'deployment directory is missing or a symlink'
[[ -f "${wrapper}" && -x "${wrapper}" && ! -L "${wrapper}" ]] || fail 'deployment wrapper must be an executable regular file'
[[ "$(stat -c '%u' "${deploy_root}")" = "$(id -u)" ]] || fail 'deployment directory must be owned by the caller'
[[ "$(stat -c '%u' "${wrapper}")" = "$(id -u)" ]] || fail 'deployment wrapper must be owned by the caller'
bash -n "${wrapper}" || fail 'existing wrapper fails bash syntax check'

count_line() { local needle="$1"; grep -Fxc -- "${needle}" "${wrapper}" || true; }
# A second assignment would override even the corrected pinning guard.
assignment_count="$(grep -Ec '^[[:space:]]*(export[[:space:]]+)?BOARDREADYOPS_IMAGE_TAG=' "${wrapper}" || true)"
[[ "${assignment_count}" = 1 ]] || fail 'wrapper must contain exactly one image tag assignment'
legacy_count="$(count_line "${legacy}")"
patched_count="$(count_line "${new_line}")"
case "${legacy_count}:${patched_count}" in
  1:0) state=legacy ;;
  0:1)
    [[ "$(count_line "${guard}")" = 1 && "$(count_line "${guard_error}")" = 1 && "$(count_line "${guard_end}")" -ge 1 ]] \
      || fail 'wrapper pinning guard differs from expected contract'
    state=patched
    ;;
  *) fail 'wrapper has an ambiguous or unsupported image tag assignment' ;;
esac

[[ "$(grep -Fc -- 'BOARDREADYOPS_GIT_SHA="$(git -C "${repo_dir}" rev-parse HEAD)"' "${wrapper}" || true)" = 1 ]] \
  || fail 'wrapper checkout-SHA provenance differs from expected contract'
[[ "$(grep -Fc -- 'exec doppler run' "${wrapper}" || true)" = 1 ]] \
  || fail 'wrapper Doppler invocation differs from expected contract'

if [[ "${mode}" = --check ]]; then
  if [[ "${state}" = patched ]]; then
    echo 'cloud-image-pin: patched wrapper contract verified; no files changed'
    exit 0
  fi
  echo 'cloud-image-pin: legacy wrapper needs separately approved --apply; no files changed' >&2
  exit 2
fi

[[ -w "${deploy_root}" ]] || fail 'deployment directory is not writable'
[[ -w "${wrapper}" ]] || fail 'wrapper is not writable by the owner'
[[ "$(stat -c '%a' "${wrapper}")" != 777 ]] || fail 'unexpected world-writable wrapper'

stage=""
comparison=""
cleanup() {
  [[ -z "${stage}" ]] || rm -f "${stage}"
  [[ -z "${comparison}" ]] || rm -f "${comparison}"
}
trap cleanup EXIT

transform_to_pinned() {
  local file="$1"
  python3 - "${file}" <<'PY'
import pathlib
import sys
p = pathlib.Path(sys.argv[1])
text = p.read_text(encoding="utf-8")
old = 'export BOARDREADYOPS_IMAGE_TAG="${BOARDREADYOPS_GIT_SHA}"'
new = '\n'.join([
    'if [[ -n "${BOARDREADYOPS_IMAGE_TAG:-}" && ! "${BOARDREADYOPS_IMAGE_TAG}" =~ ^[0-9a-f]{40}$ ]]; then',
    '  fail "explicit image tag must be a 40-character lowercase Git commit SHA"',
    'fi',
    'export BOARDREADYOPS_IMAGE_TAG="${BOARDREADYOPS_IMAGE_TAG:-${BOARDREADYOPS_GIT_SHA}}"',
])
if text.count(old) != 1:
    raise SystemExit("cloud-image-pin: exact legacy tag assignment missing")
p.write_text(text.replace(old, new), encoding="utf-8")
PY
}

if [[ "${mode}" = --apply ]]; then
  if [[ "${state}" = patched ]]; then
    echo 'cloud-image-pin: wrapper already patched; no changes made'
    exit 0
  fi
  [[ ! -e "${backup}" && ! -L "${backup}" ]] || fail 'backup exists; inspect before applying again'
  stage="$(mktemp "${wrapper}.pin.XXXXXX")" || fail 'cannot create staging file'
  cp -p "${wrapper}" "${stage}" || fail 'cannot copy original wrapper'
  transform_to_pinned "${stage}" || fail 'cannot construct exact wrapper patch'
  bash -n "${stage}" || fail 'patched wrapper fails syntax check'
  cmp -s "${wrapper}" "${stage}" && fail 'patched content unexpectedly matches original'
  install -m 0600 "${wrapper}" "${backup}" || fail 'cannot write restricted backup'
  cmp -s "${wrapper}" "${backup}" || fail 'backup differs from original'
  mv -f "${stage}" "${wrapper}" || fail 'cannot replace wrapper atomically'
  stage=""
  echo 'cloud-image-pin: wrapper patched; previous wrapper preserved in restricted backup; no containers changed'
  exit 0
fi

# Rolling back a pin-aware wrapper after policy migration could break the next
# commissioning/recreation; prevent it before any mutation.
override="${deploy_root}/compose.release-policy.yml"
if [[ -f "${override}" ]] && grep -Fq -- "${deploy_root}/release-repositories:/run/policies/repositories:ro" "${override}"; then
  fail 'policy migration is active; do not revert image pinning before coordinated rollback'
fi
[[ "${state}" = patched ]] || fail 'rollback requires the exact patched wrapper'
[[ -f "${backup}" && ! -L "${backup}" ]] || fail 'restricted original wrapper backup is missing'
[[ "$(stat -c '%u' "${backup}")" = "$(id -u)" ]] || fail 'backup owner mismatch'
[[ "$(stat -c '%a' "${backup}")" = 600 ]] || fail 'backup mode must be 0600'
comparison="$(mktemp "${wrapper}.compare.XXXXXX")"
cp -p "${backup}" "${comparison}" || fail 'cannot stage comparison'
transform_to_pinned "${comparison}" || fail 'backup is not a recognized original'
cmp -s "${comparison}" "${wrapper}" || fail 'wrapper changed after patch; refuse to lose later edits'
stage="$(mktemp "${wrapper}.rollback.XXXXXX")"
cp -p "${backup}" "${stage}" || fail 'cannot stage legacy wrapper'
bash -n "${stage}" || fail 'legacy backup fails syntax check'
mv -f "${stage}" "${wrapper}" || fail 'cannot restore legacy wrapper atomically'
stage=""
echo 'cloud-image-pin: original wrapper restored; backup retained; no containers changed'
