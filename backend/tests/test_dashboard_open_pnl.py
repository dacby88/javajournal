#!/usr/bin/env python3
"""Dashboard charts include a trade's current open P&L."""

import os
import sys
from datetime import date, datetime, timedelta
from unittest.mock import patch

import pytz

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ['DATABASE_URL'] = 'sqlite:///:memory:'

from app import app, db
from models import Account, Execution, Tag, Trade


def _ctx():
    return app.app_context()


def _execution(account_id, trade, underlying):
    execution = Execution(
        account_id=account_id,
        symbol=trade.symbol,
        underlying_symbol=underlying,
        asset_class='STK',
        side='BUY',
        quantity=1,
        price=10,
        net_cash=-10,
        trade_date=trade.entry_date,
        exec_datetime=datetime.combine(trade.entry_date, datetime.min.time()),
        is_open=True,
        matched_trade_id=trade.id,
    )
    db.session.add(execution)


def _open_trade(account_id, symbol, entry, tags=None):
    trade = Trade(
        account_id=account_id,
        symbol=symbol,
        underlying_symbol=symbol,
        asset_class='STK',
        entry_date=entry,
        entry_price=10,
        quantity=1,
        side='LONG',
        net_pnl=0,
        is_open=True,
        open_qty=1,
    )
    if tags:
        trade.tags_list.extend(tags)
    db.session.add(trade)
    db.session.commit()
    _execution(account_id, trade, symbol)
    db.session.commit()
    return trade


def test_symbol_and_tag_charts_add_current_open_pnl():
    with _ctx():
        db.drop_all()
        db.create_all()
        account = Account(name='Main')
        swing = Tag(name='Swing', color='#111111')
        core = Tag(name='Core', color='#222222')
        db.session.add_all([account, swing, core])
        db.session.commit()

        closed = Trade(
            account_id=account.id,
            symbol='SPY',
            underlying_symbol='SPY',
            asset_class='STK',
            entry_date=date(2024, 1, 9),
            exit_date=date(2024, 1, 10),
            entry_price=100,
            exit_price=101,
            quantity=1,
            side='LONG',
            net_pnl=100,
            is_open=False,
        )
        closed.tags_list.append(swing)
        db.session.add(closed)
        db.session.commit()

        _open_trade(account.id, 'AAPL', date(2024, 1, 15), [swing, core])
        _open_trade(account.id, 'QQQ', date(2024, 1, 16))
        _open_trade(account.id, 'DIA', date(2023, 12, 1))
        _open_trade(account.id, 'MSFT', date(2024, 2, 1))
        _open_trade(account.id, 'IWM', date(2024, 1, 20))

        class FakeQuotes:
            def mark_trade(self, executions):
                marks = {'AAPL': 40.0, 'QQQ': 7.0, 'DIA': 5.0, 'MSFT': 99.0}
                symbol = executions[0].underlying_symbol
                return {'open_pnl': marks.get(symbol), 'open_positions': []}

        with patch('app.get_quote_service', return_value=FakeQuotes()):
            response = app.test_client().get(
                f'/api/dashboard?account_id={account.id}&start_date=2024-01-01&end_date=2024-01-31'
            )

        assert response.status_code == 200, response.get_data(as_text=True)
        data = response.get_json()['data']
        assert float(data['overall']['net_pnl']) == 100
        assert data['overall']['total_trades'] == 1

        by_symbol = {row['symbol']: row for row in data['symbol_pnl']}
        assert float(by_symbol['SPY']['pnl']) == 100
        assert float(by_symbol['AAPL']['pnl']) == 40
        assert float(by_symbol['QQQ']['pnl']) == 7
        assert float(by_symbol['DIA']['pnl']) == 5
        assert 'MSFT' not in by_symbol
        assert 'IWM' not in by_symbol

        by_tag = {row['tag']: row for row in data['tag_pnl']}
        assert float(by_tag['Swing']['pnl']) == 140
        assert by_tag['Swing']['count'] == 2
        assert float(by_tag['Core']['pnl']) == 40
        assert by_tag['Core']['count'] == 1
        assert '(untagged)' not in by_tag

        # Those opens are years old, so they stay out of the intraday hour chart.
        assert data['trade_pnl_by_hour'] == []
        by_duration = {row['bucket']: row for row in data['duration_pnl']}
        assert float(by_duration['1-3days']['pnl']) == 100
        assert by_duration['1-3days']['count'] == 1
        assert float(by_duration['>90days']['pnl']) == 52
        assert by_duration['>90days']['count'] == 3


