#!/bin/sh
set -eu

runtime_env_file="${BOARDREADYOPS_RUNTIME_ENV_FILE:-/run/app-env}"

if [ -f "$runtime_env_file" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$runtime_env_file"
  set +a
fi

: "${POSTGRES_USER:=boardreadyops}"
: "${POSTGRES_DB:=boardreadyops}"

export HOSTNAME=0.0.0.0

if [ -z "${DATABASE_URL:-}" ] && [ -n "${POSTGRES_PASSWORD:-}" ]; then
  export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@bro-postgres:5432/${POSTGRES_DB}"
fi

exec "$@"
