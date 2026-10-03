#!/usr/bin/env python3
"""Tests for advanced trade matching using execution timestamps.

When match_timestamps is enabled, executions for different symbols that share
an identical exec_datetime are matched into a single trade (spreads). A
same-timestamp group joins an existing open trade only when every execution
closes a symbol that trade already holds. Otherwise the whole group becomes
one new trade.
"""

import os
import sys
import json
from datetime import date, datetime

import pandas as pd

# Make imports work when running from tests/ directory
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from flask import Flask
from models import db, Execution, Trade, Account
from csv_processor import (
    process_executions_into_trades,
    detect_execution_timestamps,
    _raw_value_has_time,
    validate_csv,
)


def _make_app():
    app = Flask(__name__)
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    db.init_app(app)
    with app.app_context():
        db.create_all()
    return app


def _make_account():
    account = Account(name='Test Account')
    db.session.add(account)
    db.session.commit()
    return account.id


def _add_execution(account_id, symbol, side, qty, price, exec_dt, matched_trade_id=None):
    ex = Execution(
        account_id=account_id,
        symbol=symbol,
        underlying_symbol=symbol,
        asset_class='STK',
        side=side,
        quantity=qty,
        price=price,
        net_cash=(-qty * price if side == 'BUY' else qty * price),
        commission=1.0,
        trade_date=exec_dt.date(),
        exec_datetime=exec_dt,
        matched_trade_id=matched_trade_id,
        is_open=None,
    )
    db.session.add(ex)
    db.session.commit()
    return ex.id


def _trade_exec_symbols(trade):
    entry_ids = json.loads(trade.entry_execution_ids or '[]')
    exit_ids = json.loads(trade.exit_execution_ids or '[]')
    return {
        Execution.query.get(eid).symbol
        for eid in entry_ids + exit_ids
        if Execution.query.get(eid)
    }


def test_same_timestamp_different_symbols_merge_into_one_trade():
    app = _make_app()
    with app.app_context():
        account_id = _make_account()
        t1 = datetime(2026, 3, 2, 10, 15, 0)
        _add_execution(account_id, 'A', 'BUY', 10, 100.0, t1)
        _add_execution(account_id, 'B', 'SELL', 10, 2.0, t1)

        result = process_executions_into_trades(account_id, match_timestamps=True)
        assert result['success'], result.get('errors')
        assert result['trades_created'] == 1, result

        trades = Trade.query.filter_by(account_id=account_id).all()
        assert len(trades) == 1, f"Expected 1 trade, got {len(trades)}"
        assert _trade_exec_symbols(trades[0]) == {'A', 'B'}

        assert Execution.query.filter_by(matched_trade_id=None).count() == 0


def test_same_timestamp_different_symbols_not_merged_without_flag():
    app = _make_app()
    with app.app_context():
        account_id = _make_account()
        t1 = datetime(2026, 3, 2, 10, 15, 0)
        _add_execution(account_id, 'A', 'BUY', 10, 100.0, t1)
        _add_execution(account_id, 'B', 'SELL', 10, 2.0, t1)

        result = process_executions_into_trades(account_id, match_timestamps=False)
        assert result['success'], result.get('errors')
        assert result['trades_created'] == 2, result

        trades = Trade.query.filter_by(account_id=account_id).all()
        assert len(trades) == 2, f"Expected 2 trades, got {len(trades)}"


def test_mixed_timestamp_group_becomes_its_own_trade():
    """A close and an opening at the same timestamp do not all close the
    existing trade, so both fills open one new trade and the original stays open."""
    app = _make_app()
    with app.app_context():
        account_id = _make_account()
        t0 = datetime(2026, 3, 1, 9, 45, 0)
        entry_id = _add_execution(account_id, 'A', 'BUY', 10, 100.0, t0)

        trade = Trade(
            account_id=account_id,
            symbol='A',
            entry_date=t0.date(),
            entry_price=100.0,
            quantity=10,
            side='LONG',
            entry_execution_ids=json.dumps([entry_id]),
            exit_execution_ids=json.dumps([]),
            is_open=True,
            open_qty=10,
        )
        db.session.add(trade)
        db.session.commit()
        entry = Execution.query.get(entry_id)
        entry.matched_trade_id = trade.id
        entry.is_open = True
        db.session.commit()

        t1 = datetime(2026, 3, 2, 10, 15, 0)
        _add_execution(account_id, 'A', 'SELL', 10, 110.0, t1)
        _add_execution(account_id, 'B', 'BUY', 10, 50.0, t1)

        result = process_executions_into_trades(account_id, match_timestamps=True)
        assert result['success'], result.get('errors')
        assert result['trades_updated'] == 0, result
        assert result['trades_created'] == 1, result

        original = Trade.query.get(trade.id)
        assert _trade_exec_symbols(original) == {'A'}
        assert original.is_open is True
        assert json.loads(original.exit_execution_ids) == []

        opened = Trade.query.filter(Trade.id != trade.id).one()
        assert _trade_exec_symbols(opened) == {'A', 'B'}
        assert opened.is_open is True

        assert Execution.query.filter_by(matched_trade_id=None).count() == 0


