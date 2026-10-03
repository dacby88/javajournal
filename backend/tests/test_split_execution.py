#!/usr/bin/env python3
"""Split unmatched executions into 2+ rows with pro-rata money fields."""

import os
import sys
from datetime import date, datetime
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ['DATABASE_URL'] = 'sqlite:///:memory:'

from app import app, db
from models import Account, Execution, ImportHistory, Trade


def _ctx():
    return app.app_context()


def _reset_db():
    db.drop_all()
    db.create_all()


def _seed_account():
    account = Account(name='Test Account')
    db.session.add(account)
    db.session.commit()
    return account


def _make_execution(account_id, **kwargs):
    defaults = dict(
        account_id=account_id,
        symbol='SPXW  260904C06000000',
        description='SPXW Sep04 6000 C',
        underlying_symbol='SPX',
        asset_class='OPT',
        side='BUY',
        quantity=10,
        price=1.25,
        amount=-1250,
        proceeds=-1250,
        net_cash=-1260,
        commission=10,
        broker_execution_commission=2,
        multiplier=100,
        trade_date=date(2026, 9, 4),
        exec_datetime=datetime(2026, 9, 4, 14, 30),
        exec_id='BROKER-EXEC-1',
        notes='original fill',
        is_open=True,
    )
    defaults.update(kwargs)
    execution = Execution(**defaults)
    db.session.add(execution)
    db.session.commit()
    return execution


def _money(value):
    if value is None:
        return Decimal('0')
    return Decimal(str(value))


def test_split_buy_updates_original_and_creates_row():
    with _ctx():
        _reset_db()
        account = _seed_account()
        execution = _make_execution(account.id, quantity=10, side='BUY')
        original_id = execution.id
        client = app.test_client()

        response = client.post(
            f'/api/executions/{original_id}/split',
            json={'quantities': [4, 6]},
        )
        assert response.status_code == 200, response.data
        body = response.get_json()
        assert body['success'] is True
        assert len(body['data']) == 2

        db.session.expire_all()
        original = db.session.get(Execution, original_id)
        new_rows = Execution.query.filter(Execution.id != original_id).all()
        assert original is not None
        assert float(original.quantity) == 4
        assert original.side == 'BUY'
        assert original.exec_id == 'BROKER-EXEC-1'
        assert original.matched_trade_id is None
        assert len(new_rows) == 1
        created = new_rows[0]
        assert float(created.quantity) == 6
        assert created.side == 'BUY'
        assert created.exec_id is None
        assert created.symbol == original.symbol
        assert created.matched_trade_id is None

        assert _money(original.commission) + _money(created.commission) == Decimal('10')
        assert _money(original.broker_execution_commission) + _money(created.broker_execution_commission) == Decimal('2')
        assert _money(original.amount) + _money(created.amount) == Decimal('-1250')
        assert _money(original.proceeds) + _money(created.proceeds) == Decimal('-1250')
        assert _money(original.net_cash) + _money(created.net_cash) == Decimal('-1260')
        assert _money(original.commission) == Decimal('4.0000')
        assert _money(created.commission) == Decimal('6.0000')


def test_split_last_piece_gets_money_remainder():
    with _ctx():
        _reset_db()
        account = _seed_account()
        execution = _make_execution(
            account.id,
            quantity=3,
            commission=10,
            broker_execution_commission=1,
            amount=-300,
            proceeds=-300,
            net_cash=-311,
        )
        client = app.test_client()
        response = client.post(
            f'/api/executions/{execution.id}/split',
            json={'quantities': [1, 1, 1]},
        )
        assert response.status_code == 200, response.data
        db.session.expire_all()
        rows = Execution.query.order_by(Execution.id).all()
        assert len(rows) == 3
        commissions = [_money(r.commission) for r in rows]
        assert commissions[0] == Decimal('3.3333')
        assert commissions[1] == Decimal('3.3333')
        assert commissions[2] == Decimal('3.3334')
        assert sum(commissions) == Decimal('10')
        assert sum(_money(r.amount) for r in rows) == Decimal('-300')
        assert sum(_money(r.net_cash) for r in rows) == Decimal('-311')


def test_split_sell_unsigned_quantities_store_negative():
    with _ctx():
        _reset_db()
        account = _seed_account()
        execution = _make_execution(account.id, quantity=-10, side='SELL')
        client = app.test_client()
        response = client.post(
            f'/api/executions/{execution.id}/split',
            json={'quantities': [3, 7]},
        )
        assert response.status_code == 200, response.data
        db.session.expire_all()
        original = db.session.get(Execution, execution.id)
        created = Execution.query.filter(Execution.id != execution.id).one()
        assert float(original.quantity) == -3
        assert float(created.quantity) == -7


def test_split_sell_signed_quantities_same_as_unsigned():
    with _ctx():
        _reset_db()
        account = _seed_account()
        execution = _make_execution(account.id, quantity=-10, side='SELL')
        client = app.test_client()
        response = client.post(
            f'/api/executions/{execution.id}/split',
            json={'quantities': [-3, -7]},
        )
        assert response.status_code == 200, response.data
        db.session.expire_all()
        original = db.session.get(Execution, execution.id)
        created = Execution.query.filter(Execution.id != execution.id).one()
        assert float(original.quantity) == -3
        assert float(created.quantity) == -7


