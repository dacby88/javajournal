#!/usr/bin/env python3
"""Regression test for multi-symbol open-trade close bug.

Scenario: an existing open spread trade has two legs.  Importing a closing
execution for only ONE leg must NOT mark the whole trade as closed.
The trade should only close once every leg is flat.
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


def _norm_qty(side, qty):
    if side == 'SELL' and qty > 0:
        return -qty
    if side == 'BUY' and qty < 0:
        return abs(qty)
    return qty


def _build_open_spread_trade(app):
    with app.app_context():
        account = Account(name='Test Account')
        db.session.add(account)
        db.session.commit()

        entry1 = Execution(
            account_id=account.id,
            symbol='A 2026-01-01 100 C',
            underlying_symbol='A',
            asset_class='OPT',
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
            account_id=account.id,
            symbol='A 2026-01-01 110 C',
            underlying_symbol='A',
            asset_class='OPT',
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

        trade = Trade(
            account_id=account.id,
            symbol='A 2026-01-01 100 C / 110 C',
            underlying_symbol='A',
            asset_class='OPT',
            entry_date=date(2026, 1, 1),
            entry_price=3.0,
            quantity=1,
            side='LONG',
            entry_execution_ids=json.dumps([entry1.id, entry2.id]),
            exit_execution_ids=json.dumps([]),
            is_open=True,
            open_qty=1,
        )
        db.session.add(trade)
        db.session.commit()

        entry1.matched_trade_id = trade.id
        entry2.matched_trade_id = trade.id
        db.session.commit()

        return account.id, trade.id, entry1.id, entry2.id


def _add_execution(account_id, symbol, side, qty, price, net_cash, exec_dt):
    ex = Execution(
        account_id=account_id,
        symbol=symbol,
        underlying_symbol='A',
        asset_class='OPT',
        side=side,
        quantity=qty,
        price=price,
        net_cash=net_cash,
        commission=1.0,
        trade_date=exec_dt.date(),
        exec_datetime=exec_dt,
        matched_trade_id=None,
        is_open=None,
    )
    db.session.add(ex)
    db.session.commit()
    return ex.id


def test_closing_one_leg_keeps_trade_open():
    app = _make_app()
    account_id, trade_id, entry1_id, entry2_id = _build_open_spread_trade(app)

    with app.app_context():
        # Close only the long 100C leg
        exit1_id = _add_execution(
            account_id,
            'A 2026-01-01 100 C',
            'SELL', 1, 6.0, 600.0,
            datetime(2026, 1, 2, 10, 0, 0),
        )

        result = process_executions_into_trades(account_id)
        assert result['success'], result.get('errors')

        trade = Trade.query.get(trade_id)
        assert trade.is_open is True, (
            f"Trade should still be open after closing only one leg, "
            f"got is_open={trade.is_open}, open_qty={trade.open_qty}"
        )
        assert abs(float(trade.open_qty or 0) - 1.0) < 0.0001, (
            f"open_qty should remain 1, got {trade.open_qty}"
        )

        exit1 = Execution.query.get(exit1_id)
        assert exit1.matched_trade_id == trade_id, (
            f"Closing execution should be linked to original trade, got {exit1.matched_trade_id}"
        )
        assert exit1.is_open is False, (
            f"Closing execution should be classified as exit, got is_open={exit1.is_open}"
        )

        # The 110C entry should still be an entry
        entry2 = Execution.query.get(entry2_id)
        assert entry2.is_open is True, (
            f"Unclosed leg should remain an entry, got is_open={entry2.is_open}"
        )


def test_closing_second_leg_closes_trade():
    app = _make_app()
    account_id, trade_id, entry1_id, entry2_id = _build_open_spread_trade(app)

    with app.app_context():
        # Close both legs
        exit1_id = _add_execution(
            account_id,
            'A 2026-01-01 100 C',
            'SELL', 1, 6.0, 600.0,
            datetime(2026, 1, 2, 10, 0, 0),
        )
        exit2_id = _add_execution(
            account_id,
            'A 2026-01-01 110 C',
            'BUY', 1, 1.5, -150.0,
            datetime(2026, 1, 2, 10, 0, 1),
        )

        result = process_executions_into_trades(account_id)
        assert result['success'], result.get('errors')

        trade = Trade.query.get(trade_id)
        assert trade.is_open is False, (
            f"Trade should be closed after both legs are flat, got is_open={trade.is_open}"
        )
        assert abs(float(trade.open_qty or 0)) < 0.0001, (
            f"open_qty should be 0, got {trade.open_qty}"
        )

        exit_ids = json.loads(trade.exit_execution_ids or '[]')
        assert exit1_id in exit_ids, f"First leg exit missing from exit_execution_ids: {exit_ids}"
        assert exit2_id in exit_ids, f"Second leg exit missing from exit_execution_ids: {exit_ids}"


def _build_account(app):
    with app.app_context():
        account = Account(name='Test Account')
        db.session.add(account)
        db.session.commit()
        return account.id


def _add_unmatched_execution(account_id, symbol, side, qty, price, net_cash, exec_dt):
    """Add an execution with matched_trade_id=None, simulating a fresh import row."""
    ex = Execution(
        account_id=account_id,
        symbol=symbol,
        underlying_symbol='A',
        asset_class='STK',
        side=side,
        quantity=qty,
        price=price,
        net_cash=net_cash,
        commission=1.0,
        trade_date=exec_dt.date(),
        exec_datetime=exec_dt,
        matched_trade_id=None,
        is_open=None,
    )
    db.session.add(ex)
    db.session.commit()
    return ex.id


def test_single_symbol_open_and_close():
    app = _make_app()
    with app.app_context():
        account_id = _build_account(app)

        e1 = _add_unmatched_execution(account_id, 'A', 'BUY', 10, 100.0, -1000.0,
                                      datetime(2026, 1, 1, 10, 0, 0))
        e2 = _add_unmatched_execution(account_id, 'A', 'SELL', 10, 110.0, 1100.0,
                                      datetime(2026, 1, 2, 10, 0, 0))

        result = process_executions_into_trades(account_id)
        assert result['success'], result.get('errors')
        assert result['trades_created'] == 1, result

        trades = Trade.query.filter_by(account_id=account_id).all()
        assert len(trades) == 1, f"Expected 1 trade, got {len(trades)}"
        trade = trades[0]
        assert trade.is_open is False, f"Expected closed trade, got is_open={trade.is_open}"
        assert abs(float(trade.open_qty or 0)) < 0.0001, f"open_qty should be 0, got {trade.open_qty}"

        exit_ids = json.loads(trade.exit_execution_ids or '[]')
        entry_ids = json.loads(trade.entry_execution_ids or '[]')
        assert e1 in entry_ids, f"Entry missing: {entry_ids}"
        assert e2 in exit_ids, f"Exit missing: {exit_ids}"


def test_single_symbol_round_trip_in_one_import():
    app = _make_app()
    with app.app_context():
        account_id = _build_account(app)

        e1 = _add_unmatched_execution(account_id, 'A', 'BUY', 10, 100.0, -1000.0,
                                      datetime(2026, 1, 1, 10, 0, 0))
        e2 = _add_unmatched_execution(account_id, 'A', 'SELL', 10, 110.0, 1100.0,
                                      datetime(2026, 1, 2, 10, 0, 0))
        e3 = _add_unmatched_execution(account_id, 'A', 'BUY', 5, 105.0, -525.0,
                                      datetime(2026, 1, 3, 10, 0, 0))

        result = process_executions_into_trades(account_id)
        assert result['success'], result.get('errors')
        assert result['trades_created'] == 2, result

        trades = Trade.query.filter_by(account_id=account_id).order_by(Trade.id).all()
        assert len(trades) == 2, f"Expected 2 trades, got {len(trades)}"

        closed_trade = trades[0]
        open_trade = trades[1]

        assert closed_trade.is_open is False, f"First trade should be closed, got {closed_trade.is_open}"
        assert open_trade.is_open is True, f"Second trade should be open, got {open_trade.is_open}"
        assert abs(float(open_trade.open_qty or 0) - 5.0) < 0.0001, f"Expected open_qty 5, got {open_trade.open_qty}"

        closed_entry_ids = json.loads(closed_trade.entry_execution_ids or '[]')
        open_entry_ids = json.loads(open_trade.entry_execution_ids or '[]')
        assert e1 in closed_entry_ids, f"First entry in wrong trade: {closed_entry_ids}"
        assert e3 in open_entry_ids, f"Second entry in wrong trade: {open_entry_ids}"


def test_adding_to_single_symbol_position():
    """Same-direction buys at different times are separate trades, even within
    one import - the second buy must not scale into the first trade."""
    app = _make_app()
    with app.app_context():
        account_id = _build_account(app)

        e1 = _add_unmatched_execution(account_id, 'A', 'BUY', 5, 100.0, -500.0,
                                      datetime(2026, 1, 1, 10, 0, 0))
        e2 = _add_unmatched_execution(account_id, 'A', 'BUY', 5, 101.0, -505.0,
                                      datetime(2026, 1, 1, 10, 5, 0))

        result = process_executions_into_trades(account_id)
        assert result['success'], result.get('errors')
        assert result['trades_created'] == 2, result

        trades = Trade.query.filter_by(account_id=account_id).order_by(Trade.id).all()
        assert len(trades) == 2, f"Expected 2 trades, got {len(trades)}"

        first, second = trades
        assert first.is_open is True and second.is_open is True
        assert abs(float(first.open_qty or 0) - 5.0) < 0.0001, f"Expected open_qty 5, got {first.open_qty}"
        assert abs(float(second.open_qty or 0) - 5.0) < 0.0001, f"Expected open_qty 5, got {second.open_qty}"

        first_entry_ids = json.loads(first.entry_execution_ids or '[]')
        second_entry_ids = json.loads(second.entry_execution_ids or '[]')
        assert first_entry_ids == [e1], f"First trade entries: {first_entry_ids}"
        assert second_entry_ids == [e2], f"Second trade entries: {second_entry_ids}"


def test_single_symbol_short_open_and_close():
    app = _make_app()
    with app.app_context():
        account_id = _build_account(app)

        e1 = _add_unmatched_execution(account_id, 'A', 'SELL', 10, 110.0, 1100.0,
                                      datetime(2026, 1, 1, 10, 0, 0))
        e2 = _add_unmatched_execution(account_id, 'A', 'BUY', 10, 100.0, -1000.0,
                                      datetime(2026, 1, 2, 10, 0, 0))

        result = process_executions_into_trades(account_id)
        assert result['success'], result.get('errors')
        assert result['trades_created'] == 1, result

        trades = Trade.query.filter_by(account_id=account_id).all()
        assert len(trades) == 1, f"Expected 1 trade, got {len(trades)}"
        trade = trades[0]
        assert trade.is_open is False, f"Expected closed short trade, got is_open={trade.is_open}"
        assert trade.side == 'SHORT', f"Expected SHORT side, got {trade.side}"
        assert abs(float(trade.net_pnl or 0) - 100.0) < 0.0001, f"Expected net_pnl ~100, got {trade.net_pnl}"


def test_existing_single_symbol_open_trade_closed_by_import():
    app = _make_app()
    with app.app_context():
        account_id = _build_account(app)

        entry = Execution(
            account_id=account_id,
            symbol='A',
            underlying_symbol='A',
            asset_class='STK',
            side='BUY',
            quantity=10,
            price=100.0,
            net_cash=-1000.0,
            commission=1.0,
            trade_date=date(2026, 1, 1),
            exec_datetime=datetime(2026, 1, 1, 10, 0, 0),
            is_open=True,
        )
        db.session.add(entry)
        db.session.commit()

        trade = Trade(
            account_id=account_id,
            symbol='A',
            entry_date=date(2026, 1, 1),
            entry_price=100.0,
            quantity=10,
            side='LONG',
            entry_execution_ids=json.dumps([entry.id]),
            exit_execution_ids=json.dumps([]),
            is_open=True,
            open_qty=10,
        )
        db.session.add(trade)
        db.session.commit()
        entry.matched_trade_id = trade.id
        db.session.commit()

        exit_id = _add_unmatched_execution(account_id, 'A', 'SELL', 10, 110.0, 1100.0,
                                           datetime(2026, 1, 2, 10, 0, 0))

        result = process_executions_into_trades(account_id)
        assert result['success'], result.get('errors')
        assert result['trades_updated'] == 1, result

        trade = Trade.query.get(trade.id)
        assert trade.is_open is False, f"Expected closed trade, got {trade.is_open}"
        assert abs(float(trade.open_qty or 0)) < 0.0001, f"open_qty should be 0, got {trade.open_qty}"

        exit_ids = json.loads(trade.exit_execution_ids or '[]')
        assert exit_id in exit_ids, f"Exit missing: {exit_ids}"


if __name__ == '__main__':
    test_closing_one_leg_keeps_trade_open()
    print("PASS: closing one leg keeps trade open")

    test_closing_second_leg_closes_trade()
    print("PASS: closing both legs closes trade")

    test_single_symbol_open_and_close()
    print("PASS: single-symbol open and close")

    test_single_symbol_short_open_and_close()
    print("PASS: single-symbol short open and close")

    test_single_symbol_round_trip_in_one_import()
    print("PASS: single-symbol round trip in one import")

    test_adding_to_single_symbol_position()
    print("PASS: adding to single-symbol position")

    test_existing_single_symbol_open_trade_closed_by_import()
    print("PASS: existing single-symbol open trade closed by import")


def test_fifo_close_splits_execution_across_two_trades():
    """A sell covering two separate buy trades is split FIFO: oldest trade
    closes first, and the execution row is split so each trade gets its share."""
    app = _make_app()
    with app.app_context():
        account_id = _build_account(app)

        e1 = _add_unmatched_execution(account_id, 'A', 'BUY', 5, 100.0, -500.0,
                                      datetime(2026, 1, 1, 10, 0, 0))
        e2 = _add_unmatched_execution(account_id, 'A', 'BUY', 5, 101.0, -505.0,
                                      datetime(2026, 1, 1, 10, 5, 0))
        e3 = _add_unmatched_execution(account_id, 'A', 'SELL', 10, 110.0, 1100.0,
                                      datetime(2026, 1, 1, 11, 0, 0))

        result = process_executions_into_trades(account_id)
        assert result['success'], result.get('errors')
        assert result['trades_created'] == 2, result

        trades = Trade.query.filter_by(account_id=account_id).order_by(Trade.id).all()
        assert len(trades) == 2, f"Expected 2 trades, got {len(trades)}"
        first, second = trades
        assert first.is_open is False, "First trade should be closed"
        assert second.is_open is False, "Second trade should be closed"

        # The sell row was split into two -5 portions matched to their trades
        first_exits = json.loads(first.exit_execution_ids or '[]')
        second_exits = json.loads(second.exit_execution_ids or '[]')
        assert len(first_exits) == 1 and len(second_exits) == 1
        assert first_exits[0] != second_exits[0]

        p1 = Execution.query.get(first_exits[0])
        p2 = Execution.query.get(second_exits[0])
        assert float(p1.quantity) == -5.0 and float(p2.quantity) == -5.0
        # Money sums preserved across the split
        assert abs(float(p1.net_cash) + float(p2.net_cash) - 1100.0) < 0.0001
        assert abs(float(p1.commission) + float(p2.commission) - 1.0) < 0.0001
        assert p1.matched_trade_id == first.id and p2.matched_trade_id == second.id

        # FIFO: the 10:00 buy's trade realizes its own P&L, the 10:05 buy's its own
        assert abs(float(first.net_pnl or 0) - (-500.0 + float(p1.net_cash))) < 0.0001, first.net_pnl
        assert abs(float(second.net_pnl or 0) - (-505.0 + float(p2.net_cash))) < 0.0001, second.net_pnl

        # No execution left unmatched
        assert Execution.query.filter_by(matched_trade_id=None).count() == 0


def test_fifo_partial_close_leaves_remainder_open():
    """A sell covering the first trade plus part of the second closes the
    first and leaves the second open with the remaining quantity."""
    app = _make_app()
    with app.app_context():
        account_id = _build_account(app)

        _add_unmatched_execution(account_id, 'A', 'BUY', 5, 100.0, -500.0,
                                 datetime(2026, 1, 1, 10, 0, 0))
        _add_unmatched_execution(account_id, 'A', 'BUY', 5, 101.0, -505.0,
                                 datetime(2026, 1, 1, 10, 5, 0))
        _add_unmatched_execution(account_id, 'A', 'SELL', 7, 110.0, 770.0,
                                 datetime(2026, 1, 1, 11, 0, 0))

        result = process_executions_into_trades(account_id)
        assert result['success'], result.get('errors')
        assert result['trades_created'] == 2, result

        trades = Trade.query.filter_by(account_id=account_id).order_by(Trade.id).all()
        first, second = trades
        assert first.is_open is False, "Oldest trade should be closed (FIFO)"
        assert second.is_open is True, "Newer trade should still be open"
        assert abs(float(second.open_qty or 0) - 3.0) < 0.0001, second.open_qty


def test_reversal_leftover_opens_new_opposite_trade():
    """A sell larger than the open long position closes it and opens a new
    short trade with the leftover quantity."""
    app = _make_app()
    with app.app_context():
        account_id = _build_account(app)

        _add_unmatched_execution(account_id, 'A', 'BUY', 10, 100.0, -1000.0,
                                 datetime(2026, 1, 1, 10, 0, 0))
        _add_unmatched_execution(account_id, 'A', 'SELL', 15, 110.0, 1650.0,
                                 datetime(2026, 1, 1, 11, 0, 0))

        result = process_executions_into_trades(account_id)
        assert result['success'], result.get('errors')
        assert result['trades_created'] == 2, result

        trades = Trade.query.filter_by(account_id=account_id).order_by(Trade.id).all()
        long_trade, short_trade = trades
        assert long_trade.is_open is False, "Long trade should be closed"
        assert abs(float(long_trade.net_pnl or 0) - 100.0) < 0.0001, long_trade.net_pnl

        assert short_trade.is_open is True, "Leftover should be an open short trade"
        assert short_trade.side == 'SHORT', f"Expected SHORT, got {short_trade.side}"
        assert abs(float(short_trade.open_qty or 0) - 5.0) < 0.0001, short_trade.open_qty
