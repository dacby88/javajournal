import os
from pathlib import Path
import sys
from datetime import date

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ['DATABASE_URL'] = 'sqlite:///:memory:'

from app import app, db
from models import Account, Trade, Tag


def add_trade(account_id, exit_date, pnl, is_open=False, tagged=False):
    trade = Trade(account_id=account_id, symbol='SYNTHETIC', side='LONG', quantity=1,
                  entry_date=date(2025, 1, 1), exit_date=exit_date, entry_price=100,
                  net_pnl=pnl, is_open=is_open)
    if tagged:
        tag = Tag.query.filter_by(name='Margin').first()
        if tag is None:
            tag = Tag(name='Margin')
            db.session.add(tag)
        trade.tags_list.append(tag)
    db.session.add(trade)
    db.session.commit()


def test_dashboard_equity_has_prior_and_daily_closed_pnl_per_selected_account():
    with app.app_context():
        db.drop_all()
        db.create_all()
        a, b = Account(name='Synthetic A'), Account(name='Synthetic B')
        db.session.add_all([a, b])
        db.session.commit()
        add_trade(a.id, date(2025, 12, 31), 10000)
        add_trade(a.id, date(2026, 1, 5), 200, tagged=True)
        add_trade(a.id, date(2026, 1, 5), -50)
        add_trade(a.id, date(2026, 1, 6), -100)
        add_trade(a.id, date(2026, 1, 7), 5000, is_open=True)
        add_trade(a.id, date(2026, 2, 1), 9000)
        add_trade(b.id, date(2025, 12, 31), 30000)
        result = app.test_client().get(f'/api/dashboard?account_ids={a.id}&start_date=2026-01-01&end_date=2026-01-31&exclude_margin_tag=true')
        assert result.status_code == 200
        equity = result.get_json()['data']['sortino_equity']
        assert equity['start_date'] == '2026-01-01'
        assert equity['end_date'] == '2026-01-31'
        assert equity['opening_pnl'] == [{'account_id': a.id, 'net_pnl': 10000}]
        assert equity['daily_pnl'] == [
            {'account_id': a.id, 'date': '2026-01-05', 'net_pnl': 150},
            {'account_id': a.id, 'date': '2026-01-06', 'net_pnl': -100},
        ]


def test_dashboard_all_accounts_keeps_inactive_and_unassigned_pnl_separate():
    with app.app_context():
        db.drop_all()
        db.create_all()
        a, b = Account(name='Synthetic A'), Account(name='Synthetic inactive', is_active=False)
        db.session.add_all([a, b])
        db.session.commit()
        add_trade(a.id, date(2026, 1, 5), 100)
        add_trade(b.id, date(2026, 1, 5), 200)
        add_trade(None, date(2026, 1, 5), 30)
        response = app.test_client().get('/api/dashboard?end_date=2026-01-31')
        assert response.status_code == 200
        equity = response.get_json()['data']['sortino_equity']
        assert equity['start_date'] is None
        assert equity['opening_pnl'] == []
        assert sorted((row['account_id'] or 0, row['net_pnl']) for row in equity['daily_pnl']) == [(0, 30), (a.id, 100), (b.id, 200)]


def test_daily_return_groups_preserve_tag_combinations_without_duplicate_pnl():
    with app.app_context():
        db.drop_all()
        db.create_all()
        account = Account(name='Synthetic tag groups')
        first, second = Tag(name='Synthetic first'), Tag(name='Synthetic second')
        db.session.add_all([account, first, second])
        db.session.commit()
        for pnl, tags in ((10, [first, second]), (5, [first, second]), (20, []), (30, [first])):
            row = Trade(account_id=account.id, symbol='SYNTHETIC', side='LONG', quantity=1,
                        entry_date=date(2026, 1, 1), exit_date=date(2026, 1, 5), entry_price=100,
                        net_pnl=pnl, is_open=False)
            row.tags_list.extend(tags)
            db.session.add(row)
        db.session.commit()
        response = app.test_client().get(f'/api/dashboard?account_ids={account.id}&start_date=2026-01-01&end_date=2026-01-31')
        assert response.status_code == 200
        equity = response.get_json()['data']['sortino_equity']
        assert equity['daily_pnl'][0]['net_pnl'] == 65
        assert [(row['tag_ids'], row['net_pnl']) for row in equity['daily_returns']] == [([], 20), ([first.id], 30), ([first.id, second.id], 15)]


def test_account_api_keeps_zero_annual_benchmarks_on_create_and_update():
    with app.app_context():
        db.drop_all()
        db.create_all()
        client = app.test_client()
        settings = {'sortino_target_mode': 'percent', 'sortino_target': 0, 'starting_account_value': 100000}
        response = client.post('/api/accounts', json={'name': 'Synthetic annual benchmark', 'settings': settings})
        assert response.status_code == 200
        account = response.get_json()['data']
        assert account['settings'] == settings
        response = client.put(f"/api/accounts/{account['id']}", json={'settings': settings})
        assert response.status_code == 200
        assert response.get_json()['data']['settings']['sortino_target'] == 0