def test_split_rejects_matched_execution():
    with _ctx():
        _reset_db()
        account = _seed_account()
        execution = _make_execution(account.id, quantity=10)
        trade = Trade(
            account_id=account.id,
            symbol=execution.symbol,
            description=execution.symbol,
            entry_date=execution.trade_date,
            entry_price=execution.price,
            quantity=10,
            side='LONG',
            entry_execution_ids='[]',
            exit_execution_ids='[]',
        )
        db.session.add(trade)
        db.session.commit()
        execution.matched_trade_id = trade.id
        db.session.commit()

        client = app.test_client()
        response = client.post(
            f'/api/executions/{execution.id}/split',
            json={'quantities': [4, 6]},
        )
        assert response.status_code == 400
        body = response.get_json()
        assert body['success'] is False
        assert 'Unmatch from trade first' in body['error']
        db.session.expire_all()
        assert Execution.query.count() == 1
        assert float(db.session.get(Execution, execution.id).quantity) == 10


def test_split_rejects_quantity_one():
    with _ctx():
        _reset_db()
        account = _seed_account()
        execution = _make_execution(account.id, quantity=1)
        client = app.test_client()
        response = client.post(
            f'/api/executions/{execution.id}/split',
            json={'quantities': [1]},
        )
        assert response.status_code == 400
        assert Execution.query.count() == 1


def test_split_rejects_non_integer_original():
    with _ctx():
        _reset_db()
        account = _seed_account()
        execution = _make_execution(account.id, quantity=2.5)
        client = app.test_client()
        response = client.post(
            f'/api/executions/{execution.id}/split',
            json={'quantities': [1, 1.5]},
        )
        assert response.status_code == 400
        assert Execution.query.count() == 1


def test_split_rejects_bad_sums_and_short_lists():
    with _ctx():
        _reset_db()
        account = _seed_account()
        execution = _make_execution(account.id, quantity=10)
        client = app.test_client()
        orig_id = execution.id

        over = client.post(f'/api/executions/{orig_id}/split', json={'quantities': [4, 7]})
        assert over.status_code == 400
        assert 'sum' in over.get_json()['error'].lower()

        empty = client.post(f'/api/executions/{orig_id}/split', json={'quantities': []})
        assert empty.status_code == 400

        missing = client.post(f'/api/executions/{orig_id}/split', json={})
        assert missing.status_code == 400

        single = client.post(f'/api/executions/{orig_id}/split', json={'quantities': [10]})
        assert single.status_code == 400

        zero = client.post(f'/api/executions/{orig_id}/split', json={'quantities': [0, 10]})
        assert zero.status_code == 400

        assert Execution.query.count() == 1


def test_split_not_found():
    with _ctx():
        _reset_db()
        client = app.test_client()
        response = client.post('/api/executions/99999/split', json={'quantities': [1, 1]})
        assert response.status_code == 404


def test_split_copies_import_id_and_clears_new_exec_id():
    with _ctx():
        _reset_db()
        account = _seed_account()
        import_record = ImportHistory(account_id=account.id, filename='fills.csv', executions_count=1)
        db.session.add(import_record)
        db.session.commit()
        execution = _make_execution(account.id, quantity=10, import_id=import_record.id, exec_id='KEEP-ME')
        client = app.test_client()
        response = client.post(
            f'/api/executions/{execution.id}/split',
            json={'quantities': [4, 6]},
        )
        assert response.status_code == 200, response.data
        db.session.expire_all()
        original = db.session.get(Execution, execution.id)
        created = Execution.query.filter(Execution.id != execution.id).one()
        assert original.import_id == import_record.id
        assert original.exec_id == 'KEEP-ME'
        assert created.import_id == import_record.id
        assert created.exec_id is None


def test_nested_split_keeps_import_id():
    with _ctx():
        _reset_db()
        account = _seed_account()
        import_record = ImportHistory(account_id=account.id, filename='fills.csv', executions_count=1)
        db.session.add(import_record)
        db.session.commit()
        execution = _make_execution(account.id, quantity=10, import_id=import_record.id)
        client = app.test_client()
        first = client.post(
            f'/api/executions/{execution.id}/split',
            json={'quantities': [4, 6]},
        )
        assert first.status_code == 200, first.data
        child_id = first.get_json()['data'][1]['id']
        second = client.post(
            f'/api/executions/{child_id}/split',
            json={'quantities': [2, 4]},
        )
        assert second.status_code == 200, second.data
        db.session.expire_all()
        grandchild_ids = [row['id'] for row in second.get_json()['data']]
        for eid in grandchild_ids:
            row = db.session.get(Execution, eid)
            assert row.import_id == import_record.id
        imported = Execution.query.filter_by(import_id=import_record.id).count()
        assert imported == 3
