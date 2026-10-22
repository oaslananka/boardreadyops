#!/usr/bin/env bash
# KiCad 10 installation for the real GitHub-hosted integration lane.
# Prefer Ubuntu APT with signed PPA metadata; use the official digest-pinned
# KiCad CLI OCI image only for verifiable transient upstream PPA outages.
set -euo pipefail

series="${BRO_KICAD_VERSION:-}"
ppa_series="${BRO_KICAD_PPA_SERIES:-}"
if [[ "$series" != '10.0' || "$ppa_series" != '10.0' ]]; then
  echo '::error::Unsupported KiCad CI series; update the pinned OCI image and acceptance tests first.'
  exit 2
fi

: "${RUNNER_TEMP:?RUNNER_TEMP must be supplied by GitHub Actions}"
: "${GITHUB_WORKSPACE:?GITHUB_WORKSPACE must be supplied by GitHub Actions}"
: "${GITHUB_PATH:?GITHUB_PATH must be supplied by GitHub Actions}"

image='ghcr.io/kicad/kicad@sha256:3224d1bf143185ecc1bd3a1082a36f37f0f4e59d707983a16515a845e3737fc6'
apt_log="$RUNNER_TEMP/kicad10-apt-install.log"

# Never substitute a different distribution after a GPG or content-integrity
# failure. A verified vendor OCI digest is an alternative distribution channel,
# not permission to skip APT signature verification.
transient_ppa_outage() {
  local log="$1"
  if grep -Eiq 'NO_PUBKEY|BADSIG|EXPKEYSIG|KEYEXPIRED|GPG error|not signed|signature verification|Hash Sum mismatch|invalid signature' "$log"; then
    return 1
  fi
  local ppa='(ppa\.launchpadcontent\.net|ppa\.launchpad\.net)/kicad/kicad-10\.0-releases'
  local transient='HTTP 5[0-9][0-9]|5[0-9][0-9] Service|Service Unavailable|Gateway Timeout|Connection timed out|Connection failed|Could not connect'
  # Do not infer a KiCad outage from a successful PPA Hit plus another
  # repository's 503 elsewhere in the same apt-get update output.
  if grep -Ei "$ppa" "$log" | grep -Eiq "$transient"; then
    return 0
  fi
  # APT also prints multiline errors: "Err:4 https://<PPA> ..." followed by
  # an indented "503 Service Unavailable" line.
  grep -E -A1 "^(Err|Ign):[0-9]+ https?://$ppa" "$log" |
    grep -Eiq "^[[:space:]]+($transient)"
}

echo '::notice::Attempting signed KiCad 10.0 PPA installation'
sudo add-apt-repository --yes --no-update "ppa:kicad/kicad-$ppa_series-releases"

native_ready=false
for attempt in 1 2 3 4; do
  if sudo apt-get update -o Acquire::Languages=none -o APT::Update::Error-Mode=any -o Acquire::Retries=2 -qq 2>&1 | tee "$apt_log"; then
    candidate="$(apt-cache policy kicad | awk '/Candidate:/ {print $2; exit}')"
    if [[ "$candidate" != "$series".* ]]; then
      echo "::error::Signed KiCad PPA returned an unexpected candidate: ${candidate:-none}"
      exit 1
    fi
    if sudo apt-get install --yes --no-install-recommends -o Acquire::Retries=5 kicad 2>&1 | tee "$apt_log"; then
      native_ready=true
      break
    fi
    # If the index was valid but the .deb download failed, this check still
    # requires an explicit transient *KiCad PPA* failure before using OCI.
    if ! transient_ppa_outage "$apt_log"; then
      echo '::error::KiCad package install failed for a non-transient reason.'
      tail -25 "$apt_log"
      exit 1
    fi
  elif ! transient_ppa_outage "$apt_log"; then
    echo '::error::APT index verification or a non-KiCad source failed.'
    tail -25 "$apt_log"
    exit 1
  fi

  if [[ "$attempt" -lt 4 ]]; then
    echo "::warning::Signed KiCad PPA transiently unavailable (attempt $attempt/4)"
    sleep 15
  fi
done

if [[ "$native_ready" != true ]]; then
  echo '::warning::Verified KiCad PPA outage; switching to official OCI CLI by immutable SHA-256 digest.'
  [[ "$(uname -m)" == 'x86_64' ]] || { echo '::error::Official OCI image is pinned for linux/amd64.'; exit 1; }
  timeout 300 docker pull --quiet "$image"
  vendor="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.vendor"}}' "$image")"
  [[ "$vendor" == KiCad ]] || { echo '::error::Unexpected OCI image publisher metadata.'; exit 1; }

  shim_dir="$RUNNER_TEMP/kicad-oci-bin"
  mkdir -p "$shim_dir" "$RUNNER_TEMP/kicad-oci-home"
  cat > "$shim_dir/kicad-cli" <<'SHIM'
#!/usr/bin/env bash
set -euo pipefail
: "${GITHUB_WORKSPACE:?}"
: "${RUNNER_TEMP:?}"
image='ghcr.io/kicad/kicad@sha256:3224d1bf143185ecc1bd3a1082a36f37f0f4e59d707983a16515a845e3737fc6'
exec docker run --rm --pull=never --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
  --user "$(id -u):$(id -g)" \
  -e HOME="$RUNNER_TEMP/kicad-oci-home" \
  -v /tmp:/tmp:rw -v "$GITHUB_WORKSPACE:$GITHUB_WORKSPACE:rw" \
  -v "$RUNNER_TEMP:$RUNNER_TEMP:rw" -w "$PWD" \
  "$image" kicad-cli "$@"
SHIM
  chmod 755 "$shim_dir/kicad-cli"
  echo "$shim_dir" >> "$GITHUB_PATH"
  export PATH="$shim_dir:$PATH"
fi

actual="$(kicad-cli version)"
if [[ "$actual" != "$series".* ]]; then
  echo "::error::Expected real KiCad $series.*, got $actual"
  exit 1
fi
echo "::notice::Verified genuine KiCad CLI $actual"
