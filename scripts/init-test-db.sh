#!/bin/sh
# Runs once when the Postgres volume is first created. The dev database comes
# from POSTGRES_DB; the test database has to be created explicitly.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
	CREATE DATABASE conduit_test OWNER $POSTGRES_USER;
SQL
