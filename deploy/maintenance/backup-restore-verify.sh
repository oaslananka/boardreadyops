#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly project="boardreadyops-cloud"
readonly representative_tables=(
  installations
  repositories
  release_runs
  release_run_attempts
  webhook_inbox
  control_plane_jobs
  control_plane_outbox
)

fail() {
  local message="$1"
  local exit_code="${2:-3}"
  printf '%s\n' "$message" >&2
  exit "$exit_code"
}

[[ "$#" -eq 2 && "$1" = "--deployment-dir" ]] || fail "deployment scope is required" 2
deployment_dir="$2"
[[ "$deployment_dir" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail "deployment scope is invalid" 2
normalized="$(/usr/bin/python3 - "$deployment_dir" <<'PY'
import posixpath
import sys
print(posixpath.normpath(sys.argv[1]))
PY
)"
[[ "$normalized" = "$deployment_dir" ]] || fail "deployment scope is invalid" 2

repo_dir="${deployment_dir}/repo"
[[ -d "$repo_dir" && ! -L "$repo_dir" ]] || fail "BoardReadyOps deployment is unavailable"
[[ -d "$repo_dir/packages/db/migrations" ]] || fail "BoardReadyOps migration set is unavailable"

exec 9>/run/boardreadyops-maintenance/backup-restore.lock
/usr/bin/flock -n 9 || fail "BoardReadyOps backup verification is already running"

suffix="$$"
network="boardreadyops-restore-${suffix}"
restore_pg="boardreadyops-restore-postgres-${suffix}"
restore_web="boardreadyops-restore-web-${suffix}"
restore_worker="boardreadyops-restore-worker-${suffix}"
temp_dir=""
backup_path=""

cleanup_best_effort() {
  /usr/bin/docker rm --force "$restore_web" "$restore_worker" "$restore_pg" >/dev/null 2>&1 || true
  /usr/bin/docker network rm "$network" >/dev/null 2>&1 || true
  if [[ -n "$temp_dir" ]]; then
    /usr/bin/rm -rf "$temp_dir" || true
  fi
}
trap cleanup_best_effort EXIT
trap 'exit 130' INT TERM HUP

cleanup_verified() {
  /usr/bin/docker rm --force "$restore_web" "$restore_worker" "$restore_pg" >/dev/null 2>&1
  /usr/bin/docker network rm "$network" >/dev/null 2>&1
  for container in "$restore_web" "$restore_worker" "$restore_pg"; do
    if /usr/bin/docker container inspect "$container" >/dev/null 2>&1; then
      fail "Disposable BoardReadyOps restore container cleanup failed"
    fi
  done
  if /usr/bin/docker network inspect "$network" >/dev/null 2>&1; then
    fail "Disposable BoardReadyOps restore network cleanup failed"
  fi
  /usr/bin/rm -rf "$temp_dir"
  [[ ! -e "$temp_dir" ]] || fail "Disposable BoardReadyOps workspace cleanup failed"
  temp_dir=""
  backup_path=""
}

container_for_service() {
  local service="$1"
  local -a ids=()
  mapfile -t ids < <(
    /usr/bin/docker ps \
      --filter "label=com.docker.compose.project=${project}" \
      --filter "label=com.docker.compose.service=${service}" \
      --format '{{.ID}}'
  )
  [[ "${#ids[@]}" -eq 1 ]] || fail "BoardReadyOps runtime topology is unavailable"
  printf '%s\n' "${ids[0]}"
}

source_pg="$(container_for_service postgres)"
source_web="$(container_for_service web)"
source_pg_state="$(/usr/bin/docker inspect --format '{{.State.Status}}' "$source_pg" 2>/dev/null || true)"
source_pg_health="$(/usr/bin/docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$source_pg" 2>/dev/null || true)"
[[ "$source_pg_state" = "running" && "$source_pg_health" = "healthy" ]] || fail "BoardReadyOps production PostgreSQL is not healthy"
source_pg_image="$(/usr/bin/docker inspect --format '{{.Image}}' "$source_pg" 2>/dev/null || true)"
[[ "$source_pg_image" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "BoardReadyOps PostgreSQL image identity is unavailable"

release_sha="$(/usr/bin/git -c safe.directory="$repo_dir" -C "$repo_dir" rev-parse --verify HEAD 2>/dev/null || true)"
[[ "$release_sha" =~ ^[0-9a-f]{40}$ ]] || fail "BoardReadyOps release identity is unavailable"
image_revision="$(/usr/bin/docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$source_web" 2>/dev/null || true)"
[[ "$image_revision" = "$release_sha" ]] || fail "BoardReadyOps runtime release does not match the deployment checkout"
web_image="$(/usr/bin/docker inspect --format '{{.Image}}' "$source_web" 2>/dev/null || true)"
[[ "$web_image" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "BoardReadyOps web image identity is unavailable"

source_user="$(/usr/bin/docker exec "$source_pg" printenv POSTGRES_USER 2>/dev/null || true)"
source_db="$(/usr/bin/docker exec "$source_pg" printenv POSTGRES_DB 2>/dev/null || true)"
source_user="${source_user:-boardreadyops}"
source_db="${source_db:-boardreadyops}"
[[ "$source_user" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,62}$ ]] || fail "BoardReadyOps PostgreSQL identity is unavailable"
[[ "$source_db" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,62}$ ]] || fail "BoardReadyOps PostgreSQL identity is unavailable"

temp_dir="$(/usr/bin/mktemp -d /tmp/boardreadyops-backup-verify.XXXXXX)"
backup_path="${temp_dir}/production.dump"
expected_migrations="${temp_dir}/expected-migrations.txt"
source_migrations="${temp_dir}/source-migrations.txt"
restore_migrations="${temp_dir}/restore-migrations.txt"
source_tables="${temp_dir}/source-tables.txt"
restore_tables="${temp_dir}/restore-tables.txt"
source_counts="${temp_dir}/source-counts.txt"
restore_counts="${temp_dir}/restore-counts.txt"

/usr/bin/find "$repo_dir/packages/db/migrations" -maxdepth 1 -type f -name '*.sql' -printf '%f\n' \
  | /usr/bin/sed 's/\.sql$//' | LC_ALL=C /usr/bin/sort > "$expected_migrations"
[[ -s "$expected_migrations" ]] || fail "BoardReadyOps migration set is empty"

query_source() {
  local sql="$1"
  /usr/bin/docker exec "$source_pg" psql \
    --no-psqlrc --tuples-only --no-align --set=ON_ERROR_STOP=1 \
    --username="$source_user" --dbname="$source_db" --command="$sql"
}

query_restore() {
  local sql="$1"
  /usr/bin/docker exec "$restore_pg" psql \
    --no-psqlrc --tuples-only --no-align --set=ON_ERROR_STOP=1 \
    --username=boardreadyops --dbname=boardreadyops_restore --command="$sql"
}

started_ms="$(/usr/bin/date +%s%3N)"
backup_started_ms="$started_ms"
/usr/bin/docker exec "$source_pg" pg_dump \
  --format=custom --no-owner --no-privileges \
  --username="$source_user" --dbname="$source_db" > "$backup_path"
backup_finished_ms="$(/usr/bin/date +%s%3N)"
backup_bytes="$(/usr/bin/stat -c %s "$backup_path")"
[[ "$backup_bytes" =~ ^[1-9][0-9]*$ ]] || fail "BoardReadyOps backup is empty"

query_source "select version from cloud_schema_migrations order by version asc" \
  | /usr/bin/sed '/^$/d' > "$source_migrations"
/usr/bin/cmp -s "$expected_migrations" "$source_migrations" || fail "BoardReadyOps production migrations do not match the deployment release"
query_source "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name asc" \
  | /usr/bin/sed '/^$/d' > "$source_tables"

: > "$source_counts"
for table in "${representative_tables[@]}"; do
  count="$(query_source "select count(*)::text from \"${table}\"")"
  [[ "$count" =~ ^[0-9]+$ ]] || fail "BoardReadyOps production representative state is unavailable"
  printf '%s=%s\n' "$table" "$count" >> "$source_counts"
