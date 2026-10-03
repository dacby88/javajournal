from math import isfinite

from sqlalchemy import func, or_

from models import db, Trade, trade_tags


def get_sortino_equity(account_ids=None, start_date=None, end_date=None):
    filters = [Trade.is_open.is_(False), Trade.exit_date.isnot(None)]
    if account_ids:
        filters.append(or_(Trade.account_id.in_(account_ids), Trade.account_id.is_(None)))
    if end_date:
        filters.append(Trade.exit_date <= end_date)
    rows = db.session.query(Trade.account_id, Trade.exit_date, func.sum(Trade.net_pnl)).filter(
        *filters,
    ).group_by(Trade.account_id, Trade.exit_date).order_by(Trade.exit_date, Trade.account_id).all()
    opening = {}
    daily = []
    for account_id, date, value in rows:
        pnl = float(value or 0)
        if not isfinite(pnl):
            raise ValueError('Account realized P&L must be finite.')
        if start_date and date < start_date:
            opening[account_id] = opening.get(account_id, 0) + pnl
        else:
            daily.append({'account_id': account_id, 'date': date.isoformat(), 'net_pnl': pnl})
    period_filters = [*filters, *([Trade.exit_date >= start_date] if start_date else [])]
    tagged_rows = db.session.query(Trade.id, Trade.account_id, Trade.exit_date, Trade.net_pnl, trade_tags.c.tag_id).outerjoin(
        trade_tags, trade_tags.c.trade_id == Trade.id,
    ).filter(*period_filters).all()
    trades = {}
    for trade_id, account_id, date, pnl, tag_id in tagged_rows:
        if trade_id not in trades:
            value = float(pnl or 0)
            if not isfinite(value):
                raise ValueError('Trade realized P&L must be finite.')
            trades[trade_id] = {'account_id': account_id, 'date': date.isoformat(), 'net_pnl': value, 'tag_ids': []}
        if tag_id is not None:
            trades[trade_id]['tag_ids'].append(tag_id)
    groups = {}
    for trade in trades.values():
        tags = tuple(sorted(trade['tag_ids']))
        key = (trade['account_id'], trade['date'], tags)
        if key not in groups:
            groups[key] = {'account_id': trade['account_id'], 'date': trade['date'], 'net_pnl': 0, 'tag_ids': list(tags)}
        groups[key]['net_pnl'] += trade['net_pnl']
    returns = sorted(groups.values(), key=lambda row: (row['date'], row['account_id'] or 0, row['tag_ids']))
    return {
        'start_date': start_date.isoformat() if start_date else None,
        'end_date': end_date.isoformat() if end_date else None,
        'opening_pnl': [{'account_id': account_id, 'net_pnl': pnl} for account_id, pnl in opening.items()],
        'daily_pnl': daily,
        'daily_returns': returns,
    }
