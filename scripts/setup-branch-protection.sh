#!/usr/bin/env bash
set -euo pipefail

repo="${1:-oaslananka/boardreadyops}"
ruleset_name="${2:-main}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ruleset_file="${root}/.github/rulesets/main.json"

if [[ "${ruleset_name}" != "main" ]]; then
  printf 'This helper manages only the committed main ruleset.\n' >&2
  exit 2
fi

export MSYS2_ARG_CONV_EXCL="*"
export MSYS_NO_PATHCONV=1
if command -v gh.exe >/dev/null 2>&1; then
  gh_bin="gh.exe"
else
  gh_bin="gh"
fi

gh_input_path() {
  local path="$1"
  if [[ "${gh_bin}" == "gh.exe" ]] && command -v cygpath >/dev/null 2>&1; then
    cygpath -w "${path}"
  elif [[ "${gh_bin}" == "gh.exe" ]] && command -v wslpath >/dev/null 2>&1; then
    wslpath -w "${path}"
  else
    printf '%s' "${path}"
  fi
}

ruleset_id="$(
  "${gh_bin}" api "repos/${repo}/rulesets" \
    --jq '.[] | select(.name == "main" and .target == "branch") | .id' | head -n 1
)"
input_path="$(gh_input_path "${ruleset_file}")"

if [[ -n "${ruleset_id}" ]]; then
  "${gh_bin}" api --method PUT "repos/${repo}/rulesets/${ruleset_id}" --input "${input_path}" >/dev/null
else
  "${gh_bin}" api --method POST "repos/${repo}/rulesets" --input "${input_path}" >/dev/null
fi

"${gh_bin}" api --method PATCH "repos/${repo}" \
  --field delete_branch_on_merge=true \
  --field allow_squash_merge=true \
  --field allow_merge_commit=false \
  --field allow_rebase_merge=false >/dev/null

"${gh_bin}" api "repos/${repo}/rulesets" \
  --jq '.[] | select(.name == "main" and .target == "branch") | {id, name, enforcement, target}'
