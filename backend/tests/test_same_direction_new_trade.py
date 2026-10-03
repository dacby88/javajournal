#!/usr/bin/env python3
"""Tests for same-direction resume behavior in process_executions_into_trades.

Rule: when an existing open trade contains the symbol, a same-direction
execution at a different execution time must start a NEW trade instead of
scaling into the existing one. Only opposite-direction (closing) executions -
or same-direction fills sharing an entry timestamp (partial fills split
across imports) - are appended to the existing trade.
"""

import os
import sys
import json
from datetime import date, datetime

# Make imports work when running from tests/ directory
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from flask import Flask
from models import db, Execution, Trade, Account
from csv_processor import process_executions_into_trades


def _make_app():
    app = Flask(__name__)
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    db.init_app(app)
    with app.app_context():
        db.create_all()
    return app


def _build_open_trade(app, side='BUY', qty=10, price=100.0, exec_dt=datetime(2026, 1, 1, 10, 0, 0)):
    """Create an account with a single-execution open trade; return (account_id, trade_id, entry_id)."""
    with app.app_context():
        account = Account(name='Test Account')
        db.session.add(account)
        db.session.commit()

        net_cash = -qty * price if side == 'BUY' else qty * price
        entry = Execution(
            account_id=account.id,
            symbol='A',
            underlying_symbol='A',
            asset_class='STK',
            side=side,
            quantity=qty,
            price=price,
            net_cash=net_cash,
            commission=1.0,
            trade_date=exec_dt.date(),
            exec_datetime=exec_dt,
            is_open=True,
        )
        db.session.add(entry)
        db.session.commit()

        trade = Trade(
            account_id=account.id,
            symbol='A',
            entry_date=exec_dt.date(),
            entry_price=price,
            quantity=qty,
            side='LONG' if side == 'BUY' else 'SHORT',
            entry_execution_ids=json.dumps([entry.id]),
            exit_execution_ids=json.dumps([]),
            is_open=True,
            open_qty=qty,
        )
        db.session.add(trade)
        db.session.commit()

        entry.matched_trade_id = trade.id
        db.session.commit()

        return account.id, trade.id, entry.id


def _add_unmatched_execution(account_id, side, qty, price, exec_dt):
    ex = Execution(
        account_id=account_id,
        symbol='A',
        underlying_symbol='A',
        asset_class='STK',
        side=side,
        quantity=qty,
        price=price,
        net_cash=(-qty * price if side == 'BUY' else qty * price),
        commission=1.0,
        trade_date=exec_dt.date(),
        exec_datetime=exec_dt,
        matched_trade_id=None,
        is_open=None,
    )
    db.session.add(ex)
    db.session.commit()
    return ex.id


def test_same_direction_different_time_creates_new_trade():
    app = _make_app()
    account_id, trade_id, entry_id = _build_open_trade(app)

    with app.app_context():
        new_id = _add_unmatched_execution(account_id, 'BUY', 5, 105.0,
                                          datetime(2026, 1, 2, 10, 0, 0))

        result = process_executions_into_trades(account_id)
        assert result['success'], result.get('errors')
        assert result['trades_created'] == 1, result
        assert result['trades_updated'] == 0, result

        trades = Trade.query.filter_by(account_id=account_id).order_by(Trade.id).all()
        assert len(trades) == 2, f"Expected 2 trades, got {len(trades)}"

        old_trade = Trade.query.get(trade_id)
        assert old_trade.is_open is True, f"Existing trade should stay open, got {old_trade.is_open}"
        assert abs(float(old_trade.open_qty or 0) - 10.0) < 0.0001, (
            f"Existing trade open_qty should stay 10, got {old_trade.open_qty}"
        )
        old_entry_ids = json.loads(old_trade.entry_execution_ids or '[]')
        assert old_entry_ids == [entry_id], f"Existing trade entries changed: {old_entry_ids}"

        new_trade = trades[1]
        assert new_trade.is_open is True, f"New trade should be open, got {new_trade.is_open}"
        assert abs(float(new_trade.open_qty or 0) - 5.0) < 0.0001, (
            f"New trade open_qty should be 5, got {new_trade.open_qty}"
        )

        new_exec = Execution.query.get(new_id)
        assert new_exec.matched_trade_id == new_trade.id, (
            f"New execution should be linked to the new trade, got {new_exec.matched_trade_id}"
        )
        assert new_exec.is_open is True, f"New execution should be an entry, got {new_exec.is_open}"