done

/usr/bin/docker network create --internal "$network" >/dev/null
/usr/bin/docker run --detach \
  --name "$restore_pg" \
  --network "$network" \
  --network-alias restore-postgres \
  --env POSTGRES_USER=boardreadyops \
  --env POSTGRES_DB=boardreadyops_restore \
  --env POSTGRES_HOST_AUTH_METHOD=trust \
  "$source_pg_image" >/dev/null

for _ in $(/usr/bin/seq 1 60); do
  if /usr/bin/docker exec "$restore_pg" pg_isready -U boardreadyops -d boardreadyops_restore >/dev/null 2>&1; then
    break
  fi
  /usr/bin/sleep 1
done
/usr/bin/docker exec "$restore_pg" pg_isready -U boardreadyops -d boardreadyops_restore >/dev/null 2>&1 || fail "Disposable PostgreSQL did not become ready"

restore_started_ms="$(/usr/bin/date +%s%3N)"
/usr/bin/docker exec -i "$restore_pg" pg_restore \
  --exit-on-error --no-owner --no-privileges \
  --username=boardreadyops --dbname=boardreadyops_restore < "$backup_path"
restore_finished_ms="$(/usr/bin/date +%s%3N)"

query_restore "select version from cloud_schema_migrations order by version asc" \
  | /usr/bin/sed '/^$/d' > "$restore_migrations"
