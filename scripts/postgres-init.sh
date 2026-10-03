#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  --set=app_user="$APP_DB_USER" --set=app_password="$APP_DB_PASSWORD" \
  --set=app_database="$APP_DB_NAME" <<'SQL'
CREATE ROLE :"app_user" LOGIN PASSWORD :'app_password';
CREATE DATABASE :"app_database" OWNER :"app_user";
SQL
