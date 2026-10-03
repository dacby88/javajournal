import os
from pathlib import Path

from sqlalchemy.engine import URL, make_url
from dotenv import load_dotenv


def load_environment():
    load_dotenv(Path(__file__).resolve().parents[1] / '.env', override=False)


def database_url(env=None):
    env = os.environ if env is None else env
    mode = env.get('DB_MODE', 'external')
    if mode not in ('local', 'external'):
        raise ValueError('DB_MODE must be local or external.')
    raw = env.get('DATABASE_URL', '').strip()
    if mode == 'local' and raw:
        raise ValueError('Local mode uses PG_* settings; remove DATABASE_URL.')
    if raw:
        try:
            url = make_url(raw)
        except Exception:
            raise ValueError('DATABASE_URL is not a valid connection URL.') from None
        if url.drivername == 'postgres':
            url = url.set(drivername='postgresql+psycopg2')
    else:
        required = ('PG_HOST', 'PG_DBNAME', 'PG_USER', 'PG_PASSWORD')
        if any(not env.get(key) for key in required):
            raise ValueError('Provide DATABASE_URL or all required PG_* settings.')
        try:
            port = int(env.get('PG_PORT', '5432'))
            if not 1 <= port <= 65535:
                raise ValueError
        except ValueError:
            raise ValueError('PG_PORT must be between 1 and 65535.') from None
        url = URL.create('postgresql+psycopg2', username=env['PG_USER'],
                         password=env['PG_PASSWORD'], host=env['PG_HOST'],
                         port=port, database=env['PG_DBNAME'])
    if url.get_backend_name() == 'sqlite':
        if env.get('APP_ENV') != 'test':
            raise ValueError('SQLite is supported only for isolated tests.')
        return url
    if url.drivername not in ('postgresql', 'postgresql+psycopg2'):
        raise ValueError('Use a PostgreSQL connection URL.')
    if not all((url.host, url.database, url.username, url.password)):
        raise ValueError('PostgreSQL host, database, username and password are required.')
    query = dict(url.query)
    for key, name in (('sslmode', 'PG_SSLMODE'), ('sslrootcert', 'PG_SSLROOTCERT')):
        if env.get(name):
            query[key] = env[name]
    query.setdefault('sslmode', 'disable' if mode == 'local' else 'verify-full')
    if query['sslmode'] not in ('disable', 'require', 'verify-ca', 'verify-full'):
        raise ValueError('PG_SSLMODE must be disable, require, verify-ca or verify-full.')
    query.setdefault('connect_timeout', '10')
    query.setdefault('application_name', 'javajournal')
    return url.set(drivername='postgresql+psycopg2', query=query)


def configure_app(app):
    load_environment()
    secret = os.environ.get('SECRET_KEY', '')
    setup_token = os.environ.get('SETUP_TOKEN', '')
    if len(secret) < 32 or len(setup_token) < 32:
        raise ValueError('SECRET_KEY and SETUP_TOKEN must each contain at least 32 characters.')
    url = database_url()
    engine_options = {'pool_pre_ping': True, 'hide_parameters': True}
    if url.get_backend_name() == 'postgresql':
        engine_options.update(pool_recycle=300, pool_size=5, max_overflow=5)
    app.config.update(
        SQLALCHEMY_DATABASE_URI=url,
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        SQLALCHEMY_ENGINE_OPTIONS=engine_options,
        MAX_CONTENT_LENGTH=16 * 1024 * 1024,  # 16MB max file size
        SECRET_KEY=secret,
        SETUP_TOKEN=setup_token,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE='Lax',
        SESSION_COOKIE_SECURE=os.environ.get('SESSION_COOKIE_SECURE', 'false').lower() == 'true',
        PERMANENT_SESSION_LIFETIME=604800,
        TRUSTED_HOSTS=[host.strip() for host in os.environ.get('APP_TRUSTED_HOSTS', 'localhost,127.0.0.1,[::1]').split(',') if host.strip()],
    )
