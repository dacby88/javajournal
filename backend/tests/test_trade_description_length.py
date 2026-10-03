#!/usr/bin/env python3
"""Rolled multi-expiry trades can generate descriptions longer than VARCHAR(200)."""

import os
import sys
from datetime import date
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from flask import Flask
from sqlalchemy import Text

from csv_processor import _generate_trade_description
from models import Account, Trade, db


def _make_app():
    app = Flask(__name__)
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    db.init_app(app)
    with app.app_context():
        db.create_all()
    return app


def _opt(expiry, strike, price=1.0):
    return SimpleNamespace(
        asset_class='OPT',
        strike=strike,
        expiry=expiry,
        put_call='P',
        underlying_symbol='SPX',
        quantity=1,
        side='SELL',
        price=price,
        symbol='SPX',
    )


def _rolled_spx_executions():
    """Same 6-expiry SPX put roll that overflowed VARCHAR(200) in production."""
    return [
        _opt(date(2026, 8, 6), 7740),
        _opt(date(2026, 8, 7), 7740),
        _opt(date(2026, 8, 10), 7740),
        _opt(date(2026, 8, 12), 7745),
        _opt(date(2026, 8, 13), 7750),
        _opt(date(2026, 8, 18), 7740),
    ]


def test_rolled_spx_auto_description_exceeds_200_chars():
    desc = _generate_trade_description(_rolled_spx_executions())
    assert desc is not None
    assert len(desc) > 200


def test_trade_description_column_is_unbounded_text():
    assert isinstance(Trade.__table__.c.description.type, Text)


def test_trade_persists_description_longer_than_200():
    app = _make_app()
    with app.app_context():
        account = Account(name='Test Account')
        db.session.add(account)
        db.session.commit()

        desc = _generate_trade_description(_rolled_spx_executions())
        trade = Trade(
            account_id=account.id,
            symbol='SPX',
            description=desc,
            entry_date=date(2026, 8, 5),
            entry_price=37.82,
            quantity=1,
            side='SHORT',
            entry_execution_ids='[]',
            exit_execution_ids='[]',
        )
        db.session.add(trade)
        db.session.commit()
        db.session.refresh(trade)

        assert trade.description == desc
        assert len(trade.description) > 200


def test_auto_description_lists_highest_priced_symbol_first():
    """Combined/multi-expiry names should lead with the highest traded price."""
    cheaper_earlier = _opt(date(2026, 8, 6), 7740, price=8.0)
    expensive_later = _opt(date(2026, 8, 18), 7740, price=22.5)
    desc = _generate_trade_description([cheaper_earlier, expensive_later])
    assert desc is not None
    assert desc.index('2026-08-18') < desc.index('2026-08-06')


def test_auto_description_skips_closing_executions():
    open_leg = _opt(date(2026, 8, 6), 7740, price=8.0)
    open_leg.is_open = True
    close_leg = _opt(date(2026, 8, 18), 7800, price=22.5)
    close_leg.is_open = False
    desc = _generate_trade_description([open_leg, close_leg])
    assert desc is not None
    assert '2026-08-06' in desc
    assert '2026-08-18' not in desc
    assert '7800' not in desc
