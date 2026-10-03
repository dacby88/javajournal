# Java Journal

A self-hosted trading journal for the coffee addict. Import broker execution reports, match trades, keep journals, and analyze performance across accounts.

Java Journal is a single-owner application. Each installation has its own login and database; it is not a shared multi-user service.

## Features

- Multi-account dashboard, daily P&L calendar, performance metrics and charts.
- Interactive Brokers, Schwab and Tastytrade CSV imports, with configurable import mappings.
- Import previews, duplicate detection, automatic or manual execution matching.
- Multi-leg trades, trade descriptions, tags and journal notes.
- Optional delayed option quotes; these are not real-time prices and may be unavailable.

## Choose your database

| Mode | Application | Database |
|---|---|---|
| Bundled local | Docker Compose | Dedicated Postgres container and persistent volume |
| Existing local/network | Docker Compose | Your existing Postgres instance |
| Cloud | Docker Compose | Your provider's Postgres instance, with TLS |

Database credentials are configured on the server, never in the browser. Choosing a cloud database does not expose the application to the internet.

Requirements: Docker Engine with Docker Compose v2, or Docker Desktop. AMD64 and ARM64 images are supported. A source checkout is sufficient; Docker builds the frontend automatically.

## 1. Get the application

```sh
git clone https://github.com/dacby88/javajournal.git
cd javajournal
```

Choose **one** of the following configurations. Both use a private `.env` file, which must not be committed or shared.

## 2A. Bundled local Postgres

```sh
cp .env.local.example .env
```

Edit `.env` and fill in `PG_PASSWORD`, `POSTGRES_ADMIN_PASSWORD`, `SECRET_KEY` and `SETUP_TOKEN`. Use a different generated value for each. Generate a value with:

```sh
openssl rand -hex 32
```

`PG_PASSWORD` belongs to the application role. `POSTGRES_ADMIN_PASSWORD` belongs to the separate database administrator and is not passed to the backend. The application role owns its database but is not a Postgres superuser.

On macOS/Linux, restrict environment-file access:

```sh
chmod 600 .env
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

Postgres is reachable only inside Docker, not through a published host port. Data lives in the `postgres-data` named volume and survives normal restarts and `docker compose down`.

## 2B. Existing local, network or cloud Postgres

Create a dedicated database and a login role that owns that database or has permission to create and alter its application schema. Do not use a provider administration account or an unrelated application's database.

```sh
cp .env.external.example .env
```

Edit `.env` and supply either:

- `DATABASE_URL`: a complete `postgres://` or `postgresql://` URL; or
- `PG_HOST`, `PG_PORT`, `PG_DBNAME`, `PG_USER` and `PG_PASSWORD`.

Set independently generated `SECRET_KEY` and `SETUP_TOKEN` values with `openssl rand -hex 32`.

`DATABASE_URL` takes precedence over the individual connection fields. `PG_SSLMODE` and `PG_SSLROOTCERT`, when set, override the corresponding URL query parameters. If a password contains special characters, use the separate `PG_*` fields or properly percent-encode it in the URL. Quote `.env` values containing `$`, `#` or spaces with single quotes.

### Network and TLS

- A database on the same host as Docker uses `PG_HOST=host.docker.internal`, not `localhost`. Ensure Postgres listens on an interface Docker can reach and that `pg_hba.conf` permits the application role.
- A network database uses its hostname, with firewall rules allowing the Docker host to connect.
- Cloud connections default to `PG_SSLMODE=verify-full`, which encrypts the connection and verifies the certificate and hostname.
- Create `certs/` and put the provider's public CA certificate there if required. Set `PG_SSLROOTCERT=/certs/provider-ca.crt`. Certificates must be readable by the non-root backend user.
- If using a URL's TLS settings without overrides, leave `PG_SSLMODE` and `PG_SSLROOTCERT` blank. Prefer verified TLS. `require` encrypts the connection but does not guarantee hostname verification.
- For an intentionally unencrypted, trusted local network database, explicitly choose `PG_SSLMODE=disable`. Do not disable certificate verification merely to work around a cloud connection problem.
- Confirm provider requirements for direct versus pooled endpoints. Schema migrations may need a direct connection. The current deployment uses the same endpoint for initialization and application traffic.

