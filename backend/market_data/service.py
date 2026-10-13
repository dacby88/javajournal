"""Quote retrieval service. CBOE delayed quotes cover options and US stocks."""

from market_data.cboe import CboeDelayedQuotesSource
from market_data.pnl import mark_trade

_SERVICE = None


class QuoteService:
    def __init__(self, source=None):
        self.source = source or CboeDelayedQuotesSource()

    def lookup_mid(self, underlying, expiry, put_call, strike):
        return self.source.lookup_mid(underlying, expiry, put_call, strike)

    def lookup_stock_mid(self, symbol):
        return self.source.lookup_stock_mid(symbol)

    def mids_for_executions(self, executions):
        quotes = {}
        for execution in executions:
            symbol = execution.symbol or '-'
            if symbol in quotes:
                continue
            asset = (getattr(execution, 'asset_class', None) or '').upper()
            if asset in ('OPT', 'FOP'):
                quotes[symbol] = self.source.lookup_mid(
                    execution.underlying_symbol or execution.symbol,
                    execution.expiry,
                    execution.put_call,
                    execution.strike,
                )
            elif asset == 'STK':
                quotes[symbol] = self.source.lookup_stock_mid(
                    execution.symbol or execution.underlying_symbol
                )
            else:
                quotes[symbol] = None
        return quotes

    def mark_trade(self, executions):
        quotes = self.mids_for_executions(executions)
        return mark_trade(executions, quotes)


def get_quote_service():
    global _SERVICE
    if _SERVICE is None:
        _SERVICE = QuoteService()
    return _SERVICE
