#!/usr/bin/env python3
"""Open trades on GET /api/trades include live mark-to-market P&L."""

import os
import sys
from datetime import date, datetime
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ['DATABASE_URL'] = 'sqlite:///:memory:'

from app import app, db
from models import Account, Execution, Trade


def _ctx():
    return app.app_context()


def _seed():
    account = Account(name='Test Account')
    db.session.add(account)
    db.session.commit()

    open_trade = Trade(
        account_id=account.id,
        symbol='SPX 2026-08-06 7740 P',
        description='SPX 7740/7730 Put Spread + QQQ 500C',
        entry_date=date(2026, 8, 5),
        entry_price=10.0,
        quantity=1,
        side='SHORT',
        net_pnl=0,
        is_open=True,
        open_qty=1,
        entry_execution_ids='[]',
        exit_execution_ids='[]',
    )
    closed_trade = Trade(
        account_id=account.id,
        symbol='AAPL',
        description='AAPL',
        entry_date=date(2026, 8, 1),
        exit_date=date(2026, 8, 2),
        entry_price=100.0,
        exit_price=110.0,
        quantity=1,
        side='LONG',
        net_pnl=123.45,
        is_open=False,
        open_qty=0,
        entry_execution_ids='[]',
        exit_execution_ids='[]',
    )
    db.session.add_all([open_trade, closed_trade])
    db.session.commit()

    execution = Execution(
        account_id=account.id,
        symbol=open_trade.symbol,
        underlying_symbol='SPX',
        asset_class='OPT',
        strike=7740,
        expiry=date(2026, 8, 6),
        put_call='P',
        side='SELL',
        quantity=1,
        price=10.0,
        net_cash=1000.0,
        trade_date=date(2026, 8, 5),
        exec_datetime=datetime(2026, 8, 5, 10, 0, 0),
        is_open=True,
        matched_trade_id=open_trade.id,
    )
    db.session.add(execution)
    db.session.commit()
    return open_trade, closed_trade


def test_get_trades_includes_open_pnl_for_open_trades():
    with _ctx():
        db.create_all()
        open_trade, closed_trade = _seed()

        class FakeQuotes:
            def mark_trade(self, executions):
                assert executions, 'open trade should pass executions to mark_trade'
                return {'open_pnl': -200.5, 'open_positions': []}

        with patch('app.get_quote_service', return_value=FakeQuotes()):
            response = app.test_client().get('/api/trades')

        assert response.status_code == 200, response.data
        body = response.get_json()
        assert body['success'] is True
        by_id = {row['id']: row for row in body['data']}
        assert by_id[open_trade.id]['open_pnl'] == -200.5
        assert by_id[open_trade.id]['net_pnl'] == 0
        assert 'open_pnl' not in by_id[closed_trade.id] or by_id[closed_trade.id].get('open_pnl') is None
        assert by_id[closed_trade.id]['net_pnl'] == 123.45
