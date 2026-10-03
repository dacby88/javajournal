#!/usr/bin/env python3
"""Inactive accounts stay in Manage Accounts but drop out of dropdown lists."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ['DATABASE_URL'] = 'sqlite:///:memory:'

from app import app, db
from models import Account


def _ctx():
    return app.app_context()


def _reset_db():
    db.drop_all()
    db.create_all()


def _make_account(name, is_active=True):
    account = Account(name=name, is_active=is_active)
    db.session.add(account)
    db.session.commit()
    return account


def test_get_accounts_omits_inactive_by_default():
    with _ctx():
        _reset_db()
        _make_account('Active IRA')
        _make_account('Old Broker', is_active=False)
        client = app.test_client()
        response = client.get('/api/accounts')
        assert response.status_code == 200
        names = [a['name'] for a in response.get_json()['data']]
        assert names == ['Active IRA']


def test_get_accounts_include_inactive_puts_inactive_last():
    with _ctx():
        _reset_db()
        _make_account('Zeta Active')
        _make_account('Alpha Inactive', is_active=False)
        _make_account('Beta Active')
        _make_account('Gamma Inactive', is_active=False)
        client = app.test_client()
        response = client.get('/api/accounts?include_inactive=true')
        assert response.status_code == 200
        names = [a['name'] for a in response.get_json()['data']]
        assert names == ['Beta Active', 'Zeta Active', 'Alpha Inactive', 'Gamma Inactive']
        assert [a['is_active'] for a in response.get_json()['data']] == [True, True, False, False]


def test_put_is_active_false_hides_from_default_list():
    with _ctx():
        _reset_db()
        account = _make_account('Swing')
        client = app.test_client()
        response = client.put(f'/api/accounts/{account.id}', json={'is_active': False})
        assert response.status_code == 200
        assert response.get_json()['data']['is_active'] is False
        names = [a['name'] for a in client.get('/api/accounts').get_json()['data']]
        assert names == []
        included = client.get('/api/accounts?include_inactive=true').get_json()['data']
        assert len(included) == 1
        assert included[0]['is_active'] is False
