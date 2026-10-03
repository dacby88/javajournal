import io

import pytest
from sqlalchemy.exc import IntegrityError

from app import app
from auth import hash_password
from database import initialize
from models import db, User

pytestmark = pytest.mark.security


def csrf(client):
    response = client.get('/api/auth/csrf')
    assert response.status_code == 200
    return {'X-CSRF-Token': response.get_json()['csrf_token']}


def setup(client):
    headers = csrf(client)
    headers['X-Setup-Token'] = app.config['SETUP_TOKEN']
    return client.post('/api/auth/setup', headers=headers,
                       json={'username': 'synthetic_owner', 'password': 'synthetic-password'})


def test_trading_apis_require_real_authentication():
    client = app.test_client()
    for path in ('/api/accounts', '/api/dashboard', '/api/trades', '/api/executions', '/api/tags'):
        assert client.get(path).status_code == 401
    assert client.post('/api/accounts', json={'name': 'Synthetic'}).status_code == 401
    assert client.post('/api/auth/logout').status_code == 401


def test_first_setup_requires_an_operator_token():
    client = app.test_client()
    headers = csrf(client)
    payload = {'username': 'synthetic_owner', 'password': 'synthetic-password'}
    assert client.post('/api/auth/setup', headers=headers, json=payload).status_code == 403
    assert setup(client).status_code == 201
    assert setup(app.test_client()).status_code == 403


def test_csrf_protects_authenticated_mutations_and_login():
    client = app.test_client()
    assert setup(client).status_code == 201
    assert client.post('/api/accounts', json={'name': 'Synthetic'}).status_code == 403
    assert client.post('/api/accounts', headers=csrf(client), json={'name': 'Synthetic'}).status_code == 200
    assert app.test_client().post('/api/auth/login', json={'username': 'synthetic_owner', 'password': 'synthetic-password'}).status_code == 403


def test_logout_invalidates_the_session():
    client = app.test_client()
    assert setup(client).status_code == 201
    assert client.post('/api/auth/logout', headers=csrf(client)).status_code == 200
    assert client.get('/api/accounts').status_code == 401
    assert client.post('/api/auth/login', headers=csrf(client),
                       json={'username': 'synthetic_owner', 'password': 'synthetic-password'}).status_code == 200
    assert client.get('/api/accounts').status_code == 200


def test_single_owner_is_enforced_by_the_database():
    with app.app_context():
        db.session.add(User(id=2, username='other_owner', password_hash=hash_password('synthetic-password')))
        with pytest.raises(IntegrityError):
            db.session.commit()
        db.session.rollback()


def test_disabled_owner_cannot_login_or_use_existing_session():
    client = app.test_client()
    assert setup(client).status_code == 201
    with app.app_context():
        db.session.get(User, 1).is_active = False
        db.session.commit()
    assert client.get('/api/accounts').status_code == 401
    assert client.post('/api/auth/login', headers=csrf(client),
                       json={'username': 'synthetic_owner', 'password': 'synthetic-password'}).status_code == 401


def test_long_passwords_do_not_get_silently_truncated():
    left, right = 'a' * 80 + 'left', 'a' * 80 + 'right'
    from auth import verify_password
    assert not verify_password(right, hash_password(left))


def test_ready_checks_schema_and_health_does_not_expose_connection_details():
    client = app.test_client()
    assert client.get('/api/health').get_json() == {'status': 'healthy', 'version': '1.0.0'}
    assert client.get('/api/ready').status_code == 503
    with app.app_context():
        db.drop_all()
        initialize(db.engine)
    assert client.get('/api/ready').status_code == 200


def test_first_run_import_and_dashboard_with_seeded_formats():
    with app.app_context():
        db.drop_all()
        initialize(db.engine)
    client = app.test_client()
    assert setup(client).status_code == 201
    formats = client.get('/api/broker-formats').get_json()['data']
    assert {item['code'] for item in formats} == {'ibkr', 'schwab', 'tastytrade'}
    ibkr = next(item['id'] for item in formats if item['code'] == 'ibkr')
    account = client.post('/api/accounts', headers=csrf(client),
                          json={'name': 'Synthetic account', 'broker_format_id': ibkr}).get_json()['data']
    sample = b'Symbol,AssetClass,Buy/Sell,Quantity,Price,TradeDate,Date/Time,Commission,NetCash,ExecID\nAAPL,STK,BUY,1,100,20260115,20260115;093000,0,-100,SYNTHETIC-1\nAAPL,STK,SELL,1,110,20260115,20260115;100000,0,110,SYNTHETIC-2\n'
    result = client.post('/api/import/csv', headers=csrf(client), data={
        'file': (io.BytesIO(sample), 'synthetic.csv'), 'account_id': str(account['id']), 'broker_format_id': str(ibkr),
    })
    assert result.status_code == 200, result.get_json()
    assert result.get_json()['success']
    dashboard = client.get(f"/api/dashboard?account_ids={account['id']}").get_json()['data']
    assert dashboard['overall']['total_trades'] == 1
    assert dashboard['overall']['net_pnl'] == 10
