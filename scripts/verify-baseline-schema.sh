#!/usr/bin/env bash
# Proves the baseline migration reproduces exactly the schema that the old
# boot-time `sequelize.sync({ alter: true })` was building. Builds one database
# each way and diffs `pg_dump --schema-only`. An empty diff is a pass.
#
# The Collections tables are excluded from both sides. They are new, so there
# is no legacy schema for them to match, and their migration deliberately
# differs from what sync() emits: sync() gives the owner foreign key
# ON DELETE SET NULL, the migration uses CASCADE, because a deleted user's
# private lists have no other owner. This check is about the legacy tables.
#
# Usage: ./scripts/verify-baseline-schema.sh    (needs docker compose up -d)
set -euo pipefail

CONTAINER="${PG_CONTAINER:-conduit-db}"
PGUSER="${POSTGRES_USER:-conduit}"
BACKEND="$(cd "$(dirname "$0")/../backend" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "==> recreating scratch databases"
docker exec "$CONTAINER" psql -U "$PGUSER" -d postgres -q \
  -c "DROP DATABASE IF EXISTS sync_ref;"    -c "CREATE DATABASE sync_ref OWNER $PGUSER;" \
  -c "DROP DATABASE IF EXISTS migrate_ref;" -c "CREATE DATABASE migrate_ref OWNER $PGUSER;"

echo "==> building sync_ref with sequelize.sync()"
( cd "$BACKEND" && NODE_ENV=test TEST_DB_NAME=sync_ref node -e '
  require("dotenv").config();
  const { sequelize } = require("./models");
  sequelize.sync({ force: true })
    .then(() => sequelize.close())
    .catch((e) => { console.error(e.message); process.exit(1); });
' >/dev/null )

echo "==> building migrate_ref with the migrations"
( cd "$BACKEND" && NODE_ENV=test TEST_DB_NAME=migrate_ref npx sequelize-cli db:migrate >/dev/null )

dump() {
  docker exec "$CONTAINER" pg_dump -U "$PGUSER" -d "$1" \
    --schema-only --no-owner --no-privileges \
    -T '"SequelizeMeta"' -T '"Collections"' -T '"CollectionArticles"' \
    | tr -d '\r' | grep -v '^--' | grep -v '^$' | grep -v 'restrict '
}

dump sync_ref > "$TMP/sync.sql"
dump migrate_ref > "$TMP/migrate.sql"

echo "==> diffing the legacy tables"
if diff -u "$TMP/sync.sql" "$TMP/migrate.sql"; then
  echo "PASS: migration-built schema matches the sync-built schema ($(wc -l < "$TMP/sync.sql") lines)"
else
  echo "FAIL: schemas differ" >&2
  exit 1
fi
