from datetime import date

import numpy as np
from sqlalchemy import event

from app import app
from models import db, Account, Trade, DailyStats, OverallStats
from stats_calculator import recalculate_all_stats


def test_stats_bind_only_native_numbers_for_postgres():
    with app.app_context():
        account = Account(name='Synthetic numeric test')
        db.session.add(account)
        db.session.flush()
        db.session.add(Trade(account_id=account.id, symbol='AAPL', side='LONG', quantity=1,
                             entry_date=date(2026, 1, 15), exit_date=date(2026, 1, 15),
                             entry_price=100, exit_price=110, net_pnl=10, gross_pnl=10, is_open=False))
        db.session.commit()
        session = db.session()

        def check_numbers(session, _context, _instances):
            for item in session.new.union(session.dirty):
                if isinstance(item, (DailyStats, OverallStats)):
                    for value in item.__dict__.values():
                        assert not isinstance(value, np.generic), 'Convert NumPy scalars before database writes.'

        event.listen(session, 'before_flush', check_numbers)
        try:
            recalculate_all_stats()
        finally:
            event.remove(session, 'before_flush', check_numbers)
