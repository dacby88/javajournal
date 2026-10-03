#!/usr/bin/env python3
"""Tests for override_auto_description on trades."""

import json
import os
import sys
from datetime import date, datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ['DATABASE_URL'] = 'sqlite:///:memory:'

from app import app, db, _recalculate_trade_fields
from models import Account, Execution, Trade


def _ctx():
    return app.app_context()


def _seed_account():
    account = Account(name='Test Account')
    db.session.add(account)
    db.session.commit()
    return account


def _make_trade(account_id, **kwargs):
    defaults = dict(
        account_id=account_id,
        symbol='AAPL',
        description='AAPL',
        entry_date=date(2026, 1, 1),
        entry_price=100.0,
        quantity=1,
        side='LONG',
        entry_execution_ids='[]',
        exit_execution_ids='[]',
    )
    defaults.update(kwargs)
    trade = Trade(**defaults)
    db.session.add(trade)
    db.session.commit()
    return trade


def test_override_defaults_false_and_is_in_to_dict():
    with _ctx():
        db.create_all()
        account = _seed_account()
        trade = _make_trade(account.id)
        assert trade.override_auto_description is False
        data = trade.to_dict()
        assert 'override_auto_description' in data
        assert data['override_auto_description'] is False


def test_put_new_description_sets_override_true():
    with _ctx():
        db.create_all()
        account = _seed_account()
        trade = _make_trade(account.id, description='AAPL', override_auto_description=False)
        client = app.test_client()
        response = client.put(
            f'/api/trades/{trade.id}',
            json={'description': 'My custom name'},
        )
        assert response.status_code == 200, response.data
        body = response.get_json()
        assert body['success'] is True
        assert body['data']['description'] == 'My custom name'
        assert body['data']['override_auto_description'] is True
        db.session.refresh(trade)
        assert trade.description == 'My custom name'
        assert trade.override_auto_description is True


def test_put_override_false_leaves_description():
    with _ctx():
        db.create_all()
        account = _seed_account()
        trade = _make_trade(
            account.id,
            description='My custom name',
            override_auto_description=True,
        )
        client = app.test_client()
        response = client.put(
            f'/api/trades/{trade.id}',
            json={'override_auto_description': False},
        )
        assert response.status_code == 200, response.data
        body = response.get_json()
        assert body['data']['description'] == 'My custom name'
        assert body['data']['override_auto_description'] is False
        db.session.refresh(trade)
        assert trade.description == 'My custom name'
        assert trade.override_auto_description is False


def test_put_unchanged_description_does_not_force_override():
    with _ctx():
        db.create_all()
        account = _seed_account()
        trade = _make_trade(account.id, description='AAPL', override_auto_description=False)
        client = app.test_client()
        response = client.put(
            f'/api/trades/{trade.id}',
            json={'description': 'AAPL'},
        )
        assert response.status_code == 200, response.data
        body = response.get_json()
        assert body['data']['override_auto_description'] is False


def test_put_unchanged_fallback_description_does_not_force_override():
    """When description is NULL, to_dict() serves the symbol as a fallback.

    Saving that unchanged displayed value (e.g. re-submitting the symbol
    text shown in the UI) must not be treated as a real edit.
    """
    with _ctx():
        db.create_all()
        account = _seed_account()
        trade = _make_trade(
            account.id,
            description=None,
            symbol='AAPL',
            override_auto_description=False,
        )
        client = app.test_client()
        response = client.put(
            f'/api/trades/{trade.id}',
            json={'description': 'AAPL'},
        )
        assert response.status_code == 200, response.data
        body = response.get_json()
        assert body['data']['override_auto_description'] is False
        db.session.refresh(trade)
        assert trade.override_auto_description is False


def _make_spread_executions(account_id):
    entry1 = Execution(
        account_id=account_id,
        symbol='A 2026-01-01 100 C',
        underlying_symbol='A',
        asset_class='OPT',
        strike=100,
        expiry=date(2026, 1, 1),
        put_call='C',
        side='BUY',
        quantity=1,
        price=5.0,
        net_cash=-500.0,
        commission=1.0,
        trade_date=date(2026, 1, 1),
        exec_datetime=datetime(2026, 1, 1, 10, 0, 0),
        is_open=True,
    )
    entry2 = Execution(
        account_id=account_id,
        symbol='A 2026-01-01 110 C',
        underlying_symbol='A',
        asset_class='OPT',
        strike=110,
        expiry=date(2026, 1, 1),
        put_call='C',
        side='SELL',
        quantity=1,
        price=2.0,
        net_cash=200.0,
        commission=1.0,
        trade_date=date(2026, 1, 1),
        exec_datetime=datetime(2026, 1, 1, 10, 0, 1),
        is_open=True,
    )
    db.session.add_all([entry1, entry2])
    db.session.commit()
    return [entry1, entry2]