Start without the local overlay:

```sh
chmod 600 .env
docker compose up -d --build
```

This mode does not start a local Postgres container. Initialization creates application tables, not a database or database role.

## 3. First login

Open `http://localhost:7080`. Enter the `SETUP_TOKEN` from your private `.env` file and create your owner login. The database enforces one owner; setup cannot register another user after initialization.

Create a trading account, select its broker format, and import an execution report. `examples/synthetic-ibkr.csv` contains deliberately synthetic data for trying the import flow.

Open **User Help Guide** from the dashboard username menu for a searchable, in-app manual covering imports, matching, accounts, performance metrics, trades, executions, journals and troubleshooting. On mobile, open the hamburger menu first and then the username menu. The guide is available at `/help` after login.

All trading APIs require a session. The frontend handles CSRF tokens automatically, including uploads. API integrations must retrieve `/api/auth/csrf` with a cookie jar and send its token as `X-CSRF-Token` on mutations. First-user setup additionally needs `X-Setup-Token`.

## Configuration reference

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | External Postgres URL; takes precedence over `PG_*` connection fields |
| `PG_HOST`, `PG_PORT` | Database host and port; default port is 5432 |
| `PG_DBNAME`, `PG_USER`, `PG_PASSWORD` | Database name and dedicated application credentials |
| `PG_SSLMODE` | `disable`, `require`, `verify-ca` or `verify-full` |
| `PG_SSLROOTCERT` | CA certificate path inside the backend container |
| `POSTGRES_ADMIN_PASSWORD` | Administrator password for bundled local Postgres only |
| `SECRET_KEY` | Stable random session-signing secret, at least 32 characters |
| `SETUP_TOKEN` | Random operator token for first-user setup, at least 32 characters |
| `APP_HOST` | Browser port binding; defaults to `127.0.0.1` |
| `APP_PORT` | Browser port; defaults to 7080 |
| `APP_TRUSTED_HOSTS` | Allowed browser/API hostnames, without ports; defaults to localhost and loopback |
| `SESSION_COOKIE_SECURE` | Set to `true` when browser access uses HTTPS |

The local overlay selects `DB_MODE=local`; the base configuration selects `external`. Do not set `DATABASE_URL` when using the local overlay. SQLite is supported only for isolated tests, not production deployments.

The backend and bundled database do not publish host ports. Database URLs and credentials are not returned by health checks. `/api/health` checks the process; `/api/ready` checks database connectivity and schema version.

### Access from another computer

The default installation listens only on the host's loopback address. For deliberate LAN access, configure `APP_HOST` and include the server hostname in `APP_TRUSTED_HOSTS`.

For internet access, place the frontend behind a trusted HTTPS reverse proxy, keep the backend/database private, include the public hostname in `APP_TRUSTED_HOSTS`, and set `SESSION_COOKIE_SECURE=true`. Keep the loopback hostnames in that list for health checks. Complete first-user setup before exposing the installation. Nginx rate-limits login and setup requests.

## Upgrades and persistence

Back up the database and keep a protected copy of `.env` before upgrades. Use the same Compose files and project name as the original installation:

```sh
git pull
docker compose build
docker compose run --rm initialize
docker compose up -d
```

For bundled Postgres, add `-f docker-compose.yml -f docker-compose.local.yml` to every Compose command above.

The initialization service runs versioned Alembic migrations and seeds missing built-in broker formats. It does not replace personal data or customized mappings. PostgreSQL initialization is serialized so concurrent startup attempts do not apply migrations simultaneously.

Changing a database hostname or URL does **not** move data. Export and restore into a separate destination, verify it, then switch configuration. Changing `PG_PASSWORD` in `.env` does not change an existing database role's password; coordinate password changes with the database administrator.

