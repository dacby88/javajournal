#!/usr/bin/env python3
"""Trade mutations refresh only affected daily stats and preserve consistency."""

import json
import os
import sys
from datetime import date, datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ['DATABASE_URL'] = 'sqlite:///:memory:'

import app as app_module
from app import app, db
from models import Account, DailyStats, Execution, HourlyStats, OverallStats, Trade
from stats_calculator import get_daily_stats_scope, recalculate_daily_stats_for_changes


def _reset_db():
    db.drop_all()
    db.create_all()


def _account(name):
    account = Account(name=name)
    db.session.add(account)
    db.session.commit()
    return account


def _execution(account_id, symbol, side, exec_dt, net_cash, commission=0):
    execution = Execution(
        account_id=account_id,
        symbol=symbol,
        underlying_symbol=symbol,
        asset_class='STK',
        side=side,
        quantity=1,
        price=100,
        net_cash=net_cash,
        commission=commission,
        trade_date=exec_dt.date(),
        exec_datetime=exec_dt,
        is_open=side == 'BUY',
    )
    db.session.add(execution)
    db.session.commit()
    return execution


def _open_trade(account_id, symbol='AAPL', entry_dt=datetime(2026, 3, 2, 10, 0, 0)):
    buy = _execution(account_id, symbol, 'BUY', entry_dt, -100, commission=1)
    trade = Trade(
        account_id=account_id,
        symbol=symbol,
        description=symbol,
        underlying_symbol=symbol,
        asset_class='STK',
        entry_date=entry_dt.date(),
        entry_price=100,
        quantity=1,
        side='LONG',
        gross_pnl=0,
        total_commissions=0,
        net_pnl=0,
        entry_execution_ids=json.dumps([buy.id]),
        exit_execution_ids='[]',
        is_open=True,
        open_qty=1,
    )
    db.session.add(trade)
    db.session.flush()
    buy.matched_trade_id = trade.id
    db.session.commit()
    return trade


def _closed_trade(account_id, symbol, entry_dt, exit_dt, entry_cash, exit_cash):
    buy = _execution(account_id, symbol, 'BUY', entry_dt, entry_cash)
    sell = _execution(account_id, symbol, 'SELL', exit_dt, exit_cash)
    net_pnl = entry_cash + exit_cash
    trade = Trade(
        account_id=account_id,
        symbol=symbol,
        description=symbol,
        underlying_symbol=symbol,
        asset_class='STK',
        entry_date=entry_dt.date(),
        exit_date=exit_dt.date(),
        entry_price=100,
        exit_price=100,
        quantity=1,
        side='LONG',
        gross_pnl=net_pnl,
        total_commissions=0,
        net_pnl=net_pnl,
        entry_execution_ids=json.dumps([buy.id]),
        exit_execution_ids=json.dumps([sell.id]),
        is_open=False,
        open_qty=0,
    )
    db.session.add(trade)
    db.session.flush()
    buy.matched_trade_id = trade.id
    sell.matched_trade_id = trade.id
    db.session.commit()
    return trade


def test_assignment_refreshes_old_and_new_dates_only_and_overall_is_live():
    with app.app_context():
        _reset_db()
        account = _account('Account A')
        other_account = _account('Account B')
        trade = _open_trade(account.id)
        sell = _execution(
            account.id,
            'AAPL',
            'SELL',
            datetime(2026, 3, 3, 15, 0, 0),
            105,
            commission=1,
        )
        other_stat = DailyStats(
            date=date(2026, 3, 2),
            account_id=other_account.id,
            net_pnl=99999,
            total_trades=7,
        )
        db.session.add_all([
            DailyStats(date=date(2026, 3, 2), account_id=account.id, net_pnl=111),
            other_stat,
            HourlyStats(hour=3, total_trades=4, net_pnl=12345),
            OverallStats(total_trades=50, net_pnl=88888),
        ])
        db.session.commit()
        other_stat_id = other_stat.id

        response = app.test_client().post(
            f'/api/trades/{trade.id}/assign',
            json={'execution_ids': [sell.id]},
        )

        assert response.status_code == 200, response.data
        assert response.get_json()['success'] is True
        db.session.expire_all()
        assert DailyStats.query.filter_by(
            date=date(2026, 3, 2), account_id=account.id,
        ).first() is None
        rebuilt = DailyStats.query.filter_by(
            date=date(2026, 3, 3), account_id=account.id,
        ).one()
        assert rebuilt.total_trades == 1
        assert rebuilt.winning_trades == 1
        assert float(rebuilt.net_pnl) == 5
        assert float(rebuilt.gross_pnl) == 7
        assert float(rebuilt.total_commission) == 2
        assert float(rebuilt.avg_trade_pnl) == 5

        untouched = db.session.get(DailyStats, other_stat_id)
        assert float(untouched.net_pnl) == 99999
        assert untouched.total_trades == 7
        assert float(HourlyStats.query.filter_by(hour=3).one().net_pnl) == 12345

        overall_response = app.test_client().get('/api/stats/overall')
        assert overall_response.status_code == 200
        overall = overall_response.get_json()['data']
        assert overall['total_trades'] == 1
        assert overall['net_pnl'] == 5


