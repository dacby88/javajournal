"""Mark-to-market P&L for an open trade from executions and mids."""


def _signed_qty(execution):
    qty = abs(float(execution.quantity or 0))
    return qty if execution.side == 'BUY' else -qty


def _multiplier(execution):
    mult = getattr(execution, 'multiplier', None)
    if mult is not None and float(mult) > 0:
        return float(mult)
    asset = (getattr(execution, 'asset_class', None) or '').upper()
    if asset == 'STK':
        return 1.0
    return 100.0


def mark_trade(executions, quotes_by_symbol):
    """
    Open P&L = net cash of every execution (closed legs realized)
    plus remaining qty * mid * multiplier for each still-open symbol.
    """
    by_symbol = {}
    for execution in executions:
        symbol = execution.symbol or '-'
        row = by_symbol.get(symbol)
        if row is None:
            row = {
                'symbol': symbol,
                'description': None,
                'signed_qty': 0.0,
                'open_qty_abs': 0.0,
                'open_cost': 0.0,
                'all_net_cash': 0.0,
                'open_net_cash': 0.0,
                'multiplier': _multiplier(execution),
            }
            by_symbol[symbol] = row
        if not row['description']:
            row['description'] = getattr(execution, 'description', None) or None
        signed = _signed_qty(execution)
        row['signed_qty'] += signed
        row['all_net_cash'] += float(execution.net_cash or 0)
        if execution.is_open is not False:
            abs_qty = abs(float(execution.quantity or 0))
            row['open_qty_abs'] += abs_qty
            row['open_cost'] += abs_qty * float(execution.price or 0)
            row['open_net_cash'] += float(execution.net_cash or 0)

    open_positions = []
    mtm_adjustment = 0.0
    total_net_cash = 0.0

    for symbol, row in sorted(by_symbol.items(), key=lambda item: item[0]):
        total_net_cash += row['all_net_cash']
        remaining = row['signed_qty']
        if abs(remaining) <= 1e-8:
            continue
        mid = quotes_by_symbol.get(symbol)
        mtm_value = None
        if mid is not None:
            mtm_value = remaining * float(mid) * row['multiplier']
            mtm_adjustment += mtm_value
        open_positions.append({
            'symbol': symbol,
            'description': row['description'],
            'side': 'BUY' if remaining > 0 else 'SELL',
            'qty': abs(remaining),
            'avg_price': (row['open_cost'] / row['open_qty_abs']) if row['open_qty_abs'] else 0.0,
            'net_cash': row['open_net_cash'],
            'mid': mid,
            'multiplier': row['multiplier'],
            # Per-position open P&L: all net cash for the symbol (including
            # realized cash from closed lots) plus the mark-to-market of the
            # remaining quantity. Rows sum to the trade-level open_pnl.
            'open_pnl': (row['all_net_cash'] + mtm_value) if mtm_value is not None else None,
        })

    return {
        'open_pnl': total_net_cash + mtm_adjustment,
        'open_positions': open_positions,
    }
