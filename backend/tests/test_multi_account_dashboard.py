#!/usr/bin/env python3
"""The dashboard aggregates stats across every account in the selection."""

import os
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ['DATABASE_URL'] = 'sqlite:///:memory:'

from app import app, db, _parse_account_ids_arg, _account_filter, _summed_account_value
from models import Account, Trade


def _ctx():
    return app.app_context()


def _reset_db():
    db.drop_all()
    db.create_all()


def _make_account(name, starting_value=None):
    settings = {'starting_account_value': starting_value} if starting_value else None
    account = Account(name=name, settings=settings)
    db.session.add(account)
    db.session.commit()
    return account


def _make_trade(account_id, net_pnl, exit_date):
    trade = Trade(
        symbol='SPY',
        underlying_symbol='SPY',
        asset_class='STK',
        entry_date=exit_date - timedelta(days=1),
        exit_date=exit_date,
        entry_price=100,
        exit_price=100,
        quantity=1,
        side='LONG',
        net_pnl=net_pnl,
        is_open=False,
        account_id=account_id,
    )
    db.session.add(trade)
    db.session.commit()
    return trade


def _dashboard(client, query):
    response = client.get(f'/api/dashboard?{query}')
    assert response.status_code == 200, response.get_data(as_text=True)
    return response.get_json()['data']


def test_parse_account_ids_arg_supports_single_repeated_and_csv():
    with app.test_request_context('/?account_ids=1,2&account_ids=3'):
        assert _parse_account_ids_arg(__import__('flask').request.args) == [1, 2, 3]
    with app.test_request_context('/?account_id=7'):
        assert _parse_account_ids_arg(__import__('flask').request.args) == [7]
    with app.test_request_context('/?account_ids=4,4,4'):
        assert _parse_account_ids_arg(__import__('flask').request.args) == [4]
    with app.test_request_context('/'):
        assert _parse_account_ids_arg(__import__('flask').request.args) is None


def test_account_filter_is_none_for_all_accounts():
    assert _account_filter(Trade.account_id, None) is None
    assert _account_filter(Trade.account_id, []) is None


def test_summed_account_value_adds_up_selected_accounts():
    with _ctx():
        _reset_db()
        a = _make_account('A', starting_value=10000)
        b = _make_account('B', starting_value=25000)
        c = _make_account('C', starting_value=999)
        assert _summed_account_value([a.id, b.id]) == 35000
        assert _summed_account_value([a.id, c.id]) == 10999
        assert _summed_account_value(None) is None


def test_dashboard_aggregates_over_multiple_accounts():
    with _ctx():
        _reset_db()
        a = _make_account('A')
        b = _make_account('B')
        c = _make_account('C')
        _make_trade(a.id, 100, date(2024, 1, 10))
        _make_trade(b.id, 200, date(2024, 1, 11))
        _make_trade(c.id, 400, date(2024, 1, 12))
        # Legacy trade with no account assignment
        _make_trade(None, 8, date(2024, 1, 13))

        client = app.test_client()
        start = '2024-01-01'
        end = '2024-01-31'

        single = _dashboard(client, f'account_id={a.id}&start_date={start}&end_date={end}')
        assert single['overall']['total_trades'] == 2  # account A + the NULL-account trade
        assert float(single['overall']['net_pnl']) == 108

        pair = _dashboard(client, f'account_ids={a.id},{b.id}&start_date={start}&end_date={end}')
        assert pair['overall']['total_trades'] == 3
        assert float(pair['overall']['net_pnl']) == 308

        csv_pair = _dashboard(client, f'account_ids={a.id},{b.id}&start_date={start}&end_date={end}')
        assert csv_pair['overall']['total_trades'] == 3

        repeated = _dashboard(
            client,
            f'account_ids={a.id}&account_ids={b.id}&start_date={start}&end_date={end}',
        )
        assert repeated['overall']['total_trades'] == 3
        assert float(repeated['overall']['net_pnl']) == 308

        everyone = _dashboard(client, f'start_date={start}&end_date={end}')
        assert everyone['overall']['total_trades'] == 4
        assert float(everyone['overall']['net_pnl']) == 708


def test_trades_endpoint_aggregates_over_multiple_accounts():
    with _ctx():
        _reset_db()
        a = _make_account('A')
        b = _make_account('B')
        c = _make_account('C')
        _make_trade(a.id, 100, date(2024, 1, 10))
        _make_trade(b.id, 200, date(2024, 1, 11))
        _make_trade(c.id, 400, date(2024, 1, 12))

        client = app.test_client()
        response = client.get('/api/trades?account_ids={},{}'.format(a.id, b.id))
        assert response.status_code == 200
        assert response.get_json()['total'] == 2

        response = client.get(f'/api/trades?account_id={a.id}')
        assert response.get_json()['total'] == 1

        response = client.get('/api/trades')
        assert response.get_json()['total'] == 3