def test_recalculate_skips_description_when_override_true():
    with _ctx():
        db.create_all()
        account = _seed_account()
        execs = _make_spread_executions(account.id)
        trade = _make_trade(
            account.id,
            description='Keep this name',
            override_auto_description=True,
            entry_execution_ids=f'[{execs[0].id},{execs[1].id}]',
        )
        for e in execs:
            e.matched_trade_id = trade.id
        db.session.commit()

        result = _recalculate_trade_fields(trade, execs)
        assert result['success'] is True
        assert trade.description == 'Keep this name'
        assert trade.override_auto_description is True


def test_recalculate_auto_names_when_override_false():
    with _ctx():
        db.create_all()
        account = _seed_account()
        execs = _make_spread_executions(account.id)
        trade = _make_trade(
            account.id,
            description='Old name',
            override_auto_description=False,
            entry_execution_ids=f'[{execs[0].id},{execs[1].id}]',
        )
        for e in execs:
            e.matched_trade_id = trade.id
        db.session.commit()

        result = _recalculate_trade_fields(trade, execs)
        assert result['success'] is True
        assert trade.description != 'Old name'
        assert trade.description
        assert trade.override_auto_description is False


def test_manual_create_with_description_starts_locked():
    with _ctx():
        db.create_all()
        account = _seed_account()
        client = app.test_client()
        response = client.post(
            '/api/trades',
            json={'account_id': account.id, 'description': 'Manual iron condor'},
        )
        assert response.status_code == 200, response.data
        body = response.get_json()
        assert body['success'] is True
        assert body['data']['description'] == 'Manual iron condor'
        assert body['data']['override_auto_description'] is True


def test_manual_create_without_description_starts_unlocked():
    with _ctx():
        db.create_all()
        account = _seed_account()
        client = app.test_client()
        response = client.post(
            '/api/trades',
            json={'account_id': account.id},
        )
        assert response.status_code == 200, response.data
        body = response.get_json()
        assert body['success'] is True
        assert body['data']['override_auto_description'] is False


def _make_open_option_execution(account_id, symbol, underlying, strike, expiry, put_call='P'):
    execution = Execution(
        account_id=account_id,
        symbol=symbol,
        underlying_symbol=underlying,
        asset_class='OPT',
        strike=strike,
        expiry=expiry,
        put_call=put_call,
        side='SELL',
        quantity=1,
        price=10.0,
        net_cash=1000.0,
        commission=1.0,
        trade_date=date(2026, 8, 5),
        exec_datetime=datetime(2026, 8, 5, 10, 0, 0),
        is_open=True,
    )
    db.session.add(execution)
    db.session.commit()
    return execution


def _make_trade_from_execution(account_id, execution, description, override_auto_description):
    trade = Trade(
        account_id=account_id,
        symbol=execution.symbol,
        underlying_symbol=execution.underlying_symbol,
        asset_class=execution.asset_class,
        strike=execution.strike,
        expiry=execution.expiry,
        put_call=execution.put_call,
        description=description,
        override_auto_description=override_auto_description,
        entry_date=execution.trade_date,
        entry_price=execution.price,
        quantity=execution.quantity,
        side='SHORT',
        entry_execution_ids=json.dumps([execution.id]),
        exit_execution_ids='[]',
        is_open=True,
        open_qty=execution.quantity,
    )
    db.session.add(trade)
    db.session.commit()
    execution.matched_trade_id = trade.id
    db.session.commit()
    return trade


def test_combine_keeps_locked_description_when_any_trade_overrides():
    with _ctx():
        db.create_all()
        account = _seed_account()
        locked_exec = _make_open_option_execution(
            account.id, 'SPX 2026-08-06 7740 P', 'SPX', 7740, date(2026, 8, 6),
        )
        unlocked_exec = _make_open_option_execution(
            account.id, 'SPX 2026-08-18 7740 P', 'SPX', 7740, date(2026, 8, 18),
        )
        locked = _make_trade_from_execution(
            account.id, locked_exec, 'Keep this name', True,
        )
        unlocked = _make_trade_from_execution(
            account.id, unlocked_exec, 'SPX 2026-08-18 7740P Single Option', False,
        )
        client = app.test_client()
        response = client.post(
            '/api/trades/combine',
            json={'trade_ids': [locked.id, unlocked.id]},
        )
        assert response.status_code == 200, response.data
        body = response.get_json()
        assert body['success'] is True
        assert body['data']['description'] == (
            'Keep this name + SPX 2026-08-18 7740P'
        )
        assert body['data']['override_auto_description'] is True


