#!/usr/bin/env python3
"""Market-data service: OCC symbols, CBOE mids, and open-trade mark-to-market."""

import json
import os
import sys
from datetime import date
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from market_data.cboe import CboeDelayedQuotesSource, chain_ticker, equity_price, equity_ticker, mid_price, to_occ
from market_data.pnl import mark_trade
from market_data.service import QuoteService


def test_to_occ_encodes_spx_put():
    assert to_occ('SPX', date(2026, 8, 6), 'P', 7740) == 'SPX260806P07740000'


def test_to_occ_encodes_equity_call_fractional_strike():
    assert to_occ('AAPL', date(2026, 3, 20), 'C', 195.5) == 'AAPL260320C00195500'


def test_chain_ticker_prefixes_index_roots():
    assert chain_ticker('SPX') == '_SPX'
    assert chain_ticker('^SPX') == '_SPX'
    assert chain_ticker('AAPL') == 'AAPL'


def test_mid_price_averages_bid_ask():
    assert mid_price(10.0, 12.0) == 11.0


def test_mid_price_uses_one_side_if_other_missing():
    assert mid_price(10.0, None) == 10.0
    assert mid_price(None, 12.0) == 12.0
    assert mid_price(None, None) is None


def test_cboe_lookup_mid_from_chain():
    payload = {
        'data': {
            'options': [
                {'option': 'SPX260806P07740000', 'bid': 20.0, 'ask': 22.0},
                {'option': 'SPXW260806P07740000', 'bid': 1.0, 'ask': 1.2},
            ]
        }
    }

    def fake_fetch(url):
        assert '_SPX.json' in url
        return payload

    source = CboeDelayedQuotesSource(fetch=fake_fetch, ttl=9999)
    assert source.lookup_mid('SPX', date(2026, 8, 6), 'P', 7740) == 21.0


def test_cboe_lookup_falls_back_to_spxw_when_spx_root_missing():
    payload = {
        'data': {
            'options': [
                {'option': 'SPXW260807P07740000', 'bid': 8.0, 'ask': 9.0},
            ]
        }
    }
    source = CboeDelayedQuotesSource(fetch=lambda url: payload, ttl=9999)
    assert source.lookup_mid('SPX', date(2026, 8, 7), 'P', 7740) == 8.5


def _exec(**kwargs):
    defaults = dict(
        symbol='SPX 2026-08-06 7740 P',
        underlying_symbol='SPX',
        asset_class='OPT',
        strike=7740,
        expiry=date(2026, 8, 6),
        put_call='P',
        side='SELL',
        quantity=1,
        price=10.0,
        net_cash=1000.0,
        multiplier=100,
        is_open=True,
    )
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


def test_mark_trade_open_short_uses_mid_and_net_cash():
    """Short 1 put, collected $1000, mid 12 → MTM -1200 + 1000 = -200."""
    quotes = {'SPX 2026-08-06 7740 P': 12.0}
    result = mark_trade([_exec()], quotes)
    assert result['open_pnl'] == -200.0
    assert len(result['open_positions']) == 1
    assert result['open_positions'][0]['mid'] == 12.0
    assert result['open_positions'][0]['qty'] == 1
    assert result['open_positions'][0]['side'] == 'SELL'


def test_mark_trade_adds_closed_symbol_net_cash():
    open_leg = _exec()
    closed_leg_buy = _exec(
        symbol='SPX 2026-08-01 7700 P',
        strike=7700,
        expiry=date(2026, 8, 1),
        side='SELL',
        net_cash=800.0,
        is_open=True,
    )
    closed_leg_cover = _exec(
        symbol='SPX 2026-08-01 7700 P',
        strike=7700,
        expiry=date(2026, 8, 1),
        side='BUY',
        net_cash=-500.0,
        is_open=False,
    )
    quotes = {'SPX 2026-08-06 7740 P': 12.0}
    result = mark_trade([open_leg, closed_leg_buy, closed_leg_cover], quotes)
    # closed symbol net cash 300 + open MTM -200 = 100
    assert result['open_pnl'] == 100.0
    assert [p['symbol'] for p in result['open_positions']] == ['SPX 2026-08-06 7740 P']


def test_mark_trade_positions_include_description_and_per_position_open_pnl():
    """Each open position carries the security description and its own open
    P&L (all net cash for the symbol plus MTM of the remaining qty)."""
    open_leg = _exec(description='SPXW AUG 06 26 7740 PUT')
    # Partially closed: buy back 1 of 2 short puts
    cover = _exec(quantity=1, side='BUY', net_cash=-1100.0, is_open=False)
    open_leg_2 = _exec(quantity=2, net_cash=2000.0, is_open=True)
    quotes = {'SPX 2026-08-06 7740 P': 12.0}
    result = mark_trade([open_leg_2, cover], quotes)
    assert len(result['open_positions']) == 1
    pos = result['open_positions'][0]
    assert pos['description'] is None  # fixture execs have no description
    assert pos['open_pnl'] == 2000.0 - 1100.0 + (-1) * 12.0 * 100

    result = mark_trade([open_leg], quotes)
    assert result['open_positions'][0]['description'] == 'SPXW AUG 06 26 7740 PUT'
    assert result['open_positions'][0]['open_pnl'] == -200.0


