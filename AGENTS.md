# Java Journal project instructions

This is the sanitized, public, single-owner version. Never copy private deployment files, personal broker reports, database files, environment secrets or private Git history into this repository.

## Structure

- `backend/app.py`: Flask routes; importing the app does not initialize the database.
- `backend/config.py`: shared database and session configuration.
- `backend/database.py`: bounded connection retries, serialized Alembic upgrades and idempotent broker seeding.
- `backend/security.py` and `backend/auth.py`: session authentication, setup token and CSRF enforcement.
- `backend/migrations/`: versioned schema changes. Review generated migrations before running them.
- `frontend/`: React/Vite. All API mutations, including uploads, must use `services/http.ts`.
- Base Compose uses external Postgres; the local overlay adds a private persistent Postgres service with a non-superuser application role.
- `postgres/Dockerfile` copies the initialization script into the image with executable permissions. Do not bind-mount an executable initialization script from macOS; filesystem execution permissions can prevent first-run role creation.

## Verification

- Backend: `.venv/bin/python -m pytest -q` after installing `backend/requirements-dev.txt`.
- Frontend: `npm ci`, `npm test`, `npm run build`, `npm audit --omit=dev` from `frontend/`.
- Publication contents: `python scripts/check-public-files.py`; also manually review every new file before publication.
- End-to-end Docker modes: `python scripts/test-compose.py local` and `python scripts/test-compose.py external` on a machine with Docker running. Test instances select an available loopback port. These create dedicated synthetic test instances and retain test database volumes.
- Production dependency audit: install `pip-audit==2.9.0`, then run `pip-audit -r backend/requirements.txt`.
- Use in-memory SQLite for unit tests only. Real PostgreSQL smoke checks are necessary because SQLite can mask PostgreSQL-specific adapter and constraint problems.

## Constraints

- No automatic data destruction, volume deletion, blind migration stamping or schema downgrade.
- No credentials or connection URLs in logs, browser bundles, health responses or public commits.
- Preserve session/authentication, CSRF and trusted-host checks; do not bypass them to make tests pass.
- Runtime dependencies and container manifests are pinned. Update them deliberately, review release dates, and rerun audits and both architecture/mode checks.
- Frontend build output and local environment files are ignored, not committed.
- The inherited Tailwind 3 development toolchain has unresolved development-only advisories. Do not weaken audit controls to hide them; production dependency audits must remain clean.
