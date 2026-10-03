#!/usr/bin/env python3
"""Unlinking executions from a trade, one at a time or several at once."""

import json
import os
import sys
from datetime import date, datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ['DATABASE_URL'] = 'sqlite:///:memory:'

from app import app, db
from models import Account, Execution, Trade


def _exec(account_id, trade_id, symbol, side, net_cash, when):
    execution = Execution(
        account_id=account_id,
        symbol=symbol,
        underlying_symbol=symbol,
        asset_class='STK',
        side=side,
        quantity=1,
        price=abs(net_cash),
        net_cash=net_cash,
        commission=0,
        trade_date=when.date(),
        exec_datetime=when,
        matched_trade_id=trade_id,
        is_open=side == 'BUY',
    )
    db.session.add(execution)
    db.session.commit()
    return execution


def _trade_with_executions(legs):
    account = Account(name='Test Account')
    db.session.add(account)
    db.session.commit()

    trade = Trade(
        account_id=account.id,
        symbol='MULTI',
        description='MULTI',
        entry_date=date(2026, 3, 2),
        entry_price=10,
        quantity=1,
        side='LONG',
        net_pnl=0,
        gross_pnl=0,
        total_commissions=0,
        is_open=True,
        open_qty=1,
        entry_execution_ids='[]',
        exit_execution_ids='[]',
    )
    db.session.add(trade)
    db.session.commit()

    executions = []
    for index, (symbol, side, net_cash) in enumerate(legs):
        executions.append(_exec(
            account.id,
            trade.id,
            symbol,
            side,
            net_cash,
            datetime(2026, 3, 2, 10, index, 0),
        ))
    trade.entry_execution_ids = json.dumps([e.id for e in executions if e.side == 'BUY'])
    trade.exit_execution_ids = json.dumps([e.id for e in executions if e.side == 'SELL'])
    db.session.commit()
    return trade, executions


def _linked_ids(trade_id):
    rows = Execution.query.filter_by(matched_trade_id=trade_id).all()
    return sorted(e.id for e in rows)


def test_bulk_unassign_leaves_the_rest_and_recalculates():
    with app.app_context():
        db.drop_all()
        db.create_all()
        trade, executions = _trade_with_executions([
            ('AAA', 'BUY', -100),
            ('AAA', 'SELL', 130),
            ('BBB', 'BUY', -20),
            ('BBB', 'SELL', 25),
        ])
        keep = executions[0]
        drop_ids = [executions[2].id, executions[3].id]

        response = app.test_client().post(
            f'/api/trades/{trade.id}/unassign',
            json={'execution_ids': drop_ids},
        )

        assert response.status_code == 200, response.data
        body = response.get_json()
        assert body['success'] is True
        assert body['message'] == f'2 executions removed from trade #{trade.id} and trade recalculated'
        assert sorted(row['id'] for row in body['data']) == sorted(drop_ids)
        assert all(row['matched_trade_id'] is None for row in body['data'])

        db.session.expire_all()
        assert _linked_ids(trade.id) == [executions[0].id, executions[1].id]
        for execution_id in drop_ids:
            assert db.session.get(Execution, execution_id).matched_trade_id is None

        refreshed = db.session.get(Trade, trade.id)
        assert refreshed.is_open is False
        assert float(refreshed.net_pnl) == 30
        assert json.loads(refreshed.entry_execution_ids) == [keep.id]
        assert json.loads(refreshed.exit_execution_ids) == [executions[1].id]


def test_bulk_unassign_refuses_to_empty_the_trade():
    with app.app_context():
        db.drop_all()
        db.create_all()
        trade, executions = _trade_with_executions([
            ('AAA', 'BUY', -100),
            ('AAA', 'SELL', 130),
        ])
        ids = [e.id for e in executions]

        response = app.test_client().post(
            f'/api/trades/{trade.id}/unassign',
            json={'execution_ids': ids},
        )

        assert response.status_code == 400, response.data
        assert 'Unmatch Trade' in response.get_json()['error']
        db.session.expire_all()
        assert _linked_ids(trade.id) == sorted(ids)


def test_single_unassign_still_removes_one_execution():
    with app.app_context():
        db.drop_all()
        db.create_all()
        trade, executions = _trade_with_executions([
            ('AAA', 'BUY', -100),
            ('AAA', 'SELL', 130),
            ('BBB', 'BUY', -20),
        ])
        target = executions[2]

        response = app.test_client().post(f'/api/executions/{target.id}/unassign')

        assert response.status_code == 200, response.data
        body = response.get_json()
        assert body['success'] is True
        assert body['data']['id'] == target.id
        assert body['data']['matched_trade_id'] is None
        assert body['message'] == f'Execution removed from trade #{trade.id} and trade recalculated'

        db.session.expire_all()
        assert _linked_ids(trade.id) == [executions[0].id, executions[1].id]
        refreshed = db.session.get(Trade, trade.id)
        assert refreshed.is_open is False
        assert float(refreshed.net_pnl) == 30
        assert target.id not in json.loads(refreshed.entry_execution_ids)


def test_single_unassign_refuses_the_only_execution():
    with app.app_context():
        db.drop_all()
        db.create_all()
        trade, executions = _trade_with_executions([('AAA', 'BUY', -100)])

        response = app.test_client().post(f'/api/executions/{executions[0].id}/unassign')

        assert response.status_code == 400, response.data
        assert response.get_json()['error'] == (
            'Cannot remove the only execution from a trade. Use "Unmatch Trade" instead.'
        )
        db.session.expire_all()
        assert _linked_ids(trade.id) == [executions[0].id]


def test_bulk_unassign_rejects_an_execution_from_another_trade():
    with app.app_context():
        db.drop_all()
        db.create_all()
        trade_a, execs_a = _trade_with_executions([
            ('AAA', 'BUY', -10),
            ('BBB', 'BUY', -20),
        ])
        trade_b, execs_b = _trade_with_executions([
            ('CCC', 'BUY', -30),
            ('DDD', 'BUY', -40),
        ])

        response = app.test_client().post(
            f'/api/trades/{trade_a.id}/unassign',
            json={'execution_ids': [execs_a[1].id, execs_b[0].id]},
        )

        assert response.status_code == 400, response.data
        assert 'not assigned to this trade' in response.get_json()['error']
        db.session.expire_all()
        assert _linked_ids(trade_a.id) == sorted(e.id for e in execs_a)
        assert _linked_ids(trade_b.id) == sorted(e.id for e in execs_b)