def test_different_timestamps_stay_separate_with_flag():
    app = _make_app()
    with app.app_context():
        account_id = _make_account()
        _add_execution(account_id, 'A', 'BUY', 10, 100.0, datetime(2026, 3, 2, 10, 15, 0))
        _add_execution(account_id, 'B', 'SELL', 10, 2.0, datetime(2026, 3, 2, 10, 16, 0))

        result = process_executions_into_trades(account_id, match_timestamps=True)
        assert result['success'], result.get('errors')
        assert result['trades_created'] == 2, result


def test_same_symbol_same_timestamp_partial_fills_unchanged():
    app = _make_app()
    with app.app_context():
        account_id = _make_account()
        t1 = datetime(2026, 3, 2, 10, 15, 0)
        _add_execution(account_id, 'A', 'BUY', 5, 100.0, t1)
        _add_execution(account_id, 'A', 'BUY', 5, 100.0, t1)

        result = process_executions_into_trades(account_id, match_timestamps=True)
        assert result['success'], result.get('errors')
        assert result['trades_created'] == 1, result

        trade = Trade.query.filter_by(account_id=account_id).one()
        assert abs(float(trade.open_qty or 0) - 10.0) < 0.0001, trade.open_qty


def test_full_round_trip_spread_in_one_import_closes():
    """Both spread legs opened and later closed, all in one import with the
    flag on: one closed trade containing both symbols."""
    app = _make_app()
    with app.app_context():
        account_id = _make_account()
        t_open = datetime(2026, 3, 2, 10, 15, 0)
        t_close = datetime(2026, 3, 3, 11, 0, 0)
        _add_execution(account_id, 'A', 'BUY', 10, 100.0, t_open)
        _add_execution(account_id, 'B', 'SELL', 10, 2.0, t_open)
        _add_execution(account_id, 'A', 'SELL', 10, 110.0, t_close)
        _add_execution(account_id, 'B', 'BUY', 10, 1.0, t_close)

        result = process_executions_into_trades(account_id, match_timestamps=True)
        assert result['success'], result.get('errors')
        assert result['trades_created'] == 1, result

        trade = Trade.query.filter_by(account_id=account_id).one()
        assert _trade_exec_symbols(trade) == {'A', 'B'}
        assert trade.is_open is False


def _build_open_trade(account_id, symbol, qty, price, entry_dt):
    """Create an open single-symbol trade with one matched entry execution."""
    entry_id = _add_execution(account_id, symbol, 'BUY', qty, price, entry_dt)
    trade = Trade(
        account_id=account_id,
        symbol=symbol,
        entry_date=entry_dt.date(),
        entry_price=price,
        quantity=qty,
        side='LONG',
        entry_execution_ids=json.dumps([entry_id]),
        exit_execution_ids=json.dumps([]),
        is_open=True,
        open_qty=qty,
    )
    db.session.add(trade)
    db.session.commit()
    entry = Execution.query.get(entry_id)
    entry.matched_trade_id = trade.id
    entry.is_open = True
    db.session.commit()
    return trade.id


def test_partial_spread_close_with_new_symbol_becomes_new_trade():
    """Closing one spread leg and opening a new symbol at the same timestamp
    does not all close the spread, so both fills open a new trade and the
    spread is left unchanged."""
    app = _make_app()
    with app.app_context():
        account_id = _make_account()
        t0 = datetime(2026, 3, 1, 9, 45, 0)
        entry_a_id = _add_execution(account_id, 'A', 'BUY', 10, 5.0, t0)
        entry_b_id = _add_execution(account_id, 'B', 'SELL', 10, 2.0, t0)

        trade = Trade(
            account_id=account_id,
            symbol='A / B',
            entry_date=t0.date(),
            entry_price=3.0,
            quantity=10,
            side='LONG',
            entry_execution_ids=json.dumps([entry_a_id, entry_b_id]),
            exit_execution_ids=json.dumps([]),
            is_open=True,
            open_qty=10,
        )
        db.session.add(trade)
        db.session.commit()
        for eid in (entry_a_id, entry_b_id):
            e = Execution.query.get(eid)
            e.matched_trade_id = trade.id
            e.is_open = True
        db.session.commit()

        t1 = datetime(2026, 3, 2, 10, 15, 0)
        _add_execution(account_id, 'A', 'SELL', 10, 6.0, t1)
        _add_execution(account_id, 'C', 'BUY', 10, 50.0, t1)

        result = process_executions_into_trades(account_id, match_timestamps=True)
        assert result['success'], result.get('errors')
        assert result['trades_created'] == 1, result
        assert result['trades_updated'] == 0, result

        spread = Trade.query.get(trade.id)
        assert _trade_exec_symbols(spread) == {'A', 'B'}
        assert spread.is_open is True
        assert json.loads(spread.exit_execution_ids) == []
        assert abs(float(spread.open_qty or 0) - 10.0) < 0.0001, spread.open_qty

        opened = Trade.query.filter(Trade.id != trade.id).one()
        assert _trade_exec_symbols(opened) == {'A', 'C'}
        assert opened.is_open is True

        assert Execution.query.filter_by(matched_trade_id=None).count() == 0


