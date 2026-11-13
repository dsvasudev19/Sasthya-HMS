#!/usr/bin/env bash
# Creates local dev roles + database and writes packages/db/.env (gitignored) with fresh passwords.
set -euo pipefail
cd "$(dirname "$0")/../.."
ENV_FILE=packages/db/.env
if [ -f "$ENV_FILE" ]; then echo "$ENV_FILE already exists; keeping its passwords"; source "$ENV_FILE"; fi
MIGRATOR_PW=${MIGRATOR_PW:-$(openssl rand -hex 16)}
APP_PW=${APP_PW:-$(openssl rand -hex 16)}
psql -d postgres -v ON_ERROR_STOP=1 -v migrator_pw="$MIGRATOR_PW" -v app_pw="$APP_PW" -f infra/postgres/bootstrap.sql
cat > "$ENV_FILE" <<ENV
MIGRATOR_PW=$MIGRATOR_PW
APP_PW=$APP_PW
# Migrations run as the owner role; the app connects as a DML-only role that cannot bypass RLS.
MIGRATOR_DATABASE_URL="postgresql://hms_migrator:$MIGRATOR_PW@localhost:5432/swasthya_hms?schema=platform"
DATABASE_URL="postgresql://hms_app:$APP_PW@localhost:5432/swasthya_hms"
SHADOW_DATABASE_URL="postgresql://hms_migrator:$MIGRATOR_PW@localhost:5432/swasthya_hms_shadow?schema=platform"
ENV
echo "wrote $ENV_FILE"