/usr/bin/cmp -s "$source_migrations" "$restore_migrations" || fail "Restored migration versions do not match the source"
query_restore "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name asc" \
  | /usr/bin/sed '/^$/d' > "$restore_tables"
/usr/bin/cmp -s "$source_tables" "$restore_tables" || fail "Restored public tables do not match the source"

: > "$restore_counts"
representative_rows=0
for table in "${representative_tables[@]}"; do
  count="$(query_restore "select count(*)::text from \"${table}\"")"
  [[ "$count" =~ ^[0-9]+$ ]] || fail "Restored representative state is unavailable"
  printf '%s=%s\n' "$table" "$count" >> "$restore_counts"
  representative_rows=$((representative_rows + count))
done
/usr/bin/cmp -s "$source_counts" "$restore_counts" || fail "Restored representative row counts do not match the source"

restore_database_url="postgresql://boardreadyops@restore-postgres:5432/boardreadyops_restore"
readiness_started_ms="$(/usr/bin/date +%s%3N)"
/usr/bin/docker run --detach \
  --name "$restore_web" \
  --network "$network" \
  --env "DATABASE_URL=${restore_database_url}" \
  --env GITHUB_WEBHOOK_SECRET=restore-drill-placeholder \
  --env BOARDREADYOPS_RUNNER_MODE=disabled \
  --env ARTIFACT_STORAGE_DRIVER=local \
  --env ARTIFACT_STORAGE_ROOT=/tmp/boardreadyops-artifacts \
  "$web_image" >/dev/null
/usr/bin/docker run --detach \
  --name "$restore_worker" \
  --network "$network" \
  --env "DATABASE_URL=${restore_database_url}" \
  --env GITHUB_WEBHOOK_SECRET=restore-drill-placeholder \
  --env BOARDREADYOPS_RUNNER_MODE=disabled \
  --env BOARDREADYOPS_WORKER_HEALTH_PORT=3001 \
  --env ARTIFACT_STORAGE_DRIVER=local \
  --env ARTIFACT_STORAGE_ROOT=/tmp/boardreadyops-artifacts \
  "$web_image" node worker.mjs >/dev/null

wait_ready() {
  local container="$1"
  local endpoint="$2"
  for _ in $(/usr/bin/seq 1 60); do
    if /usr/bin/docker exec "$container" node -e \
      'fetch(process.argv[1],{cache:"no-store"}).then(async r=>{const b=await r.json();process.exit(r.ok&&b?.ok===true?0:1)}).catch(()=>process.exit(1))' \
      "$endpoint" >/dev/null 2>&1; then
      return 0
    fi
    /usr/bin/sleep 1
  done
  return 1
}

wait_ready "$restore_web" "http://127.0.0.1:3000/api/health/ready" || fail "Restored BoardReadyOps web did not become ready"
wait_ready "$restore_worker" "http://127.0.0.1:3001/health/ready" || fail "Restored BoardReadyOps worker did not become ready"
readiness_finished_ms="$(/usr/bin/date +%s%3N)"

migration_count="$(/usr/bin/wc -l < "$restore_migrations" | /usr/bin/tr -d ' ')"
public_table_count="$(/usr/bin/wc -l < "$restore_tables" | /usr/bin/tr -d ' ')"
backup_duration_ms=$((backup_finished_ms - backup_started_ms))
restore_duration_ms=$((restore_finished_ms - restore_started_ms))
readiness_duration_ms=$((readiness_finished_ms - readiness_started_ms))

cleanup_verified
finished_ms="$(/usr/bin/date +%s%3N)"
total_duration_ms=$((finished_ms - started_ms))

/usr/bin/python3 - \
  "$release_sha" "$backup_bytes" "$migration_count" "$public_table_count" \
  "$representative_rows" "$backup_duration_ms" "$restore_duration_ms" \
  "$readiness_duration_ms" "$total_duration_ms" <<'PY'
import json
import sys

(
    release_sha,
    backup_bytes,
    migrations,
    tables,
    representative_rows,
    backup_ms,
    restore_ms,
    readiness_ms,
    total_ms,
) = sys.argv[1:]
print(json.dumps({
    "event": "boardreadyops_production_backup_restore_verified",
    "releaseSha": release_sha,
    "backupBytes": int(backup_bytes),
    "migrationCount": int(migrations),
    "publicTableCount": int(tables),
    "representativeRows": int(representative_rows),
    "backupDurationMs": int(backup_ms),
    "restoreDurationMs": int(restore_ms),
    "readinessDurationMs": int(readiness_ms),
    "totalDurationMs": int(total_ms),
    "webReady": True,
    "workerReady": True,
    "runnerMode": "disabled",
}, separators=(",", ":")))
PY