Never delete database volumes as an upgrade step. In particular, `docker compose down -v` deletes local data. Changing the Compose project name selects a different volume and can make an installation appear empty.

Automatic schema downgrades are disabled. To roll back, restore a verified backup into a separate database and run the compatible application version.

## Backups and restores

Local backup:

```sh
mkdir -p backups
docker compose -f docker-compose.yml -f docker-compose.local.yml exec -T postgres \
  sh -c 'pg_dump -U "$APP_DB_USER" -d "$APP_DB_NAME" -Fc' > backups/journal.dump
```

The default ignore rules exclude backups, environment files, database files and certificates. Protect backups: they contain your trading history and password hash.

For a local restore, use a **new, empty database volume**, start only the Postgres service, and restore before starting initialization or the application:

```sh
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d postgres
docker compose -f docker-compose.yml -f docker-compose.local.yml exec -T postgres \
  sh -c 'pg_restore -U "$APP_DB_USER" -d "$APP_DB_NAME" --no-owner --exit-on-error' < backups/journal.dump
```

Do not run these restore steps over an existing installation. For external/cloud Postgres, use provider backups or compatible `pg_dump`/`pg_restore` tooling against a new destination. Do not put credentials directly in shell history.

## Troubleshooting

- Use `docker compose ps` and `docker compose logs initialize backend frontend`. Include the local overlay when applicable.
- Initialization failure: verify the database exists, the role has schema permissions, the host is reachable, and TLS settings/CA files are correct.
- Local mode conflict: clear `DATABASE_URL` rather than accidentally connecting to an external database.
- Certificate rejection: use the provider hostname and CA certificate; avoid IP addresses that are not on the certificate.
- HTTP 400 for a server hostname: add it to `APP_TRUSTED_HOSTS` and recreate application containers.
- Login/session failures after enabling HTTPS: verify `SESSION_COOKIE_SECURE` matches the browser protocol.
- The app cannot adopt an arbitrary existing schema. Start with an empty dedicated database or restore a backup from this version. Do not blindly stamp migration versions on a legacy database.

## Development and verification

Python 3.11+ and Node.js 22 are required for development. Use the same private `.env` configuration for the backend; run `python backend/database.py init` before starting it. The local Docker database has no published port, so native Python development needs an accessible external Postgres instance or an explicitly configured development-only port mapping.

```sh
python3 -m venv .venv
. .venv/bin/activate
pip install -r backend/requirements-dev.txt
python -m pytest -q
python scripts/check-public-files.py
cd frontend
npm ci
npm test
npm run build
npm audit --omit=dev
```

Unit tests use isolated, synthetic SQLite data and real authentication/CSRF checks; they do not connect to your configured trading database. Optional TLS tests run only when `TEST_DATABASE_URL` and `TEST_CA_CERT` explicitly identify a disposable TLS-enabled Postgres instance. Run the backend on loopback port 7777 and `npm run dev` for frontend development; Vite proxies `/api` to the backend.

With Docker running, `python scripts/test-compose.py local` and `python scripts/test-compose.py external` create disposable test installations and verify initialization, a synthetic import, authentication, migrations and restart persistence. Test volumes are retained rather than automatically deleted. They select an available loopback port automatically. Run these only in a development/test environment, never as maintenance commands for a real installation.

GitHub Actions runs backend/frontend checks and both Compose modes on AMD64 and ARM64. Production frontend dependencies are audited separately from the build toolchain. The full `npm audit` currently reports development-only advisories in Tailwind 3's glob/watcher dependencies; avoid building untrusted source or exposing the Vite development server publicly.

## License

MIT, copyright 2026 dacby88. Dependencies retain their own licenses, including React, shadcn/ui and Radix UI (MIT), Flask (BSD-3-Clause), SQLAlchemy (MIT), pandas and NumPy (BSD-3-Clause), and Lucide (ISC). Keep upstream license notices when redistributing dependencies or built images. Frontend builds include application and dependency notices in `/THIRD_PARTY_LICENSES.txt`.
