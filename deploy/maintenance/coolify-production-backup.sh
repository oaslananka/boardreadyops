#!/usr/bin/env bash
# Engine-aware, single-production backup on the existing Docker host.
set -Eeuo pipefail
umask 077

fail() { printf 'BoardReadyOps backup: %s\n' "$1" >&2; exit "${2:-1}"; }
[[ "$#" -le 1 ]] || fail "usage: coolify-production-backup.sh [--preflight]" 2
[[ "$#" -eq 0 || "$1" == "--preflight" ]] || fail "unsupported argument" 2
mode="${1:-backup}"

: "${BOARDREADYOPS_BACKUP_DIR:?missing backup directory}"
: "${BOARDREADYOPS_COMPOSE_PROJECT:?missing Compose project}"
: "${BOARDREADYOPS_POSTGRES_VOLUME:?missing PostgreSQL volume}"
: "${BOARDREADYOPS_ARTIFACT_VOLUME:?missing artifact volume}"
: "${BOARDREADYOPS_BACKUP_KEEP:=7}"

[[ "$BOARDREADYOPS_COMPOSE_PROJECT" =~ ^[a-z0-9]{16,40}$ ]] || fail "invalid Compose identity"
[[ "$BOARDREADYOPS_BACKUP_KEEP" =~ ^[0-9]+$ ]] || fail "invalid retention count"
(( BOARDREADYOPS_BACKUP_KEEP >= 2 && BOARDREADYOPS_BACKUP_KEEP <= 30 )) || fail "retention must be 2..30"
[[ "$BOARDREADYOPS_BACKUP_DIR" == /* && -d "$BOARDREADYOPS_BACKUP_DIR" && ! -L "$BOARDREADYOPS_BACKUP_DIR" ]] || fail "backup directory must be an existing absolute directory"
[[ "$(stat -c %u "$BOARDREADYOPS_BACKUP_DIR")" == "$(id -u)" ]] || fail "backup directory owner mismatch"
dir_mode="$(stat -c %a "$BOARDREADYOPS_BACKUP_DIR")"
(( (8#$dir_mode & 077) == 0 )) || fail "backup directory must not allow group/other access"
for required in docker flock tar gzip timeout mktemp sha256sum; do
  command -v "$required" >/dev/null || fail "missing tool: $required"
done
docker info >/dev/null 2>&1 || fail "Docker daemon not accessible"

container_for_service() {
  local service="$1" ids=()
  # Bash 3.2 (the macOS CI default) has no mapfile. Explicitly read every
  # matching ID so ambiguous or missing containers still fail closed.
  local candidate
  while IFS= read -r candidate; do
    if [[ -n "$candidate" ]]; then ids+=("$candidate"); fi
  done < <(docker ps \
    --filter "label=com.docker.compose.project=$BOARDREADYOPS_COMPOSE_PROJECT" \
    --filter "label=com.docker.compose.service=$service" --format '{{.ID}}')
  [[ "${#ids[@]}" -eq 1 ]] || fail "expected exactly one running $service container"
  printf '%s\n' "${ids[0]}"
}
pg="$(container_for_service postgres)"
# PostgreSQL stays in the legacy Compose project, while the production web
# may be an independent Coolify rolling application. Select that application
# only by its explicitly configured identity; never choose any running web.
rolling_web_app_uuid="${BOARDREADYOPS_ROLLING_WEB_APP_UUID:-}"
if [[ -n "$rolling_web_app_uuid" ]]; then
  [[ "$rolling_web_app_uuid" =~ ^[a-z0-9]{16,40}$ ]] || fail "invalid rolling web app identity"
  rolling_web_containers=()
  while IFS= read -r candidate; do
    if [[ -n "$candidate" ]]; then rolling_web_containers+=("$candidate"); fi
  done < <(docker ps \
    --filter "label=coolify.applicationUuid=$rolling_web_app_uuid" \
    --filter status=running --format '{{.ID}}')
  [[ "${#rolling_web_containers[@]}" -eq 1 ]] || fail "expected exactly one current rolling production web container"
  web="${rolling_web_containers[0]}"
  [[ "$(docker inspect "$web" --format '{{index .Config.Labels "coolify.applicationUuid"}}')" == "$rolling_web_app_uuid" ]] || fail "rolling web app identity mismatch"
else
  # Legacy all-in-one deployments remain supported explicitly, but a missing
  # rolling UUID cannot silently select an unrelated application.
  web="$(container_for_service web)"
fi
for container in "$pg" "$web"; do
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container")"
  [[ "$status" == healthy ]] || fail "production service is not healthy"
done
pg_volume="$(docker inspect "$pg" --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}')"
web_volume="$(docker inspect "$web" --format '{{range .Mounts}}{{if eq .Destination "/data/artifacts"}}{{.Name}}{{end}}{{end}}')"
[[ "$pg_volume" == "$BOARDREADYOPS_POSTGRES_VOLUME" && "$web_volume" == "$BOARDREADYOPS_ARTIFACT_VOLUME" ]] || fail "production volume identity mismatch"
free_kb="$(df -Pk "$BOARDREADYOPS_BACKUP_DIR" | awk 'END { print $4 }')"
[[ "$free_kb" =~ ^[0-9]+$ ]] || fail "disk capacity unavailable"
(( free_kb >= 524288 )) || fail "less than 512 MiB free"

# A valid tar stream can contain zero physical artifact files. Record that
# truth explicitly; its nonzero compressed size is not evidence of file recovery.
# GNU tar -v output starts with the entry type; fields 2 and 3 are
# owner/group and uncompressed byte size respectively on the Linux host.
artifact_archive_inventory() {
  LC_ALL=C tar -tvzf "$1" |
    LC_ALL=C awk '
      substr($1, 1, 1) == "-" { files++; bytes += $3; next }
      substr($1, 1, 1) == "d" { next }
      { unsupported++ }
      END { printf "%.0f %.0f %.0f\n", files, bytes, unsupported }'
}

if [[ "$mode" == "--preflight" ]]; then
  echo "BoardReadyOps backup preflight: PASS"
  exit 0
fi

# Apply the 1 GiB file-size ceiling only when actually creating archives.
# Dry-run preflight must not alter OS resource limits; Git Bash on Windows
# cannot set this Linux production limit.
ulimit -f 1048576

exec 9>"$BOARDREADYOPS_BACKUP_DIR/.coolify-backup.lock"
flock -n 9 || fail "backup already running"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
base="$BOARDREADYOPS_BACKUP_DIR/boardreadyops-coolify-daily-$stamp"
db_target="$base.dump"
artifact_target="$base.artifacts.tar.gz"
manifest_target="$base.sha256"
[[ ! -e "$db_target" && ! -e "$artifact_target" && ! -e "$manifest_target" ]] || fail "backup already exists"
tmp_db="$(mktemp "$BOARDREADYOPS_BACKUP_DIR/.postgres-$stamp.XXXXXX")"
tmp_art="$(mktemp "$BOARDREADYOPS_BACKUP_DIR/.artifacts-$stamp.XXXXXX")"
cleanup() {
  [[ -z "${tmp_db:-}" || ! -e "$tmp_db" ]] || rm -f -- "$tmp_db"
  [[ -z "${tmp_art:-}" || ! -e "$tmp_art" ]] || rm -f -- "$tmp_art"
}
trap cleanup EXIT

timeout 300 docker exec --user postgres "$pg" sh -c \
  'exec pg_dump --format=custom --no-owner --no-acl --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' > "$tmp_db"
[[ -s "$tmp_db" ]] || fail "PostgreSQL dump is empty"
table_data_count="$(docker exec --user postgres -i "$pg" pg_restore --list < "$tmp_db" |
  awk '/ TABLE DATA /{n++} END{print n+0}')"
(( table_data_count > 0 )) || fail "PostgreSQL dump has no table-data entries"
timeout 300 docker exec --user node "$web" tar -C /data/artifacts -cf - . | gzip -n -1 > "$tmp_art"
[[ -s "$tmp_art" ]] || fail "artifact archive stream is empty"
tar -tzf "$tmp_art" >/dev/null || fail "artifact archive verification failed"
artifact_inventory="$(artifact_archive_inventory "$tmp_art")"
read -r artifact_files artifact_bytes unsupported_entries <<< "$artifact_inventory"
[[ "$artifact_files" =~ ^[0-9]+$ && "$artifact_bytes" =~ ^[0-9]+$ &&
   "$unsupported_entries" =~ ^[0-9]+$ ]] || fail "artifact archive inventory is invalid"
(( unsupported_entries == 0 )) || fail "artifact archive includes unsupported file types"

mv --no-clobber -- "$tmp_db" "$db_target"
mv --no-clobber -- "$tmp_art" "$artifact_target"
sha256sum "$db_target" "$artifact_target" | sed "s|$BOARDREADYOPS_BACKUP_DIR/||g" > "$manifest_target"
chmod 600 "$db_target" "$artifact_target" "$manifest_target"
echo "BoardReadyOps backup: verified $(basename "$db_target"), tables=$table_data_count, bytes=$(stat -c %s "$db_target"), artifact_files=$artifact_files, artifact_bytes=$artifact_bytes"

# Rotate ONLY files produced by this job; legacy/operator backups are never touched.
mapfile -t backups < <(find "$BOARDREADYOPS_BACKUP_DIR" -maxdepth 1 -type f \
  -name 'boardreadyops-coolify-daily-*.dump' -printf '%f\n' | LC_ALL=C sort -r)
for ((i=BOARDREADYOPS_BACKUP_KEEP; i<${#backups[@]}; i++)); do
  base_name="${backups[$i]%.dump}"
  [[ "$base_name" =~ ^boardreadyops-coolify-daily-[0-9]{8}T[0-9]{6}Z$ ]] || continue
  for suffix in dump artifacts.tar.gz sha256; do
    file="$BOARDREADYOPS_BACKUP_DIR/$base_name.$suffix"
    [[ ! -f "$file" || -L "$file" ]] || rm -f -- "$file"
  done
done