def test_combine_appends_other_locked_description_in_selection_order():
    with _ctx():
        db.create_all()
        account = _seed_account()
        first_exec = _make_open_option_execution(
            account.id, 'SPX 2026-08-06 7740 P', 'SPX', 7740, date(2026, 8, 6),
        )
        second_exec = _make_open_option_execution(
            account.id, 'SPX 2026-08-18 7740 P', 'SPX', 7740, date(2026, 8, 18),
        )
        first = _make_trade_from_execution(
            account.id, first_exec, 'Locked A', True,
        )
        second = _make_trade_from_execution(
            account.id, second_exec, 'Locked B', True,
        )
        client = app.test_client()
        response = client.post(
            '/api/trades/combine',
            json={'trade_ids': [second.id, first.id]},
        )
        assert response.status_code == 200, response.data
        body = response.get_json()
        assert body['success'] is True
        assert body['data']['description'] == 'Locked B + Locked A'
        assert body['data']['override_auto_description'] is True


def test_assign_to_locked_trade_appends_execution_symbol():
    with _ctx():
        db.create_all()
        account = _seed_account()
        existing_exec = _make_open_option_execution(
            account.id, 'SPX 2026-08-06 7740 P', 'SPX', 7740, date(2026, 8, 6),
        )
        new_exec = _make_open_option_execution(
            account.id, 'SPX 2026-08-18 7740 P', 'SPX', 7740, date(2026, 8, 18),
        )
        trade = _make_trade_from_execution(
            account.id, existing_exec, 'Keep this name', True,
        )
        client = app.test_client()
        response = client.post(
            f'/api/trades/{trade.id}/assign',
            json={'execution_ids': [new_exec.id]},
        )
        assert response.status_code == 200, response.data
        body = response.get_json()
        assert body['success'] is True
        assert body['data']['description'] == 'Keep this name + 2026-08-18 7740 P'
        assert body['data']['override_auto_description'] is True
        db.session.refresh(trade)
        assert trade.description == 'Keep this name + 2026-08-18 7740 P'


def test_assign_to_locked_trade_appends_execution_description():
    """When an execution has a broker description, that (not the raw symbol)
    is appended to a locked trade's description."""
    with _ctx():
        db.create_all()
        account = _seed_account()
        existing_exec = _make_open_option_execution(
            account.id, 'SPX 2026-08-06 7740 P', 'SPX', 7740, date(2026, 8, 6),
        )
        new_exec = _make_open_option_execution(
            account.id, 'SPX 2026-08-18 7740 P', 'SPX', 7740, date(2026, 8, 18),
        )
        new_exec.description = 'SPXW AUG 18 26 7740 PUT'
        db.session.commit()
        trade = _make_trade_from_execution(
            account.id, existing_exec, 'Keep this name', True,
        )
        client = app.test_client()
        response = client.post(
            f'/api/trades/{trade.id}/assign',
            json={'execution_ids': [new_exec.id]},
        )
        assert response.status_code == 200, response.data
        body = response.get_json()
        assert body['success'] is True
        assert body['data']['description'] == 'Keep this name + SPXW AUG 18 26 7740 PUT'
        db.session.refresh(trade)
        assert trade.description == 'Keep this name + SPXW AUG 18 26 7740 PUT'


def test_combine_uses_execution_description_when_extra_description_is_symbol():
    """When a combined-in trade's description is just its raw symbol, the
    symbol's broker description from its executions is appended instead."""
    with _ctx():
        db.create_all()
        account = _seed_account()
        locked_exec = _make_open_option_execution(
            account.id, 'SPX 2026-08-06 7740 P', 'SPX', 7740, date(2026, 8, 6),
        )
        symbol_desc_exec = _make_open_option_execution(
            account.id, 'SPX 2026-08-18 7740 P', 'SPX', 7740, date(2026, 8, 18),
        )
        symbol_desc_exec.description = 'SPXW AUG 18 26 7740 PUT'
        db.session.commit()
        locked = _make_trade_from_execution(
            account.id, locked_exec, 'Keep this name', True,
        )
        symbol_named = _make_trade_from_execution(
            account.id, symbol_desc_exec, 'SPX 2026-08-18 7740 P', False,
        )
        client = app.test_client()
        response = client.post(
            '/api/trades/combine',
            json={'trade_ids': [locked.id, symbol_named.id]},
        )
        assert response.status_code == 200, response.data
        body = response.get_json()
        assert body['success'] is True
        assert body['data']['description'] == 'Keep this name + SPXW AUG 18 26 7740 PUT'
        assert body['data']['override_auto_description'] is True