def test_timestamp_group_close_supersedes_fifo():
    """A same-timestamp group anchored to a newer trade must close that trade's
    position even when FIFO would allocate the closing execution to an older trade."""
    app = _make_app()
    with app.app_context():
        account_id = _make_account()
        t0 = datetime(2026, 3, 1, 9, 45, 0)
        older_trade_id = _build_open_trade(account_id, 'A', 10, 100.0, t0)

        t1 = datetime(2026, 3, 2, 10, 15, 0)
        _add_execution(account_id, 'A', 'BUY', 5, 100.0, t1)
        _add_execution(account_id, 'D', 'BUY', 5, 50.0, t1)

        t2 = datetime(2026, 3, 3, 11, 0, 0)
        # Higher price sorts D's close first, anchoring the group to the new trade
        _add_execution(account_id, 'D', 'SELL', 5, 120.0, t2)
        _add_execution(account_id, 'A', 'SELL', 5, 110.0, t2)

        result = process_executions_into_trades(account_id, match_timestamps=True)
        assert result['success'], result.get('errors')
        assert result['trades_created'] == 1, result

        older = Trade.query.get(older_trade_id)
        assert older.is_open is True, "Older trade must be untouched"
        assert json.loads(older.exit_execution_ids) == []
        assert abs(float(older.open_qty or 0) - 10.0) < 0.0001, older.open_qty

        newer = Trade.query.filter(Trade.id != older_trade_id).one()
        assert _trade_exec_symbols(newer) == {'A', 'D'}
        assert newer.is_open is False, "Newer trade closed by the timestamp group"

        assert Execution.query.filter_by(matched_trade_id=None).count() == 0


def test_closes_of_different_trades_become_one_new_trade():
    """Closes of two different trades at one timestamp do not all close either
    trade, so both fills open one new trade and the originals stay open."""
    app = _make_app()
    with app.app_context():
        account_id = _make_account()
        t0 = datetime(2026, 3, 1, 9, 45, 0)
        trade_a_id = _build_open_trade(account_id, 'A', 10, 100.0, t0)
        trade_b_id = _build_open_trade(account_id, 'B', 10, 50.0, t0)

        t1 = datetime(2026, 3, 2, 10, 15, 0)
        _add_execution(account_id, 'A', 'SELL', 10, 110.0, t1)
        _add_execution(account_id, 'B', 'SELL', 10, 60.0, t1)

        result = process_executions_into_trades(account_id, match_timestamps=True)
        assert result['success'], result.get('errors')
        assert result['trades_created'] == 1, result
        assert result['trades_updated'] == 0, result

        trade_a = Trade.query.get(trade_a_id)
        trade_b = Trade.query.get(trade_b_id)
        assert _trade_exec_symbols(trade_a) == {'A'}
        assert _trade_exec_symbols(trade_b) == {'B'}
        assert trade_a.is_open is True
        assert trade_b.is_open is True
        assert json.loads(trade_a.exit_execution_ids) == []
        assert json.loads(trade_b.exit_execution_ids) == []

        opened = Trade.query.filter(Trade.id.notin_([trade_a_id, trade_b_id])).one()
        assert _trade_exec_symbols(opened) == {'A', 'B'}
        assert opened.is_open is True

        assert Execution.query.filter_by(matched_trade_id=None).count() == 0


def test_eod_expirations_of_different_underlyings_close_their_own_trades():
    """Options expiring on different underlyings share the broker's 16:00:00 EOD
    timestamp, but each expiration must close only its own trade."""
    app = _make_app()
    with app.app_context():
        account_id = _make_account()
        t0 = datetime(2026, 3, 1, 9, 45, 0)
        trade_a_id = _build_open_trade(account_id, 'A', 10, 100.0, t0)
        trade_b_id = _build_open_trade(account_id, 'B', 10, 50.0, t0)

        t_eod = datetime(2026, 3, 6, 16, 0, 0)
        _add_execution(account_id, 'A', 'SELL', 10, 0.0, t_eod)
        _add_execution(account_id, 'B', 'SELL', 10, 0.0, t_eod)

        result = process_executions_into_trades(account_id, match_timestamps=True)
        assert result['success'], result.get('errors')
        assert result['trades_created'] == 0, result
        assert result['trades_updated'] == 2, result

        trade_a = Trade.query.get(trade_a_id)
        trade_b = Trade.query.get(trade_b_id)
        assert _trade_exec_symbols(trade_a) == {'A'}
        assert _trade_exec_symbols(trade_b) == {'B'}
        assert trade_a.is_open is False
        assert trade_b.is_open is False

        assert Execution.query.filter_by(matched_trade_id=None).count() == 0


