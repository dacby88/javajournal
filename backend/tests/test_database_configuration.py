import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, inspect, select, text

from config import database_url
from database import initialize, SCHEMA_REVISION
from models import BrokerFormat, db


def settings(**extra):
    return dict(PG_HOST='database.example', PG_DBNAME='journal', PG_USER='owner',
                PG_PASSWORD='synthetic-only', **extra)


def test_postgres_password_is_not_interpolated_into_url():
    env = settings()
    env['PG_PASSWORD'] = 'synthetic:@/$#% password'
    url = database_url(env)
    assert url.password == env['PG_PASSWORD']
    assert 'synthetic' not in str(url)


def test_cloud_url_takes_precedence_and_is_normalized():
    url = database_url(settings(DATABASE_URL='postgres://cloud:synthetic-only@cloud.example/journal?sslmode=require'))
    assert url.host == 'cloud.example'
    assert url.drivername == 'postgresql+psycopg2'
    assert url.query['sslmode'] == 'require'


def test_external_defaults_to_verified_tls():
    assert database_url(settings()).query['sslmode'] == 'verify-full'


def test_local_mode_uses_private_docker_network():
    url = database_url(settings(DB_MODE='local'))
    assert url.query['sslmode'] == 'disable'
    with pytest.raises(ValueError, match='remove DATABASE_URL'):
        database_url(settings(DB_MODE='local', DATABASE_URL='postgres://cloud:synthetic@cloud.example/journal'))


def test_tls_certificate_settings_are_forwarded():
    url = database_url(settings(PG_SSLMODE='verify-full', PG_SSLROOTCERT='/certs/root.crt'))
    assert url.query['sslrootcert'] == '/certs/root.crt'


@pytest.mark.parametrize('env', [{}, settings(PG_PORT='invalid'), settings(PG_SSLMODE='prefer'),
                                 {'DATABASE_URL': 'not a URL'}, {'DATABASE_URL': 'sqlite:///:memory:'},
                                 settings(DB_MODE='unknown')])
def test_invalid_configuration_fails_without_exposing_credentials(env):
    with pytest.raises(ValueError) as error:
        database_url(env)
    assert 'synthetic-only' not in str(error.value)


def test_sqlite_is_explicitly_test_only():
    assert database_url({'DATABASE_URL': 'sqlite:///:memory:', 'APP_ENV': 'test'}).get_backend_name() == 'sqlite'


def test_migrations_and_seed_are_repeatable_and_preserve_data():
    engine = create_engine('sqlite:///:memory:')
    initialize(engine)
    with engine.begin() as connection:
        connection.execute(text("INSERT INTO users (id, username, password_hash) VALUES (1, 'synthetic_owner', 'synthetic-hash')"))
    initialize(engine)
    with engine.connect() as connection:
        assert connection.execute(text('SELECT version_num FROM alembic_version')).scalar() == SCHEMA_REVISION
        assert connection.execute(text('SELECT username FROM users')).scalar() == 'synthetic_owner'
        assert len(connection.execute(select(BrokerFormat.__table__.c.id)).all()) == 3
    assert 'ck_users_single_owner' in {item['name'] for item in inspect(engine).get_check_constraints('users')}
    engine.dispose()


def test_initial_migration_matches_every_model_table():
    engine = create_engine('sqlite:///:memory:')
    initialize(engine)
    with engine.connect() as connection:
        reflected = set(inspect(connection).get_table_names())
        assert set(db.metadata.tables) <= reflected
        diff = compare_metadata(
            MigrationContext.configure(connection, opts={'compare_type': True}),
            db.metadata,
        )
    assert diff == []
    engine.dispose()
