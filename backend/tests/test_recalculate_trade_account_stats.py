#!/usr/bin/env python3
"""Recalculating one trade's stats updates only that trade's account."""

import json
import os
import sys
from datetime import date, datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ['DATABASE_URL'] = 'sqlite:///:memory:'

from app import app, db
from models import Account, DailyStats, Execution, HourlyStats, Trade


def _round_trip(account, symbol, buy_cash, sell_cash):
    trade = Trade(
        account_id=account.id,
        symbol=symbol,
        description=symbol,
        entry_date=date(2026, 3, 2),
        exit_date=date(2026, 3, 3),
        entry_price=100,
        exit_price=110,
        quantity=1,
        side='LONG',
        net_pnl=1,
        gross_pnl=1,
        total_commissions=0,
        is_open=False,
        open_qty=0,
        entry_execution_ids='[]',
        exit_execution_ids='[]',
    )
    db.session.add(trade)
    db.session.commit()

    buy = Execution(
        account_id=account.id,
        symbol=symbol,
        underlying_symbol=symbol,
        asset_class='STK',
        side='BUY',
        quantity=1,
        price=100,
        net_cash=buy_cash,
        commission=0,
        trade_date=date(2026, 3, 2),
        exec_datetime=datetime(2026, 3, 2, 10, 0, 0),
        matched_trade_id=trade.id,
        is_open=True,
    )
    sell = Execution(
        account_id=account.id,
        symbol=symbol,
        underlying_symbol=symbol,
        asset_class='STK',
        side='SELL',
        quantity=1,
        price=110,
        net_cash=sell_cash,
        commission=0,
        trade_date=date(2026, 3, 3),
        exec_datetime=datetime(2026, 3, 3, 15, 0, 0),
        matched_trade_id=trade.id,
        is_open=False,
    )
    db.session.add_all([buy, sell])
    db.session.commit()
    trade.entry_execution_ids = json.dumps([buy.id])
    trade.exit_execution_ids = json.dumps([sell.id])
    db.session.commit()
    return trade


def test_recalculate_pnl_updates_only_the_trades_account():
    with app.app_context():
        db.drop_all()
        db.create_all()

        account_a = Account(name='Account A')
        account_b = Account(name='Account B')
        db.session.add_all([account_a, account_b])
        db.session.commit()

        trade_a = _round_trip(account_a, 'AAPL', buy_cash=-100, sell_cash=105)
        _round_trip(account_b, 'MSFT', buy_cash=-50, sell_cash=80)

        sentinel = date(2020, 1, 1)
        stat_a = DailyStats(date=sentinel, account_id=account_a.id, net_pnl=111, total_trades=3)
        stat_b = DailyStats(date=sentinel, account_id=account_b.id, net_pnl=99999, total_trades=7)
        hourly = HourlyStats(hour=3, total_trades=4, winning_trades=1, net_pnl=12345, avg_pnl=10)
        db.session.add_all([stat_a, stat_b, hourly])
        db.session.commit()
        stat_b_id = stat_b.id

        response = app.test_client().post(
            f'/api/trades/{trade_a.id}/recalculate-pnl',
            json={'recalculate_stats': True},
        )

        assert response.status_code == 200, response.data
        body = response.get_json()
        assert body['success'] is True
        assert body['message'] == f'P&L recalculated for trade #{trade_a.id}. Stats recalculated for Account A.'

        db.session.expire_all()

        other = db.session.get(DailyStats, stat_b_id)
        assert other is not None
        assert other.account_id == account_b.id
        assert float(other.net_pnl) == 99999
        assert DailyStats.query.filter_by(account_id=account_b.id).count() == 1

        assert DailyStats.query.filter_by(date=sentinel, account_id=account_a.id).first() is None
        rebuilt = DailyStats.query.filter_by(account_id=account_a.id, date=date(2026, 3, 3)).one()
        assert float(rebuilt.net_pnl) == 5

        hourly_row = HourlyStats.query.filter_by(hour=3).one()
        assert float(hourly_row.net_pnl) == 12345


def test_recalculate_pnl_without_stats_leaves_daily_stats():
    with app.app_context():
        db.drop_all()
        db.create_all()

        account = Account(name='Account A')
        db.session.add(account)
        db.session.commit()
        trade = _round_trip(account, 'AAPL', buy_cash=-100, sell_cash=105)
        stat = DailyStats(date=date(2020, 1, 1), account_id=account.id, net_pnl=111, total_trades=3)
        db.session.add(stat)
        db.session.commit()

        response = app.test_client().post(
            f'/api/trades/{trade.id}/recalculate-pnl',
            json={'recalculate_stats': False},
        )

        assert response.status_code == 200, response.data
        assert response.get_json()['message'] == f'P&L recalculated for trade #{trade.id}'
        db.session.expire_all()
        kept = DailyStats.query.filter_by(account_id=account.id).one()
        assert float(kept.net_pnl) == 111