def test_combine_removes_stale_date_and_counts_open_trade_on_result_date():
    with app.app_context():
        _reset_db()
        account = _account('Account A')
        first = _closed_trade(
            account.id,
            'AAPL',
            datetime(2026, 3, 2, 10, 0, 0),
            datetime(2026, 3, 3, 10, 0, 0),
            -100,
            110,
        )
        second = _closed_trade(
            account.id,
            'MSFT',
            datetime(2026, 3, 3, 12, 0, 0),
            datetime(2026, 3, 4, 10, 0, 0),
            -100,
            97,
        )
        open_trade = Trade(
            account_id=account.id,
            symbol='NVDA',
            description='NVDA',
            entry_date=date(2026, 3, 4),
            entry_price=100,
            quantity=1,
            side='LONG',
            entry_execution_ids='[]',
            exit_execution_ids='[]',
            is_open=True,
            open_qty=1,
        )
        db.session.add_all([
            open_trade,
            DailyStats(date=date(2026, 3, 3), account_id=account.id, net_pnl=999),
            DailyStats(date=date(2026, 3, 4), account_id=account.id, total_trades=99),
        ])
        db.session.commit()

        response = app.test_client().post(
            '/api/trades/combine',
            json={'trade_ids': [first.id, second.id]},
        )

        assert response.status_code == 200, response.data
        assert response.get_json()['success'] is True
        db.session.expire_all()
        assert DailyStats.query.filter_by(
            date=date(2026, 3, 3), account_id=account.id,
        ).first() is None
        rebuilt = DailyStats.query.filter_by(
            date=date(2026, 3, 4), account_id=account.id,
        ).one()
        assert rebuilt.total_trades == 2
        assert rebuilt.winning_trades == 1
        assert rebuilt.losing_trades == 0
        assert float(rebuilt.net_pnl) == 7


def test_combining_executions_creates_open_daily_stat_without_touching_hourly():
    with app.app_context():
        _reset_db()
        account = _account('Account A')
        execution = _execution(
            account.id,
            'AAPL',
            'BUY',
            datetime(2026, 3, 2, 10, 0, 0),
            -100,
        )
        db.session.add(HourlyStats(hour=3, total_trades=4, net_pnl=12345))
        db.session.commit()

        response = app.test_client().post(
            '/api/executions/combine',
            json={'execution_ids': [execution.id]},
        )

        assert response.status_code == 200, response.data
        db.session.expire_all()
        stat = DailyStats.query.filter_by(
            date=date(2026, 3, 2), account_id=account.id,
        ).one()
        assert stat.total_trades == 1
        assert float(stat.net_pnl) == 0
        assert float(HourlyStats.query.filter_by(hour=3).one().net_pnl) == 12345


def test_stats_failure_rolls_back_assignment_and_existing_daily_stats(monkeypatch):
    with app.app_context():
        _reset_db()
        account = _account('Account A')
        trade = _open_trade(account.id)
        sell = _execution(
            account.id,
            'AAPL',
            'SELL',
            datetime(2026, 3, 3, 15, 0, 0),
            105,
        )
        original_stat = DailyStats(
            date=date(2026, 3, 2),
            account_id=account.id,
            total_trades=1,
            net_pnl=111,
        )
        db.session.add(original_stat)
        db.session.commit()
        original_stat_id = original_stat.id

        def fail_recalculation(before_scope, after_scope):
            raise RuntimeError('forced stats failure')

        monkeypatch.setattr(
            app_module,
            'recalculate_daily_stats_for_changes',
            fail_recalculation,
        )
        response = app.test_client().post(
            f'/api/trades/{trade.id}/assign',
            json={'execution_ids': [sell.id]},
        )

        assert response.status_code == 500
        db.session.expire_all()
        assert db.session.get(Trade, trade.id).is_open is True
        assert db.session.get(Execution, sell.id).matched_trade_id is None
        preserved = db.session.get(DailyStats, original_stat_id)
        assert float(preserved.net_pnl) == 111
        assert DailyStats.query.filter_by(
            date=date(2026, 3, 3), account_id=account.id,
        ).first() is None


def test_targeted_daily_stats_keep_null_account_separate():
    with app.app_context():
        _reset_db()
        account = _account('Account A')
        legacy = _closed_trade(
            None,
            'AAPL',
            datetime(2026, 3, 2, 10, 0, 0),
            datetime(2026, 3, 3, 10, 0, 0),
            -100,
            105,
        )
        _closed_trade(
            account.id,
            'MSFT',
            datetime(2026, 3, 2, 10, 0, 0),
            datetime(2026, 3, 3, 10, 0, 0),
            -100,
            150,
        )

        recalculate_daily_stats_for_changes(set(), get_daily_stats_scope([legacy]))
        db.session.commit()

        legacy_stat = DailyStats.query.filter_by(
            date=date(2026, 3, 3), account_id=None,
        ).one()
        assert legacy_stat.total_trades == 1
        assert float(legacy_stat.net_pnl) == 5
        assert DailyStats.query.filter_by(
            date=date(2026, 3, 3), account_id=account.id,
        ).first() is None
