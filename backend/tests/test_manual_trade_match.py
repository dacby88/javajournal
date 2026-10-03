#!/usr/bin/env python3
"""A single unmatched execution can start an open trade for manual matching."""

import os
import sys
from datetime import date, datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ['DATABASE_URL'] = 'sqlite:///:memory:'

from app import app, db
from models import Account, Execution, Trade


def test_one_execution_creates_an_open_trade():
    with app.app_context():
        db.drop_all()
        db.create_all()

        account = Account(name='Test Account')
        db.session.add(account)
        db.session.commit()

        execution = Execution(
            account_id=account.id,
            symbol='AAPL',
            underlying_symbol='AAPL',
            asset_class='STK',
            side='BUY',
            quantity=2,
            price=100,
            net_cash=-200,
            commission=1,
            trade_date=date(2026, 3, 2),
            exec_datetime=datetime(2026, 3, 2, 10, 15, 0),
            is_open=True,
        )
        db.session.add(execution)
        db.session.commit()

        response = app.test_client().post(
            '/api/executions/combine',
            json={'execution_ids': [execution.id]},
        )

        assert response.status_code == 200, response.data
        body = response.get_json()
        assert body['success'] is True
        assert body['data']['is_open'] is True
        assert body['data']['symbol'] == 'AAPL'

        db.session.expire_all()
        linked = db.session.get(Execution, execution.id)
        trade = db.session.get(Trade, body['data']['id'])
        assert linked.matched_trade_id == trade.id
        assert trade.is_open is True
        assert float(trade.open_qty) > 0