def test_same_direction_same_timestamp_resumes_trade():
    app = _make_app()
    account_id, trade_id, entry_id = _build_open_trade(app)

    with app.app_context():
        # Partial fill split across imports: identical exec_datetime
        fill_id = _add_unmatched_execution(account_id, 'BUY', 5, 100.0,
                                           datetime(2026, 1, 1, 10, 0, 0))

        result = process_executions_into_trades(account_id)
        assert result['success'], result.get('errors')
        assert result['trades_created'] == 0, result
        assert result['trades_updated'] == 1, result

        trades = Trade.query.filter_by(account_id=account_id).all()
        assert len(trades) == 1, f"Expected 1 trade, got {len(trades)}"

        trade = Trade.query.get(trade_id)
        assert trade.is_open is True, f"Trade should stay open, got {trade.is_open}"
        assert abs(float(trade.open_qty or 0) - 15.0) < 0.0001, (
            f"open_qty should be 15 after partial fill, got {trade.open_qty}"
        )
        entry_ids = json.loads(trade.entry_execution_ids or '[]')
        assert fill_id in entry_ids, f"Partial fill missing from entries: {entry_ids}"


def test_closing_execution_different_time_resumes_trade():
    app = _make_app()
    account_id, trade_id, entry_id = _build_open_trade(app)

    with app.app_context():
        exit_id = _add_unmatched_execution(account_id, 'SELL', 10, 110.0,
                                           datetime(2026, 1, 2, 10, 0, 0))

        result = process_executions_into_trades(account_id)
        assert result['success'], result.get('errors')
        assert result['trades_created'] == 0, result
        assert result['trades_updated'] == 1, result

        trade = Trade.query.get(trade_id)
        assert trade.is_open is False, f"Trade should be closed, got {trade.is_open}"
        exit_ids = json.loads(trade.exit_execution_ids or '[]')
        assert exit_id in exit_ids, f"Exit missing: {exit_ids}"


def test_same_direction_different_time_short_creates_new_trade():
    app = _make_app()
    account_id, trade_id, entry_id = _build_open_trade(app, side='SELL', qty=10, price=110.0)

    with app.app_context():
        new_id = _add_unmatched_execution(account_id, 'SELL', 5, 112.0,
                                          datetime(2026, 1, 2, 10, 0, 0))

        result = process_executions_into_trades(account_id)
        assert result['success'], result.get('errors')
        assert result['trades_created'] == 1, result

        trades = Trade.query.filter_by(account_id=account_id).order_by(Trade.id).all()
        assert len(trades) == 2, f"Expected 2 trades, got {len(trades)}"

        old_trade = Trade.query.get(trade_id)
        assert old_trade.is_open is True, f"Existing short trade should stay open, got {old_trade.is_open}"
        assert abs(float(old_trade.open_qty or 0) - 10.0) < 0.0001, (
            f"Existing trade open_qty should stay 10, got {old_trade.open_qty}"
        )

        new_trade = trades[1]
        assert new_trade.side == 'SHORT', f"New trade should be SHORT, got {new_trade.side}"
        assert abs(float(new_trade.open_qty or 0) - 5.0) < 0.0001, (
            f"New trade open_qty should be 5, got {new_trade.open_qty}"
        )


if __name__ == '__main__':
    test_same_direction_different_time_creates_new_trade()
    print("PASS: same-direction different time creates new trade")

    test_same_direction_same_timestamp_resumes_trade()
    print("PASS: same-direction same timestamp resumes trade")

    test_closing_execution_different_time_resumes_trade()
    print("PASS: closing execution different time resumes trade")

    test_same_direction_different_time_short_creates_new_trade()
    print("PASS: same-direction different time (short) creates new trade")