def test_eod_opening_leg_gets_own_trade():
    """At the EOD timestamp nothing may join a trade as an opening execution:
    the expiration closes its trade, the new symbol starts a separate trade."""
    app = _make_app()
    with app.app_context():
        account_id = _make_account()
        t0 = datetime(2026, 3, 1, 9, 45, 0)
        trade_a_id = _build_open_trade(account_id, 'A', 10, 100.0, t0)

        t_eod = datetime(2026, 3, 6, 16, 0, 0)
        _add_execution(account_id, 'A', 'SELL', 10, 0.0, t_eod)
        _add_execution(account_id, 'C', 'BUY', 10, 50.0, t_eod)

        result = process_executions_into_trades(account_id, match_timestamps=True)
        assert result['success'], result.get('errors')
        assert result['trades_updated'] == 1, result
        assert result['trades_created'] == 1, result

        trade_a = Trade.query.get(trade_a_id)
        assert _trade_exec_symbols(trade_a) == {'A'}
        assert trade_a.is_open is False

        new_trade = Trade.query.filter(Trade.id != trade_a_id).one()
        assert _trade_exec_symbols(new_trade) == {'C'}
        assert new_trade.is_open is True

        assert Execution.query.filter_by(matched_trade_id=None).count() == 0


# --- Timestamp detection -------------------------------------------------

def test_raw_value_has_time():
    assert _raw_value_has_time('20251031;152445') is True
    assert _raw_value_has_time('20251031') is False
    assert _raw_value_has_time('2026-02-24T15:30:14+0000') is True
    assert _raw_value_has_time('2026-02-24 15:30:14') is True
    assert _raw_value_has_time('03/31/2026') is False
    assert _raw_value_has_time('2026-02-24') is False
    assert _raw_value_has_time('') is False
    assert _raw_value_has_time(None) is False
    assert _raw_value_has_time('N/A') is False


def test_detect_execution_timestamps_ib_format():
    df = pd.DataFrame({'Date/Time': ['20251031;152445', '20251031;160000']})
    assert detect_execution_timestamps(df, {}, {}) is True

    df_dates = pd.DataFrame({'Date/Time': ['20251031', '20251101']})
    assert detect_execution_timestamps(df_dates, {}, {}) is False


def test_detect_execution_timestamps_mapped_column():
    df = pd.DataFrame({'Date': ['2026-02-24T15:30:14+0000', '2026-02-24T15:31:00+0000']})
    mappings = {'trade_date': 'Date', 'exec_datetime': 'Date'}
    assert detect_execution_timestamps(df, mappings, {}) is True


def test_detect_execution_timestamps_schwab_always_false():
    df = pd.DataFrame({'Date': ['03/31/2026 09:30', '03/31/2026 10:00']})
    assert detect_execution_timestamps(df, {}, {}, 'schwab') is False


def test_detect_execution_timestamps_missing_column():
    df = pd.DataFrame({'Symbol': ['A', 'B']})
    assert detect_execution_timestamps(df, {}, {}) is False


def test_validate_csv_reports_has_timestamps():
    app = _make_app()
    with app.app_context():
        tasty_csv = (
            "Date,Action,Symbol,Quantity,Average Price,Underlying Symbol,Instrument Type,"
            "Strike Price,Expiration Date,Call or Put,Commissions,Fees,Total,Currency,Description,Sub Type\n"
            "2026-02-24T15:30:14+0000,BUY,/MNQM6,1,-24125.50,MNQ,Future,,,,1.00,0.50,-1.50,USD,MNQ future,Trade\n"
        )
        result = validate_csv(tasty_csv, 'tasty.csv', 1)
        assert result['valid'], result.get('errors')
        assert result['has_timestamps'] is True

        schwab_csv = (
            "Date,Action,Symbol,Quantity,Price,Fees & Comm,Amount,Description\n"
            "03/31/2026,Buy to Open,USO 04/02/2026 225.00 C,1,$1.50,$0.65,-$150.65,USO CALL\n"
        )
        result = validate_csv(schwab_csv, 'schwab.csv', 1)
        assert result['valid'], result.get('errors')
        assert result['has_timestamps'] is False
