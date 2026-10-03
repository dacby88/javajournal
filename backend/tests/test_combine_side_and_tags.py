#!/usr/bin/env python3
"""Combining trades must keep source tags; the LONG/SHORT side comes only
from the initial executions (earliest execution date, largest absolute price)."""

import json
import os
import sys
from datetime import date, datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ['DATABASE_URL'] = 'sqlite:///:memory:'

from app import app, db
from models import Account, Execution, Tag, Trade, trade_tags


def _ctx():
    return app.app_context()


def _seed_account():
    account = Account(name='Test Account')
    db.session.add(account)
    db.session.commit()
    return account


def _make_execution(account_id, symbol, side, price, net_cash, strike, expiry, exec_dt):
    execution = Execution(
        account_id=account_id,
        symbol=symbol,
        underlying_symbol='SPX',
        asset_class='OPT',
        strike=strike,
        expiry=expiry,
        put_call='P',
        side=side,
        quantity=1,
        price=price,
        net_cash=net_cash,
        commission=1.0,
        trade_date=exec_dt.date(),
        exec_datetime=exec_dt,
        is_open=True,
    )
    db.session.add(execution)
    db.session.commit()
    return execution


def _make_trade(account_id, execution, side, tag=None):
    trade = Trade(
        account_id=account_id,
        symbol=execution.symbol,
        underlying_symbol=execution.underlying_symbol,
        asset_class=execution.asset_class,
        strike=execution.strike,
        expiry=execution.expiry,
        put_call=execution.put_call,
        description=execution.symbol,
        entry_date=execution.trade_date,
        entry_price=execution.price,
        quantity=execution.quantity,
        side=side,
        entry_execution_ids=json.dumps([execution.id]),
        exit_execution_ids='[]',
        is_open=True,
        open_qty=execution.quantity,
    )
    db.session.add(trade)
    db.session.commit()
    execution.matched_trade_id = trade.id
    if tag is not None:
        trade.tags_list.append(tag)
    db.session.commit()
    return trade


def test_combine_keeps_tags_from_source_trades():
    with _ctx():
        db.create_all()
        account = _seed_account()
        tag_a = Tag(name='Setup A', color='#ff0000')
        tag_b = Tag(name='Setup B', color='#00ff00')
        db.session.add_all([tag_a, tag_b])
        db.session.commit()

        e1 = _make_execution(
            account.id, 'SPX 2026-08-06 7740 P', 'SELL', 10.0, 1000.0,
            7740, date(2026, 8, 6), datetime(2026, 8, 5, 10, 0, 0),
        )
        e2 = _make_execution(
            account.id, 'SPX 2026-08-18 7740 P', 'SELL', 12.0, 1200.0,
            7740, date(2026, 8, 18), datetime(2026, 8, 5, 10, 0, 1),
        )
        t1 = _make_trade(account.id, e1, 'SHORT', tag_a)
        t2 = _make_trade(account.id, e2, 'SHORT', tag_b)

        client = app.test_client()
        response = client.post(
            '/api/trades/combine',
            json={'trade_ids': [t1.id, t2.id]},
        )
        assert response.status_code == 200, response.data
        body = response.get_json()
        assert body['success'] is True
        tag_names = sorted(t['name'] for t in body['data'].get('tags') or [])
        assert tag_names == ['Setup A', 'Setup B']

        combined_id = body['data']['id']
        db.session.expire_all()
        persisted = {
            row[0]
            for row in db.session.execute(
                db.select(trade_tags.c.tag_id).where(
                    trade_tags.c.trade_id == combined_id
                )
            )
        }
        assert persisted == {tag_a.id, tag_b.id}


def test_combine_side_set_by_largest_price_on_earliest_date():
    """Both executions are on the earliest date; the largest absolute price leg
    (the BUY @ 15.0) defines the side as LONG, regardless of source trade sides."""
    with _ctx():
        db.create_all()
        account = _seed_account()
        sold = _make_execution(
            account.id, 'SPX 2026-08-06 7740 P', 'SELL', 10.0, 1000.0,
            7740, date(2026, 8, 6), datetime(2026, 8, 5, 10, 0, 0),
        )
        bought = _make_execution(
            account.id, 'SPX 2026-08-06 7700 P', 'BUY', 15.0, -1500.0,
            7700, date(2026, 8, 6), datetime(2026, 8, 5, 10, 0, 1),
        )
        t1 = _make_trade(account.id, sold, 'SHORT')
        t2 = _make_trade(account.id, bought, 'SHORT')

        client = app.test_client()
        response = client.post(
            '/api/trades/combine',
            json={'trade_ids': [t1.id, t2.id]},
        )
        assert response.status_code == 200, response.data
        body = response.get_json()
        assert body['success'] is True
        assert body['data']['side'] == 'LONG'

        db.session.expire_all()
        combined = db.session.get(Trade, body['data']['id'])
        assert combined.side == 'LONG'


def test_combine_later_executions_do_not_change_side():
    """A higher-priced execution on a LATER date must not flip the side; only
    the earliest execution date defines it."""
    with _ctx():
        db.create_all()
        account = _seed_account()
        sold = _make_execution(
            account.id, 'SPX 2026-08-06 7740 P', 'SELL', 10.0, 1000.0,
            7740, date(2026, 8, 6), datetime(2026, 8, 5, 10, 0, 0),
        )
        # Bigger price, but a day later — must be ignored for side purposes
        bought = _make_execution(
            account.id, 'SPX 2026-08-06 7700 P', 'BUY', 15.0, -1500.0,
            7700, date(2026, 8, 6), datetime(2026, 8, 6, 10, 0, 0),
        )
        t1 = _make_trade(account.id, sold, 'SHORT')
        t2 = _make_trade(account.id, bought, 'LONG')

        client = app.test_client()
        response = client.post(
            '/api/trades/combine',
            json={'trade_ids': [t1.id, t2.id]},
        )
        assert response.status_code == 200, response.data
        body = response.get_json()
        assert body['success'] is True
        assert body['data']['side'] == 'SHORT'

        db.session.expire_all()
        combined = db.session.get(Trade, body['data']['id'])
        assert combined.side == 'SHORT'


def test_assign_later_executions_do_not_change_side():
    """Adding executions to an existing trade must not flip its side."""
    with _ctx():
        db.create_all()
        account = _seed_account()
        sold = _make_execution(
            account.id, 'SPX 2026-08-06 7740 P', 'SELL', 10.0, 1000.0,
            7740, date(2026, 8, 6), datetime(2026, 8, 5, 10, 0, 0),
        )
        # Bigger price on a later date — must be ignored for side purposes
        bought = _make_execution(
            account.id, 'SPX 2026-08-06 7700 P', 'BUY', 15.0, -1500.0,
            7700, date(2026, 8, 6), datetime(2026, 8, 6, 10, 0, 0),
        )
        trade = _make_trade(account.id, sold, 'SHORT')

        client = app.test_client()
        response = client.post(
            f'/api/trades/{trade.id}/assign',
            json={'execution_ids': [bought.id]},
        )
        assert response.status_code == 200, response.data
        body = response.get_json()
        assert body['success'] is True
        assert body['data']['side'] == 'SHORT'

        db.session.expire_all()
        updated = db.session.get(Trade, trade.id)
        assert updated.side == 'SHORT'
