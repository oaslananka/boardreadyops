# Renovate tracks Fedora 45 by version + immutable multiarch digest; no tag@digest syntax.
# renovate: datasource=docker depName=fedora currentValue=45
FROM fedora@sha256:a7d72ba2745b100a3351087472e5ee7b2450af7cf331e7673007e3817612839c

RUN dnf -y upgrade --refresh \
    && dnf -y install --setopt=install_weak_deps=False kicad \
    && dnf clean all \
    && kicad-cli version

ARG NODE_VERSION=24.22.1
ARG BOARDREADYOPS_VERSION

LABEL org.opencontainers.image.source="https://github.com/oaslananka/boardreadyops"
LABEL org.opencontainers.image.description="BoardReadyOps with KiCad CLI preinstalled."

RUN set -eux; \
    case "$(rpm --eval '%{_arch}')" in \
      x86_64) node_arch="x64" ;; \
      aarch64) node_arch="arm64" ;; \
      *) echo "Unsupported Node architecture." >&2; exit 1 ;; \
    esac; \
    cd /tmp; \
    archive="node-v${NODE_VERSION}-linux-${node_arch}.tar.xz"; \
    curl --proto '=https' --proto-redir '=https' -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/${archive}"; \
    curl --proto '=https' --proto-redir '=https' -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"; \
    grep " ${archive}$" SHASUMS256.txt | sha256sum -c -; \
    tar -xJf "${archive}" --directory /usr/local --strip-components 1; \
    rm "${archive}" SHASUMS256.txt; \
    node --version; \
    npm --version

RUN set -eux; \
    if ! printf '%s\n' "${BOARDREADYOPS_VERSION}" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'; then \
      echo "BOARDREADYOPS_VERSION must be an exact semantic version." >&2; \
      exit 1; \
    fi; \
    NPM_CONFIG_UPDATE_NOTIFIER=false npm install \
      --global --ignore-scripts --no-audit --no-fund \
      "boardreadyops@${BOARDREADYOPS_VERSION}" # NOSONAR -- exact version validated above.

RUN set -eux; \
    rm -rf /root/.npm /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx; \
    boardreadyops --version; \
    kicad-cli version; \
    mkdir -p /usr/share/doc/boardreadyops; \
    cp /usr/share/licenses/kicad/LICENSE /usr/share/doc/boardreadyops/LICENSE-KICAD; \
    useradd --create-home --shell /bin/bash --uid 10001 boardreadyops

COPY action-entrypoint.sh /usr/local/bin/boardreadyops-action

RUN chmod 0755 /usr/local/bin/boardreadyops-action

# GitHub Docker actions require the default root user to access the mounted GITHUB_WORKSPACE across runner UIDs.
# nosemgrep: dockerfile.security.missing-user-entrypoint.missing-user-entrypoint
ENTRYPOINT ["boardreadyops"]
