FROM postgres:17.11-bookworm@sha256:639ab7ceb90e13123085b741fb31ef493fba25463002f6da665352e7b534b652
COPY --chmod=0755 scripts/postgres-init.sh /docker-entrypoint-initdb.d/10-app.sh
COPY LICENSE /usr/local/share/javajournal/LICENSE