def test_mark_trade_open_pnl_none_without_mid():
    result = mark_trade([_exec()], {})
    assert result['open_pnl'] is None
    assert result['open_positions'][0]['open_pnl'] is None
    assert result['open_positions'][0]['mid'] is None


def test_mark_trade_open_pnl_none_when_any_open_symbol_lacks_a_quote():
    """A quoted option does not make a trade P&L while the stock quote is missing."""
    stock = _exec(
        symbol='AAPL',
        underlying_symbol='AAPL',
        asset_class='STK',
        multiplier=1,
        quantity=10,
        price=40,
        net_cash=-400.0,
        strike=None,
        expiry=None,
        put_call=None,
        side='BUY',
    )
    option = _exec()
    result = mark_trade([stock, option], {option.symbol: 12.0})
    assert result['open_pnl'] is None
    by_symbol = {row['symbol']: row for row in result['open_positions']}
    assert by_symbol['AAPL']['mid'] is None
    assert by_symbol['AAPL']['open_pnl'] is None
    assert by_symbol[option.symbol]['open_pnl'] == -200.0


def test_equity_ticker_normalizes_class_shares():
    assert equity_ticker('aapl') == 'AAPL'
    assert equity_ticker('BRK.B') == 'BRK.B'
    assert equity_ticker('BRK B') == 'BRK.B'
    assert equity_ticker('BRK/B') == 'BRK.B'
    assert equity_ticker('brk-b') == 'BRK.B'
    assert equity_ticker('') is None
    assert equity_ticker('NOT A STOCK') is None


def test_equity_price_prefers_bid_ask_mid():
    assert equity_price({'bid': 10, 'ask': 12, 'current_price': 99}) == 11.0


def test_equity_price_falls_back_when_bid_ask_missing_or_zero():
    assert equity_price({'bid': 0, 'ask': None, 'current_price': 521.5, 'close': 500}) == 521.5
    assert equity_price({'close': 40}) == 40.0
    assert equity_price({}) is None


def test_cboe_stock_mid_uses_bid_ask_and_caches():
    calls = []

    def fake_fetch(url):
        calls.append(url)
        assert url.endswith('/quotes/AAPL.json')
        return {'data': {'bid': 10.0, 'ask': 12.0, 'current_price': 99.0}}

    source = CboeDelayedQuotesSource(fetch=fake_fetch, ttl=9999)
    assert source.lookup_stock_mid('aapl') == 11.0
    assert source.lookup_stock_mid('AAPL') == 11.0
    assert len(calls) == 1


def test_cboe_stock_class_share_requests_dotted_ticker():
    def fake_fetch(url):
        assert url.endswith('/quotes/BRK.B.json')
        return {'data': {'bid': 0, 'ask': None, 'current_price': 521.5}}

    source = CboeDelayedQuotesSource(fetch=fake_fetch, ttl=9999)
    assert source.lookup_stock_mid('BRK B') == 521.5
    assert source.lookup_stock_mid('BRK/B') == 521.5


def test_cboe_stock_lookup_returns_none_when_quote_fetch_fails():
    def fake_fetch(url):
        raise TimeoutError('upstream down')

    source = CboeDelayedQuotesSource(fetch=fake_fetch, ttl=9999)
    assert source.lookup_stock_mid('AAPL') is None


def test_quote_service_marks_stock_with_share_multiplier():
    class Source:
        def lookup_mid(self, underlying, expiry, put_call, strike):
            return 2.0

        def lookup_stock_mid(self, symbol):
            assert symbol == 'AAPL'
            return 50.0

    service = QuoteService(source=Source())
    stock = _exec(
        symbol='AAPL',
        underlying_symbol='AAPL',
        asset_class='STK',
        multiplier=1,
        quantity=10,
        price=40,
        net_cash=-400.0,
        strike=None,
        expiry=None,
        put_call=None,
        side='BUY',
    )
    option = _exec()
    cash = _exec(symbol='USD', asset_class='CASH', multiplier=1)
    quotes = service.mids_for_executions([stock, option, cash])
    assert quotes['AAPL'] == 50.0
    assert quotes[option.symbol] == 2.0
    assert quotes['USD'] is None

    marked = mark_trade([stock], quotes)
    assert marked['open_pnl'] == 100.0
    assert marked['open_positions'][0]['mid'] == 50.0
    assert marked['open_positions'][0]['multiplier'] == 1.0
