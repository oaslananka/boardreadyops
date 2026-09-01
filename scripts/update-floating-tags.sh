#!/usr/bin/env bash
set -euo pipefail

version="${1:?version required}"
major="$(printf '%s' "${version}" | cut -d. -f1 | tr -d 'v')"
minor="$(printf '%s' "${version}" | cut -d. -f2)"
target_commit="$(git rev-parse "${version}^{commit}")"
needs_push=0

git fetch --tags --force origin

for tag in "v${major}" "v${major}.${minor}"; do
  if git rev-parse --verify --quiet "refs/tags/${tag}" >/dev/null &&
    [[ "$(git rev-parse "${tag}^{commit}")" == "${target_commit}" ]]; then
    echo "${tag} already resolves to ${target_commit}; skipping update."
    continue
  fi

  git tag --force "${tag}" "${version}"
  needs_push=1
done

if [[ "${needs_push}" -eq 1 ]]; then
  git push --force origin "v${major}" "v${major}.${minor}"
fi
