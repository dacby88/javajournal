import os

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError

from config import database_url

pytestmark = pytest.mark.skipif(not os.environ.get('TEST_DATABASE_URL') or not os.environ.get('TEST_CA_CERT'),
                               reason='Requires an explicitly configured disposable TLS Postgres instance.')


def settings():
    return {'DATABASE_URL': os.environ['TEST_DATABASE_URL'], 'PG_SSLMODE': 'verify-full',
            'PG_SSLROOTCERT': os.environ['TEST_CA_CERT']}


def test_postgres_verified_tls_connection():
    engine = create_engine(database_url(settings()), hide_parameters=True)
    try:
        with engine.connect() as connection:
            assert connection.execute(text('SELECT 1')).scalar() == 1
    finally:
        engine.dispose()


def test_postgres_rejects_a_bad_password():
    url = database_url(settings()).set(password='deliberately-invalid-synthetic-password')
    engine = create_engine(url, hide_parameters=True)
    try:
        with pytest.raises(OperationalError):
            engine.connect()
    finally:
        engine.dispose()


def test_postgres_rejects_a_missing_ca_certificate():
    env = settings()
    env['PG_SSLROOTCERT'] = env['PG_SSLROOTCERT'] + '.missing'
    engine = create_engine(database_url(env), hide_parameters=True)
    try:
        with pytest.raises(OperationalError):
            engine.connect()
    finally:
        engine.dispose()