def test_assign_to_unlocked_trade_appends_without_repeated_symbol():
    with _ctx():
        db.create_all()
        account = _seed_account()
        existing_exec = _make_open_option_execution(
            account.id, 'SPX 2026-08-06 7740 P', 'SPX', 7740, date(2026, 8, 6),
        )
        new_exec = _make_open_option_execution(
            account.id, 'SPX 2026-08-18 7740 P', 'SPX', 7740, date(2026, 8, 18),
        )
        trade = _make_trade_from_execution(
            account.id, existing_exec, 'SPX 2026-08-06 7740P Single Option', False,
        )
        client = app.test_client()
        response = client.post(
            f'/api/trades/{trade.id}/assign',
            json={'execution_ids': [new_exec.id]},
        )
        assert response.status_code == 200, response.data
        body = response.get_json()
        assert body['success'] is True
        assert body['data']['description'] == 'SPX 2026-08-06 7740P Single Option + 2026-08-18 7740 P'
        assert body['data']['override_auto_description'] is False


def test_assign_same_symbol_and_expiry_appends_strike_only():
    with _ctx():
        db.create_all()
        account = _seed_account()
        existing_exec = _make_open_option_execution(
            account.id, 'SPX 2026-08-06 7740 P', 'SPX', 7740, date(2026, 8, 6),
        )
        new_exec = _make_open_option_execution(
            account.id, 'SPX 2026-08-06 7750 P', 'SPX', 7750, date(2026, 8, 6),
        )
        trade = _make_trade_from_execution(
            account.id, existing_exec, 'SPX 2026-08-06 7740P Single Option', False,
        )
        client = app.test_client()
        response = client.post(
            f'/api/trades/{trade.id}/assign',
            json={'execution_ids': [new_exec.id]},
        )
        assert response.status_code == 200, response.data
        body = response.get_json()
        assert body['data']['description'] == 'SPX 2026-08-06 7740P Single Option + 7750 P'


def test_assign_same_expiry_different_symbol_omits_expiry():
    with _ctx():
        db.create_all()
        account = _seed_account()
        existing_exec = _make_open_option_execution(
            account.id, 'SPX 2026-08-06 7740 P', 'SPX', 7740, date(2026, 8, 6),
        )
        new_exec = _make_open_option_execution(
            account.id, 'NVDA 2026-08-06 210 C', 'NVDA', 210, date(2026, 8, 6), 'C',
        )
        trade = _make_trade_from_execution(
            account.id, existing_exec, 'SPX 2026-08-06 7740P Single Option', False,
        )
        client = app.test_client()
        response = client.post(
            f'/api/trades/{trade.id}/assign',
            json={'execution_ids': [new_exec.id]},
        )
        assert response.status_code == 200, response.data
        body = response.get_json()
        assert body['data']['description'] == 'SPX 2026-08-06 7740P Single Option + NVDA 210 C'


def test_combine_auto_names_when_no_trade_overrides():
    with _ctx():
        db.create_all()
        account = _seed_account()
        first_exec = _make_open_option_execution(
            account.id, 'SPX 2026-08-06 7740 P', 'SPX', 7740, date(2026, 8, 6),
        )
        second_exec = _make_open_option_execution(
            account.id, 'SPX 2026-08-18 7740 P', 'SPX', 7740, date(2026, 8, 18),
        )
        first = _make_trade_from_execution(
            account.id, first_exec, 'Old A', False,
        )
        second = _make_trade_from_execution(
            account.id, second_exec, 'Old B', False,
        )
        client = app.test_client()
        response = client.post(
            '/api/trades/combine',
            json={'trade_ids': [first.id, second.id]},
        )
        assert response.status_code == 200, response.data
        body = response.get_json()
        assert body['success'] is True
        assert body['data']['override_auto_description'] is False
        assert body['data']['description'] != 'Old A'
        assert body['data']['description'] != 'Old B'
        assert 'Single Option' in body['data']['description']


