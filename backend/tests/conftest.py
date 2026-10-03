import os
from pathlib import Path
import sys

import pytest
from flask.testing import FlaskClient
from werkzeug.datastructures import Headers

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ['APP_ENV'] = 'test'
os.environ['DB_MODE'] = 'external'
os.environ['APP_TRUSTED_HOSTS'] = 'localhost,127.0.0.1'
os.environ['SESSION_COOKIE_SECURE'] = 'false'
os.environ['CORS_ORIGINS'] = ''
os.environ['DATABASE_URL'] = 'sqlite:///:memory:'
os.environ['SECRET_KEY'] = 'synthetic-test-session-key-not-for-deployment'
os.environ['SETUP_TOKEN'] = 'synthetic-test-setup-token-not-for-deployment'

from app import app
from auth import hash_password
from models import db, User


class AuthenticatedClient(FlaskClient):
    def open(self, *args, **kwargs):
        with app.app_context():
            if db.session.get(User, 1) is None:
                db.session.add(User(id=1, username='test_owner', password_hash=hash_password('synthetic-password')))
                db.session.commit()
        with self.session_transaction() as state:
            state['user_id'] = 1
            state['csrf_token'] = 'synthetic-csrf-token'
        headers = Headers(kwargs.get('headers'))
        headers.setdefault('X-CSRF-Token', 'synthetic-csrf-token')
        kwargs['headers'] = headers
        return super().open(*args, **kwargs)


@pytest.fixture(autouse=True)
def isolated_database(request, monkeypatch):
    app.config['TESTING'] = True
    with app.app_context():
        db.session.remove()
        db.engine.dispose()
        db.create_all()
    if not request.node.get_closest_marker('security'):
        monkeypatch.setattr(app, 'test_client_class', AuthenticatedClient)
    yield
    with app.app_context():
        db.session.remove()
