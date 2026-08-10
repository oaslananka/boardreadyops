#!/usr/bin/env sh
set -eu

repo="${BOARDREADYOPS_REPO:-oaslananka/boardreadyops}"
version="${BOARDREADYOPS_VERSION:-latest}"

case "$(uname -s)" in
  Linux)
    os="linux"
    ;;
  Darwin)
    os="macos"
    ;;
  *)
    printf 'Unsupported operating system: %s\n' "$(uname -s)" >&2
    exit 1
    ;;
esac

case "$(uname -m)" in
  x86_64 | amd64)
    arch="x64"
    ;;
  arm64 | aarch64)
    arch="arm64"
    ;;
  *)
    printf 'Unsupported architecture: %s\n' "$(uname -m)" >&2
    exit 1
    ;;
esac

asset="boardreadyops-${os}-${arch}"
if [ "${version}" = "latest" ]; then
  download_root="https://github.com/${repo}/releases/latest/download"
else
  download_root="https://github.com/${repo}/releases/download/v${version#v}"
fi

tmpdir="$(mktemp -d)"
trap 'rm -rf "${tmpdir}"' EXIT INT TERM

https_only='=https'
curl_https() {
  curl --proto "${https_only}" --proto-redir "${https_only}" -fsSL "$@"
}

curl_https "${download_root}/${asset}" -o "${tmpdir}/${asset}"
curl_https "${download_root}/SHA256SUMS" -o "${tmpdir}/SHA256SUMS"

checksum_line="$(grep " ${asset}\$" "${tmpdir}/SHA256SUMS" || true)"
if [ -z "${checksum_line}" ]; then
  printf 'SHA256SUMS does not include %s\n' "${asset}" >&2
  exit 1
fi

printf '%s\n' "${checksum_line}" > "${tmpdir}/${asset}.sha256"
(
  cd "${tmpdir}"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c "${asset}.sha256"
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 -c "${asset}.sha256"
  else
    printf 'sha256sum or shasum is required to verify %s\n' "${asset}" >&2
    exit 1
  fi
)

install_dir="${BOARDREADYOPS_INSTALL_DIR:-}"
if [ -z "${install_dir}" ]; then
  if [ -d /usr/local/bin ] && [ -w /usr/local/bin ]; then
    install_dir="/usr/local/bin"
  else
    install_dir="${HOME}/.local/bin"
  fi
fi

mkdir -p "${install_dir}"
install -m 0755 "${tmpdir}/${asset}" "${install_dir}/boardreadyops"
printf 'Installed boardreadyops to %s/boardreadyops\n' "${install_dir}"
