"""CBOE delayed-quotes source and OCC helpers."""

from datetime import date, datetime, timedelta
from urllib.error import URLError
from urllib.request import Request, urlopen
import json

INDEX_ROOTS = {'SPX', 'VIX', 'OEX', 'XSP', 'NDX', 'RUT', 'DJX', 'SPXW'}

OPTIONS_URL = 'https://cdn.cboe.com/api/global/delayed_quotes/options/{ticker}.json'
QUOTE_URL = 'https://cdn.cboe.com/api/global/delayed_quotes/quotes/{ticker}.json'


def to_occ(root, expiry, put_call, strike):
    """Build an OCC option symbol, e.g. SPX260806P07740000."""
    if expiry is None or strike is None or not put_call:
        return None
    if isinstance(expiry, str):
        expiry = date.fromisoformat(expiry[:10])
    root = (root or '').lstrip('^').upper()
    if not root:
        return None
    cp = put_call[0].upper()
    strike_int = int(round(float(strike) * 1000))
    return f"{root}{expiry.strftime('%y%m%d')}{cp}{strike_int:08d}"


def chain_ticker(underlying):
    """CBOE CDN ticker for an underlying (indexes use a leading underscore)."""
    root = (underlying or '').lstrip('^').upper()
    if not root:
        return None
    if root in INDEX_ROOTS or root in {'SPX', 'VIX'}:
        # SPXW lives on the SPX chain
        if root == 'SPXW':
            return '_SPX'
        return f'_{root}'
    return root


def mid_price(bid, ask):
    """Mid from bid/ask. Uses the available side if only one is present."""
    bid_ok = bid is not None
    ask_ok = ask is not None
    if bid_ok and ask_ok:
        return (float(bid) + float(ask)) / 2.0
    if bid_ok:
        return float(bid)
    if ask_ok:
        return float(ask)
    return None


def _http_get_json(url, timeout=20):
    request = Request(url, headers={'User-Agent': 'java-journal/1.0'})
    with urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode('utf-8'))


def equity_ticker(symbol):
    """CBOE equity ticker. Class shares use ROOT.X (BRK B, BRK/B, BRK-B)."""
    raw = (symbol or '').strip().upper()
    if not raw:
        return None
    for separator in (' ', '/', '-'):
        if separator not in raw:
            continue
        root, _, suffix = raw.rpartition(separator)
        root = root.strip().rstrip('.')
        suffix = suffix.strip()
        if root and len(suffix) == 1 and suffix.isalpha():
            raw = f'{root}.{suffix}'
        break
    if not raw or any(char.isspace() for char in raw):
        return None
    allowed = set('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.')
    if any(char not in allowed for char in raw):
        return None
    return raw


def _positive_price(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number > 0:
        return number
    return None


def equity_price(quote):
    """Bid/ask mid, then last, then previous close. Non-positive prices are ignored."""
    quote = quote or {}
    mid = mid_price(_positive_price(quote.get('bid')), _positive_price(quote.get('ask')))
    if mid is not None and mid > 0:
        return mid
    for key in ('current_price', 'close'):
        price = _positive_price(quote.get(key))
        if price is not None:
            return price
    return None


class CboeDelayedQuotesSource:
    """Fetches delayed option chains and equity quotes from CBOE's public JSON CDN."""

    def __init__(self, fetch=None, ttl=300):
        self._fetch = fetch or _http_get_json
        self._ttl = ttl
        self._cache = {}  # ticker -> (expires_at, occ -> row)
        self._quote_cache = {}  # ticker -> (expires_at, price or None)

    def _load_chain(self, ticker):
        now = datetime.utcnow()
        cached = self._cache.get(ticker)
        if cached and cached[0] > now:
            return cached[1]

        url = OPTIONS_URL.format(ticker=ticker)
        try:
            payload = self._fetch(url)
        except (URLError, TimeoutError, ValueError, json.JSONDecodeError):
            if cached:
                return cached[1]
            raise

        options = (payload or {}).get('data', {}).get('options') or []
        by_occ = {}
        for row in options:
            occ = row.get('option')
            if occ:
                by_occ[occ] = row

        self._cache[ticker] = (now + timedelta(seconds=self._ttl), by_occ)
        return by_occ

    def lookup_mid(self, underlying, expiry, put_call, strike):
        ticker = chain_ticker(underlying)
        if not ticker:
            return None
        try:
            chain = self._load_chain(ticker)
        except Exception:
            return None

        root = (underlying or '').lstrip('^').upper()
        candidates = [to_occ(root, expiry, put_call, strike)]
        if root == 'SPX':
            candidates.append(to_occ('SPXW', expiry, put_call, strike))
        elif root == 'SPXW':
            candidates.append(to_occ('SPX', expiry, put_call, strike))

        for occ in candidates:
            if not occ:
                continue
            row = chain.get(occ)
            if row:
                return mid_price(row.get('bid'), row.get('ask'))
        return None

    def _load_equity_quote(self, ticker):
        now = datetime.utcnow()
        cached = self._quote_cache.get(ticker)
        if cached and cached[0] > now:
            return cached[1]

        url = QUOTE_URL.format(ticker=ticker)
        try:
            payload = self._fetch(url)
        except (URLError, TimeoutError, ValueError, json.JSONDecodeError):
            if cached:
                return cached[1]
            raise

        price = equity_price((payload or {}).get('data'))
        self._quote_cache[ticker] = (now + timedelta(seconds=self._ttl), price)
        return price

    def lookup_stock_mid(self, symbol):
        """Delayed equity mid for a US-listed stock or ETF. None when unavailable."""
        ticker = equity_ticker(symbol)
        if not ticker:
            return None
        try:
            return self._load_equity_quote(ticker)
        except Exception:
            return None