def _open_trade_at(account_id, symbol, entry_dt):
    trade = Trade(
        account_id=account_id,
        symbol=symbol,
        underlying_symbol=symbol,
        asset_class='STK',
        entry_date=entry_dt.date(),
        entry_price=10,
        quantity=1,
        side='LONG',
        net_pnl=0,
        is_open=True,
        open_qty=1,
    )
    db.session.add(trade)
    db.session.commit()
    db.session.add(Execution(
        account_id=account_id,
        symbol=symbol,
        underlying_symbol=symbol,
        asset_class='STK',
        side='BUY',
        quantity=1,
        price=10,
        net_cash=-10,
        trade_date=entry_dt.date(),
        exec_datetime=entry_dt,
        is_open=True,
        matched_trade_id=trade.id,
    ))
    db.session.commit()
    return trade


def test_hour_and_duration_charts_add_current_open_pnl():
    with _ctx():
        db.drop_all()
        db.create_all()
        account = Account(name='Hours')
        db.session.add(account)
        db.session.commit()

        ny_now = datetime.now(pytz.timezone('America/New_York')).replace(tzinfo=None)
        window_end = ny_now.date()
        window_start = window_end - timedelta(days=40)
        closed_day = window_start + timedelta(days=5)
        closed = Trade(
            account_id=account.id,
            symbol='SPY',
            underlying_symbol='SPY',
            asset_class='STK',
            entry_date=closed_day,
            exit_date=closed_day,
            entry_price=100,
            exit_price=101,
            quantity=1,
            side='LONG',
            net_pnl=25,
            is_open=False,
        )
        db.session.add(closed)
        db.session.commit()
        db.session.add(Execution(
            account_id=account.id,
            symbol='SPY',
            underlying_symbol='SPY',
            asset_class='STK',
            side='BUY',
            quantity=1,
            price=100,
            net_cash=-100,
            trade_date=closed_day,
            exec_datetime=datetime.combine(closed_day, datetime.min.time()).replace(hour=10, minute=15),
            is_open=False,
            matched_trade_id=closed.id,
        ))
        db.session.commit()

        intraday_entry = ny_now - timedelta(minutes=45)
        _open_trade_at(account.id, 'AAPL', intraday_entry)
        _open_trade_at(account.id, 'QQQ', ny_now - timedelta(days=10))
        _open_trade_at(account.id, 'MSFT', datetime.combine(window_end + timedelta(days=1), datetime.min.time()).replace(hour=11))
        _open_trade_at(account.id, 'IWM', ny_now - timedelta(minutes=20))

        class FakeQuotes:
            def mark_trade(self, executions):
                marks = {'AAPL': 40.0, 'QQQ': 8.0, 'MSFT': 99.0}
                symbol = executions[0].underlying_symbol
                return {'open_pnl': marks.get(symbol), 'open_positions': []}

        with patch('app.get_quote_service', return_value=FakeQuotes()):
            response = app.test_client().get(
                f'/api/dashboard?account_id={account.id}'
                f'&start_date={window_start.isoformat()}&end_date={window_end.isoformat()}'
            )

        assert response.status_code == 200, response.get_data(as_text=True)
        data = response.get_json()['data']
        assert float(data['overall']['net_pnl']) == 25
        assert data['overall']['total_trades'] == 1

        hourly = data['trade_pnl_by_hour']
        assert sum(row['count'] for row in hourly) == 2
        assert round(sum(float(row['pnl']) for row in hourly), 2) == 65
        by_hour = {row['hour']: row for row in hourly}
        assert 10 in by_hour
        assert intraday_entry.hour in by_hour

        by_duration = {row['bucket']: row for row in data['duration_pnl']}
        assert float(by_duration['0-30min']['pnl']) == 25
        assert by_duration['0-30min']['count'] == 1
        assert float(by_duration['30min-1hr']['pnl']) == 40
        assert by_duration['30min-1hr']['count'] == 1
        assert float(by_duration['7-30days']['pnl']) == 8
        assert by_duration['7-30days']['count'] == 1
        assert round(sum(float(row['pnl']) for row in data['duration_pnl']), 2) == 73
