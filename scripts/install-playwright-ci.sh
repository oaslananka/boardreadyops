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

# PR smoke tests use the Playwright Chromium headless shell. On GitHub's
# Ubuntu runner image, the required system libraries may already be installed.
# Verify this by actually launching the pinned Playwright browser before
# invoking APT. This opt-in does not apply to visual baselines, nightly browser
# matrix or any environment without a functioning Chromium binary.
if [[ "${BOARDREADYOPS_CI_PROBE_CHROMIUM:-}" == "1" && "${RUNNER_OS:-}" == "Linux" && $# -eq 1 && "$1" == "chromium" ]]; then
  if corepack pnpm exec playwright install --only-shell chromium &&
    node --input-type=module -e '
      import { chromium } from "@playwright/test";
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.goto("data:text/html,<html><body>browser-ready</body></html>");
        if (await page.locator("body").innerText() !== "browser-ready") {
          throw new Error("Chromium smoke page did not render");
        }
      } finally {
        await browser.close();
      }
    '; then
    echo "Chromium launched and rendered a real page; using already available runner dependencies."
    exit 0
  fi
  echo "Chromium runtime preflight failed; installing required OS dependencies normally."
fi

corepack pnpm exec playwright install --with-deps "$@"
