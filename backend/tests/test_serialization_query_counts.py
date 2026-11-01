#!/usr/bin/env python3
"""Collection endpoints and stats must not issue queries per serialized row."""

import json
import os
import sys
from contextlib import contextmanager
from datetime import date, datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ['DATABASE_URL'] = 'sqlite:///:memory:'

from sqlalchemy import event

from app import app, db
from models import Account, Execution, Tag, Trade
from stats_calculator import calculate_overall_stats


@contextmanager
def _select_statements():
    statements = []

    def capture(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith('SELECT'):
            statements.append(statement)

    event.listen(db.engine, 'before_cursor_execute', capture)
    try:
        yield statements
    finally:
        event.remove(db.engine, 'before_cursor_execute', capture)


def _seed_trades(count=6):
    account = Account(name='Test Account')
    db.session.add(account)
    db.session.flush()
    base_date = date(2026, 3, 2)
    for index in range(count):
        entry_date = base_date + timedelta(days=index * 2)
        exit_date = entry_date + timedelta(days=1)
        trade = Trade(
            account_id=account.id,
            symbol=f'SYMBOL{index}',
            description=f'SYMBOL{index}',
            underlying_symbol=f'SYMBOL{index}',
            asset_class='STK',
            entry_date=entry_date,
            exit_date=exit_date,
            entry_price=100,
            exit_price=105,
            quantity=1,
            side='LONG',
            gross_pnl=5,
            total_commissions=0,
            net_pnl=5,
            is_open=False,
            open_qty=0,
        )
        trade.tags_list.append(Tag(name=f'Tag {index}', color='#000000'))
        db.session.add(trade)
        db.session.flush()
        buy = Execution(
            account_id=account.id,
            symbol=trade.symbol,
            underlying_symbol=trade.symbol,
            asset_class='STK',
            side='BUY',
            quantity=1,
            price=100,
            net_cash=-100,
            commission=0,
            trade_date=entry_date,
            exec_datetime=datetime.combine(entry_date, datetime.min.time()).replace(hour=10),
            matched_trade_id=trade.id,
            is_open=True,
        )
        sell = Execution(
            account_id=account.id,
            symbol=trade.symbol,
            underlying_symbol=trade.symbol,
            asset_class='STK',
            side='SELL',
            quantity=1,
            price=105,
            net_cash=105,
            commission=0,
            trade_date=exit_date,
            exec_datetime=datetime.combine(exit_date, datetime.min.time()).replace(hour=15),
            matched_trade_id=trade.id,
            is_open=False,
        )
        db.session.add_all([buy, sell])
        db.session.flush()
        trade.entry_execution_ids = json.dumps([buy.id])
        trade.exit_execution_ids = json.dumps([sell.id])
    db.session.commit()
    db.session.expunge_all()


def test_trade_list_uses_constant_queries_and_preserves_execution_details():
    with app.app_context():
        db.drop_all()
        db.create_all()
        _seed_trades()

        with _select_statements() as statements:
            response = app.test_client().get(
                '/api/trades?limit=50&sort_by=id&sort_order=asc',
            )

        assert response.status_code == 200, response.data
        rows = response.get_json()['data']
        assert len(rows) == 6
        assert len(statements) <= 6
        first = rows[0]
        assert first['entry_time'] == '2026-03-02T10:00:00'
        assert first['exit_time'] == '2026-03-03T15:00:00'
        assert first['net_cash'] == 5
        assert first['account_name'] == 'Test Account'
        assert [tag['name'] for tag in first['tags']] == ['Tag 0']


def test_execution_list_eager_loads_accounts():
    with app.app_context():
        db.drop_all()
        db.create_all()
        _seed_trades()

        with _select_statements() as statements:
            response = app.test_client().get('/api/executions?limit=50')

        assert response.status_code == 200, response.data
        rows = response.get_json()['data']
        assert len(rows) == 12
        assert len(statements) <= 4
        assert {row['account_name'] for row in rows} == {'Test Account'}


def test_overall_stats_does_not_serialize_related_rows_per_trade():
    with app.app_context():
        db.drop_all()
        db.create_all()
        _seed_trades()

        with _select_statements() as statements:
            result = calculate_overall_stats()

        assert result['total_trades'] == 6
        assert result['net_pnl'] == 30
        assert len(statements) <= 3