def test_assign_skips_closing_execution_in_description():
    with _ctx():
        db.create_all()
        account = _seed_account()
        existing_exec = _make_open_option_execution(
            account.id, 'SPX 2026-08-06 7740 P', 'SPX', 7740, date(2026, 8, 6),
        )
        close_exec = _make_open_option_execution(
            account.id, 'SPX 2026-08-06 7740 P', 'SPX', 7740, date(2026, 8, 6),
        )
        close_exec.side = 'BUY'
        close_exec.description = 'SPXW AUG06 7740 PUT CLOSE'
        close_exec.exec_datetime = datetime(2026, 8, 6, 15, 0, 0)
        db.session.commit()
        trade = _make_trade_from_execution(
            account.id, existing_exec, 'Keep this name', True,
        )
        client = app.test_client()
        response = client.post(
            f'/api/trades/{trade.id}/assign',
            json={'execution_ids': [close_exec.id]},
        )
        assert response.status_code == 200, response.data
        body = response.get_json()
        assert body['data']['description'] == 'Keep this name'


def test_assign_appends_opening_executions_in_datetime_order():
    with _ctx():
        db.create_all()
        account = _seed_account()
        existing_exec = _make_open_option_execution(
            account.id, 'SPX 2026-08-06 7740 P', 'SPX', 7740, date(2026, 8, 6),
        )
        later = _make_open_option_execution(
            account.id, 'SPX 2026-08-18 7750 P', 'SPX', 7750, date(2026, 8, 18),
        )
        later.description = 'LATER LEG'
        later.exec_datetime = datetime(2026, 8, 18, 12, 0, 0)
        earlier = _make_open_option_execution(
            account.id, 'SPX 2026-08-10 7740 P', 'SPX', 7740, date(2026, 8, 10),
        )
        earlier.description = 'EARLIER LEG'
        earlier.exec_datetime = datetime(2026, 8, 10, 9, 0, 0)
        db.session.commit()
        trade = _make_trade_from_execution(
            account.id, existing_exec, 'Keep this name', True,
        )
        client = app.test_client()
        response = client.post(
            f'/api/trades/{trade.id}/assign',
            json={'execution_ids': [later.id, earlier.id]},
        )
        assert response.status_code == 200, response.data
        body = response.get_json()
        assert body['data']['description'] == 'Keep this name + EARLIER LEG + LATER LEG'


def test_assign_strips_single_option_when_appending():
    with _ctx():
        db.create_all()
        account = _seed_account()
        existing_exec = _make_open_option_execution(
            account.id, 'SPX 2026-08-06 7740 P', 'SPX', 7740, date(2026, 8, 6),
        )
        new_exec = _make_open_option_execution(
            account.id, 'SPX 2026-08-18 7740 P', 'SPX', 7740, date(2026, 8, 18),
        )
        new_exec.description = 'SPX 2026-08-18 7740P Single Option'
        db.session.commit()
        trade = _make_trade_from_execution(
            account.id, existing_exec, 'Keep this name', True,
        )
        client = app.test_client()
        response = client.post(
            f'/api/trades/{trade.id}/assign',
            json={'execution_ids': [new_exec.id]},
        )
        assert response.status_code == 200, response.data
        body = response.get_json()
        assert body['data']['description'] == 'Keep this name + 2026-08-18 7740P'
        assert 'Single Option' not in body['data']['description']


def test_assign_opening_and_closing_only_appends_opening():
    with _ctx():
        db.create_all()
        account = _seed_account()
        existing_exec = _make_open_option_execution(
            account.id, 'SPX 2026-08-06 7740 P', 'SPX', 7740, date(2026, 8, 6),
        )
        open_exec = _make_open_option_execution(
            account.id, 'SPX 2026-08-18 7740 P', 'SPX', 7740, date(2026, 8, 18),
        )
        open_exec.description = 'NEW OPEN'
        close_exec = _make_open_option_execution(
            account.id, 'SPX 2026-08-06 7740 P', 'SPX', 7740, date(2026, 8, 6),
        )
        close_exec.side = 'BUY'
        close_exec.description = 'CLOSE LEG'
        close_exec.exec_datetime = datetime(2026, 8, 6, 16, 0, 0)
        db.session.commit()
        trade = _make_trade_from_execution(
            account.id, existing_exec, 'Keep this name', True,
        )
        client = app.test_client()
        response = client.post(
            f'/api/trades/{trade.id}/assign',
            json={'execution_ids': [close_exec.id, open_exec.id]},
        )
        assert response.status_code == 200, response.data
        body = response.get_json()
        assert body['data']['description'] == 'Keep this name + NEW OPEN'
        assert 'CLOSE LEG' not in body['data']['description']
