#!/usr/bin/env bash
set -euo pipefail

# GitHub's Ubuntu 24.04 image currently includes an unrelated Microsoft APT
# source. Its 403 response makes Playwright's `--with-deps` apt update fail
# before browser tests run, despite Ubuntu's signed repositories being healthy.
# Mask ONLY the known third-party source during dependency installation and
# restore it even on failure. Never disable signature checks or skip apt deps.
source_list=/etc/apt/sources.list.d/microsoft-prod.list
if [[ "${RUNNER_OS:-}" == "Linux" ]] && [[ -f "$source_list" ]] &&
  grep -Fq 'packages.microsoft.com/ubuntu/24.04/prod' "$source_list"; then
  backup="$(mktemp "${RUNNER_TEMP:?}/boardreadyops-playwright-apt-XXXXXXXX.list")"
  sudo mv -- "$source_list" "$backup"
  trap 'sudo mv -- "$backup" "$source_list"' EXIT
  echo 'Isolated unrelated Microsoft APT source for Playwright browser dependency setup.'
fi

corepack pnpm exec playwright install --with-deps "$@"
