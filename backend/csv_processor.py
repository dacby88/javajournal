import logging
import pandas as pd
from datetime import datetime, date, time
from models import db, Execution, Position, Trade, ImportHistory, Account
import io
import json
import re
from timezone_utils import (
    normalize_to_eastern, 
    parse_datetime_with_timezone,
    get_account_timezone,
    get_broker_source_timezone
)

def _format_strike(strike_str, divisor):
    """Format strike by dividing and removing trailing zeros."""
    strike = int(strike_str)
    if divisor == 1:
        return str(strike)
    # divisor == 1000 (standard OCC multiplier for equity options)
    whole = strike // 1000
    rem = strike % 1000
    if rem == 0:
        return str(whole)
    decimal_str = str(rem).zfill(3).rstrip('0')
    return f"{whole}.{decimal_str}"


def _strip_futures_prefix(symbol):
    """Strip leading futures notation ('/' or './') from a symbol."""
    if not symbol or pd.isna(symbol):
        return symbol
    return re.sub(r'^[./]+', '', str(symbol).strip())


def _translate_value(value_mappings, field_name, value):
    """Translate CSV value to internal value using value_mappings.

    Supports exact string matches and simple numeric formulas:
      >0, <0, >=5, <=10, =42
    """
    if field_name not in value_mappings:
        return value

    str_value = str(value)
    field_mappings = value_mappings[field_name]

    # Exact match takes precedence
    if str_value in field_mappings:
        return field_mappings[str_value]

    # Try formula matches
    try:
        numeric_value = float(str_value.replace(',', ''))
    except (ValueError, TypeError):
        return value

    for formula, target in field_mappings.items():
        formula = str(formula).strip()
        if formula.startswith('>='):
            try:
                if numeric_value >= float(formula[2:]):
                    return target
            except (ValueError, TypeError):
                continue
        elif formula.startswith('<='):
            try:
                if numeric_value <= float(formula[2:]):
                    return target
            except (ValueError, TypeError):
                continue
        elif formula.startswith('>'):
            try:
                if numeric_value > float(formula[1:]):
                    return target
            except (ValueError, TypeError):
                continue
        elif formula.startswith('<'):
            try:
                if numeric_value < float(formula[1:]):
                    return target
            except (ValueError, TypeError):
                continue
        elif formula.startswith('='):
            try:
                if numeric_value == float(formula[1:]):
                    return target
            except (ValueError, TypeError):
                continue

    return value


def _raw_value_has_time(raw, datetime_format_hint=None):
    """True when a raw CSV datetime value contains a real time-of-day component."""
    if raw is None or pd.isna(raw):
        return False
    s = str(raw).strip()
    if not s or s == 'N/A':
        return False
    # IB format YYYYMMDD;HHMMSS
    if ';' in s:
        return bool(re.search(r';\d{4,6}', s))
    # ISO 8601 (2026-02-24T15:30:14+0000) or "YYYY-MM-DD 15:30:14" / "3/31/2026 9:30"
    return bool(re.search(r'[T ]\d{1,2}:\d{2}', s))


def detect_execution_timestamps(df, column_mappings, parser_config, broker_format_code=None):
    """True when the file's exec_datetime values carry real times (majority of rows).

    Some brokers (e.g. Schwab) only export dates; advanced timestamp matching
    is meaningless for those files.
    """
    if broker_format_code == 'schwab':
        return False  # Schwab is date-only; exec_datetime is synthesized at 9:30
    column_mappings = column_mappings or {}
    parser_config = parser_config or {}
    col = column_mappings.get('exec_datetime')
    if not col and 'Date/Time' in df.columns:
        col = 'Date/Time'  # IB default format
    if not col or col not in df.columns:
        return False
    hint = parser_config.get('datetime_format')
    total = with_time = 0
    for raw in df[col]:
        if raw is None or pd.isna(raw) or str(raw).strip() in ('', 'N/A'):
            continue
        total += 1
        if _raw_value_has_time(raw, hint):
            with_time += 1
    return total > 0 and with_time * 2 >= total  # majority of non-empty values have a time


def _calculate_open_quantity(executions):
    """
    Calculate the open quantity for a trade, accounting for spreads.

    For single-symbol trades: returns the net open position (absolute value).
    For multi-symbol trades (spreads): returns the GCD of per-symbol net open positions.
    """
    from math import gcd
    from functools import reduce

    if not executions:
        return 0

    # Normalize quantities by side (BUY positive, SELL negative) and group by symbol
    qty_by_symbol = {}
    for e in executions:
        qty = float(e.quantity) if e.quantity is not None else 0
        if e.side == 'SELL' and qty > 0:
            qty = -qty
        elif e.side == 'BUY' and qty < 0:
            qty = abs(qty)
        qty_by_symbol[e.symbol] = qty_by_symbol.get(e.symbol, 0) + qty

    # Take absolute net positions per symbol
    net_positions = [abs(pos) for pos in qty_by_symbol.values()]

    if len(net_positions) <= 1:
        return net_positions[0] if net_positions else 0

    # Multi-symbol trade (spread) - use GCD of absolute net positions
    int_positions = [int(round(p)) for p in net_positions if round(p) > 0]
    if not int_positions:
        return 0

    return float(reduce(gcd, int_positions))


def _normalize_execution_quantity(exec):
    """
    Normalize an execution's quantity so BUY is positive and SELL is negative.
    """
    qty = float(exec.quantity) if exec.quantity is not None else 0.0
    if exec.side == 'SELL' and qty > 0:
        return -qty
    elif exec.side == 'BUY' and qty < 0:
        return abs(qty)
    return qty


def _parse_compact_occ_symbol(symbol):
    """
    Parse a compact OCC option symbol (no spaces) into normalized components.

    Standard OCC format: UNDERLYING[1-6] YYMMDD C/P STRIKE*1000
    Examples:
      MU260702C01410000  -> ('MU', 2026-07-02, '01410000', 'C')
      MNQ260711P01425000 -> ('MNQ', 2026-07-11, '01425000', 'P')

    Returns (underlying, expiry_date, strike_str, put_call) or None.
    """
    if not symbol or pd.isna(symbol):
        return None

    s = str(symbol).strip().upper()
    # Allow 1-6 character underlying (OCC spec is 6 right-padded, but some
    # brokers strip padding). Strike is 8 digits with 3 implied decimals.
    pattern = r'^([A-Z]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$'
    match = re.match(pattern, s)
    if not match:
        return None

    sym, yy, mm, dd, cp, strike_str = match.groups()
    try:
        expiry = date(2000 + int(yy), int(mm), int(dd))
    except ValueError:
        return None

    return sym.strip(), expiry, strike_str, cp


def _derive_asset_class_from_symbol(symbol):
    """
    Derive Java Journal asset class from a symbol using OCC/futures heuristics.

    Rules (in priority order):
      1. OCC option symbol containing MNQ, NQ, MES, or ES -> FOP
      2. Any OCC option symbol                         -> OPT
      3. Non-OCC symbol containing MNQ, NQ, MES, or ES  -> FUT
      4. Symbol 2-4 characters long                     -> STK
      5. Otherwise                                      -> None
    """
    if not symbol or pd.isna(symbol):
        return None

    s = str(symbol).strip().upper()
    if not s:
        return None

    futures_codes = ('MNQ', 'NQ', 'MES', 'ES')
    occ_info = _parse_compact_occ_symbol(s)
    is_occ = occ_info is not None

    if is_occ:
        for code in futures_codes:
            if code in s:
                return 'FOP'
        return 'OPT'

    for code in futures_codes:
        if code in s:
            return 'FUT'

    if 2 <= len(s) <= 4:
        return 'STK'

    return None


def _extract_option_details_from_normalized_symbol(symbol):
    """
    Extract underlying, expiry, strike, and put/call from a normalized option symbol.

    Normalized format: SYMBOL YYYY-MM-DD STRIKE C/P
    Returns (underlying, expiry_date, strike, put_call) or None.
    """
    if not symbol or pd.isna(symbol):
        return None

    s = str(symbol).strip().upper()
    pattern = r'^([^ ]+) (\d{4}-\d{2}-\d{2}) (\d+(?:\.\d+)?) ([CP])$'
    match = re.match(pattern, s)
    if not match:
        return None

    sym, expiry_str, strike_str, cp = match.groups()
    try:
        expiry = datetime.strptime(expiry_str, '%Y-%m-%d').date()
        strike = float(strike_str)
    except ValueError:
        return None

    return sym, expiry, strike, cp


def _generate_option_description(normalized_symbol):
    """
    Generate a consistent option description from a normalized option symbol.

    Normalized format: SYMBOL YYYY-MM-DD STRIKE C/P
    Example: "MU 2026-07-02 1410 C" -> "MU 2026-07-02 1410.00 Call"
    Returns None if the symbol is not a normalized option symbol.
    """
    details = _extract_option_details_from_normalized_symbol(normalized_symbol)
    if not details:
        return None

    underlying, expiry, strike, cp = details
    put_call_word = 'Call' if cp == 'C' else 'Put'
    # Format without commas or currency symbols
    strike_str = f"{strike:.2f}"
    expiry_str = expiry.isoformat()
    return f"{underlying} {expiry_str} {strike_str} {put_call_word}"


def normalize_option_symbol(symbol):
    """
    Normalize option symbols from various broker formats to:
    SYMBOL YYYY-MM-DD STRIKE C/P
    
    Handles:
    - Compact OCC:   SYMBOLYYMMDDCPSTRIKE (e.g., MU260702C01410000)
    - IB/TastyTrade: SYMBOL YYMMDD[CP]STRIKE (e.g., AMD 260529P00410000)
    - Schwab:        SYMBOL MM/DD/YYYY STRIKE [CP] (e.g., MU 05/29/2026 1400.00 C)
    
    Strips leading futures notation ('/' or './') from the returned symbol.
    """
    if not symbol or pd.isna(symbol):
        return symbol
    
    raw_symbol = str(symbol).strip()
    is_futures_opt = raw_symbol.startswith('./')
    symbol = _strip_futures_prefix(symbol)
    
    # Compact OCC format: SYMBOLYYMMDDCPSTRIKE (no spaces)
    occ = _parse_compact_occ_symbol(symbol)
    if occ:
        sym, expiry, strike_str, cp = occ
        sym = _strip_futures_prefix(sym)
        strike = _format_strike(strike_str, 1000)
        return f"{sym} {expiry.isoformat()} {strike} {cp}"
    
    # IB / TastyTrade format: SYMBOL YYMMDD[CP]STRIKE
    ib_pattern = r'^([^ ]+) (\d{2})(\d{2})(\d{2})([CP])(\d+)$'
    ib_match = re.match(ib_pattern, symbol)
    if ib_match:
        sym, yy, mm, dd, cp, strike_str = ib_match.groups()
        sym = _strip_futures_prefix(sym)
        # Futures options (original ./ prefix) use multiplier 1; equity options use 1000
        divisor = 1 if is_futures_opt else 1000
        strike = _format_strike(strike_str, divisor)
        return f"{sym} 20{yy}-{mm}-{dd} {strike} {cp}"
    
    # Schwab format: SYMBOL MM/DD/YYYY STRIKE [CP]
    schwab_pattern = r'^([^ ]+) (\d{1,2}/\d{1,2}/\d{4}) (\d+(?:\.\d+)?) ([CP])$'
    schwab_match = re.match(schwab_pattern, symbol)
    if schwab_match:
        sym, expiry_str, strike, cp = schwab_match.groups()
        sym = _strip_futures_prefix(sym)
        try:
            expiry = datetime.strptime(expiry_str, '%m/%d/%Y').date()
            return f"{sym} {expiry.isoformat()} {strike} {cp}"
        except ValueError:
            pass
    
    return symbol


def _determine_trade_side(entry_execs):
    """
    Determine trade side (LONG/SHORT) from the initial entry executions.

    The side is defined solely by the executions on the earliest execution
    date: among those, the execution with the largest absolute price is the
    defining leg — BUY means LONG, SELL means SHORT. Executions added later
    (rolls, scaling in, combining trades) never change the side.
    """
    if not entry_execs:
        return 'LONG'

    def exec_day(e):
        if e.exec_datetime:
            return e.exec_datetime.date()
        return e.trade_date or date.min

    earliest_day = min(exec_day(e) for e in entry_execs)
    initial_execs = [e for e in entry_execs if exec_day(e) == earliest_day]
    defining = max(initial_execs, key=lambda e: abs(float(e.price or 0)))
    return 'LONG' if defining.side == 'BUY' else 'SHORT'


def _generate_trade_description(executions):
    """
    Auto-generate a trade description based on the spread structure.
    
    Examples:
        "AMD 2026-05-22 510C/500C Call Spread"
        "SPY 2026-03-15 590P/580P Put Spread"
        "AAPL 2026-06-18 120C/110C/100C Butterfly"
        "XYZ 2026-05-22 115/110/105/100 Condor"
        "XYZ 2026-05-22 200 Straddle"
        "AMD 2026-05-22 510C/500C Call Spread + NVDA 2026-05-22 210P/200P Put Spread"
    """
    if not executions:
        return None

    executions = [
        e for e in executions
        if getattr(e, 'is_open', None) is not False
    ]
    if not executions:
        return None
    
    # Collect option info from all executions
    options = []
    for e in executions:
        if e.asset_class in ('OPT', 'FOP') and e.strike is not None and e.expiry is not None:
            options.append({
                'strike': float(e.strike),
                'expiry': e.expiry,
                'put_call': (e.put_call or 'C').upper(),
                'underlying': (e.underlying_symbol or '').upper(),
                'qty': abs(float(e.quantity or 0)),
                'side': e.side,
                'price': float(e.price) if e.price is not None else 0,
            })
    
    if not options:
        # Stock trade or missing data - return underlying
        underlying = executions[0].underlying_symbol or executions[0].symbol or ''
        return underlying if underlying else None
    
    # Group options by (underlying, expiry)
    groups = {}
    for o in options:
        key = (o['underlying'], o['expiry'])
        if key not in groups:
            groups[key] = []
        groups[key].append(o)
    
    # Generate description for each group, highest traded price first
    descriptions = []
    for (underlying, expiry), group_options in sorted(
        groups.items(),
        key=lambda item: (
            -max((abs(o.get('price', 0) or 0) for o in item[1]), default=0),
            item[0][0] or '',
            str(item[0][1] or ''),
        ),
    ):
        desc = _generate_group_description(underlying, expiry, group_options)
        if desc:
            descriptions.append(desc)
    
    if not descriptions:
        return None
    
    return ' + '.join(descriptions)


def _generate_group_description(underlying, expiry, options):
    """Generate description for a single group of options with same underlying and expiry."""
    expiry_str = expiry.strftime('%Y-%m-%d') if hasattr(expiry, 'strftime') else str(expiry)
    
    # Collect unique (strike, put_call) combinations with their total quantities
    strike_types = {}  # (strike, put_call) -> total_qty
    for o in options:
        key = (o['strike'], o['put_call'])
        strike_types[key] = strike_types.get(key, 0) + o['qty']
    
    put_calls_present = set(pc for (_, pc) in strike_types.keys())
    unique_strikes_asc = sorted(set(s for (s, _) in strike_types.keys()))
    
    # Sort strikes by highest execution price first (regardless of buy/sell)
    strike_max_price = {}
    for o in options:
        strike_max_price[o['strike']] = max(strike_max_price.get(o['strike'], 0), abs(o.get('price', 0)))
    unique_strikes_desc = sorted(
        set(s for (s, _) in strike_types.keys()),
        key=lambda s: strike_max_price.get(s, 0),
        reverse=True
    )
    
    has_calls = 'C' in put_calls_present
    has_puts = 'P' in put_calls_present
    
    # Detect spread type (uses ascending order for butterfly logic)
    spread_type = _detect_spread_type(strike_types, unique_strikes_asc, put_calls_present)
    
    # Format strike labels in descending order (highest price first)
    strike_labels = []
    for strike in unique_strikes_desc:
        strike_opts = sorted([pc for (s, pc) in strike_types.keys() if s == strike])
        for pc in strike_opts:
            suffix = 'C' if pc == 'C' else 'P'
            strike_labels.append(f"{strike:g}{suffix}")
    
    strikes_str = '/'.join(strike_labels)
    
    return f"{underlying} {expiry_str} {strikes_str} {spread_type}"


def _detect_spread_type(strike_types, unique_strikes, put_calls_present):
    """
    Detect spread type from option strike/put_call structure.
    
    Args:
        strike_types: dict of (strike, put_call) -> total_qty
        unique_strikes: sorted list of unique strike prices
        put_calls_present: set of put_call values present
    """
    num_strikes = len(unique_strikes)
    has_calls = 'C' in put_calls_present
    has_puts = 'P' in put_calls_present
    
    # Mixed calls and puts
    if has_calls and has_puts:
        if num_strikes == 1:
            return "Straddle"
        elif num_strikes == 2:
            return "Strangle"
        elif num_strikes == 4:
            return "Iron Condor"
        elif num_strikes == 3:
            return "Iron Butterfly"
        else:
            return "Combo"
    
    # Same type (all calls or all puts)
    type_label = "Call" if has_calls else "Put"
    
    if num_strikes == 1:
        return "Single Option"
    elif num_strikes == 2:
        return f"{type_label} Spread"
    elif num_strikes == 3:
        # Check for butterfly pattern: middle strike qty = 2x outer strikes
        outer_qty = [strike_types.get((unique_strikes[i], list(put_calls_present)[0]), 0) for i in [0, 2]]
        middle_qty = strike_types.get((unique_strikes[1], list(put_calls_present)[0]), 0)
        if outer_qty and middle_qty > 0 and abs(middle_qty - 2 * outer_qty[0]) < 0.01:
            return "Butterfly"
        return f"3-Leg {type_label} Spread"
    elif num_strikes == 4:
        return "Condor"
    else:
        return f"{num_strikes}-Leg {type_label} Spread"


def _net_price(exec_list, is_exit=False):
    """Calculate net price for a list of executions.
    
    For entry (is_exit=False):  BUY weighted avg - SELL weighted avg
    For exit  (is_exit=True):   SELL weighted avg - BUY weighted avg
    
    This gives the true net debit/credit for spreads:
    - Long call spread entry (Buy $50 @ $5, Sell $55 @ $2) -> $5 - $2 = $3 debit
    - Short call spread entry (Sell $50 @ $5, Buy $55 @ $2) -> $2 - $5 = -$3 credit
    """
    buy_execs = [e for e in exec_list if e.side == 'BUY']
    sell_execs = [e for e in exec_list if e.side == 'SELL']
    
    buy_qty = sum(abs(float(e.quantity or 0)) for e in buy_execs)
    sell_qty = sum(abs(float(e.quantity or 0)) for e in sell_execs)
    
    buy_avg = (sum(float(e.price or 0) * abs(float(e.quantity or 0)) for e in buy_execs) / buy_qty) if buy_qty > 0 else 0
    sell_avg = (sum(float(e.price or 0) * abs(float(e.quantity or 0)) for e in sell_execs) / sell_qty) if sell_qty > 0 else 0
    
    if is_exit:
        return sell_avg - buy_avg
    return buy_avg - sell_avg


def parse_java_journal_datetime(dt_str, source_timezone='America/New_York'):
    """
    Parse Interactive Brokers datetime format: 20251031;152445
    Normalizes to Eastern Time.
    """
    if pd.isna(dt_str) or dt_str == '' or dt_str == 'N/A':
        return None
    try:
        # Format: YYYYMMDD;HHMMSS
        if ';' in str(dt_str):
            date_part, time_part = str(dt_str).split(';')
            year = int(date_part[:4])
            month = int(date_part[4:6])
            day = int(date_part[6:8])
            hour = int(time_part[:2])
            minute = int(time_part[2:4])
            second = int(time_part[4:6]) if len(time_part) >= 6 else 0
            dt = datetime(year, month, day, hour, minute, second)
            # Normalize to Eastern Time
            return normalize_to_eastern(dt, source_timezone)
        return None
    except Exception:
        return None

def parse_java_journal_date(date_str):
    """Parse Interactive Brokers date format: 20251031"""
    if pd.isna(date_str) or date_str == '' or date_str == 'N/A':
        return None
    try:
        date_str = str(date_str).strip()
        year = int(date_str[:4])
        month = int(date_str[4:6])
        day = int(date_str[6:8])
        return date(year, month, day)
    except Exception:
        return None

def parse_numeric(value):
    """Parse numeric value, handling empty strings and special values"""
    if pd.isna(value) or value == '' or value == 'N/A':
        return 0
    try:
        return float(value)
    except (ValueError, TypeError):
        return 0

def get_option_underlying(symbol):
    """Extract underlying symbol from option symbol, stripping futures notation."""
    # SPXW  251031C06880000 -> SPXW
    # Format is typically: UNDERLYING  YYMMDDC/PSTRIKE
    symbol = _strip_futures_prefix(symbol)
    if ' ' in symbol:
        return symbol.split()[0].strip()
    return symbol

def extract_futures_underlying(symbol):
    """
    Extract the futures root/underlying symbol from a futures or futures-option symbol.

    Tastytrade futures:        /MNQM6       -> MNQ
                               /ESH5        -> ES
                               /MESM4       -> MES
    Tastytrade futures options: ./MNQH6D4BG6 -> MNQ

    The root is the 2-3 characters before the expiry month code and year.
    Any leading '/' or './' is stripped before returning.
    """
    if not symbol or pd.isna(symbol):
        return None

    s = _strip_futures_prefix(symbol)
    if s:
        s = s.upper()

    # Match the root (2-3 chars) optionally followed by a month code + 1-2 digit year
    m = re.match(r'^([A-Z0-9]{2,3})(?:[FGHJKMNQUVXZ]\d{1,2})', s)
    if m:
        return m.group(1)

    # No expiry code present; just return the cleaned symbol (e.g. "/MNQ" -> "MNQ")
    return s


# Hardcoded futures contract multipliers ($ per point) shared by all import paths.
FUT_MULTIPLIERS = {
    'ES': 50,
    'MES': 5,
    'NQ': 20,
    'MNQ': 2,
}


def _prefixed_futures_root(symbol):
    """
    Return the futures root code for a symbol carrying a futures prefix
    ('.' or '/', e.g. './MNQH6D4BG6' or '/ESH6'), or None if unprefixed
    or the root is not in FUT_MULTIPLIERS.
    """
    if not symbol or pd.isna(symbol):
        return None
    s = str(symbol).strip()
    if not s.startswith(('.', '/')):
        return None
    s = _strip_futures_prefix(s)
    # Whole string first (compact formats like MNQH6D4BG6), then the first token
    # (space-separated formats like 'MNQ 04/02/2026 225.00 C')
    candidates = [s]
    if ' ' in s:
        candidates.append(s.split()[0])
    for candidate in candidates:
        root = extract_futures_underlying(candidate)
        if root and root in FUT_MULTIPLIERS:
            return root
    return None


def determine_multiplier(asset_class=None, underlying=None, symbol=None, csv_multiplier=None):
    """
    Unified contract multiplier determination for all import paths.

    Priority:
      1. Futures symbols prefixed with '.' or '/' (e.g. ./MNQH6D4BG6, /ESH6):
         the hardcoded FUT_MULTIPLIERS lookup wins, even over the CSV column —
         some brokers (tastytrade) wrongly report multiplier 1 for futures options.
      2. A valid broker-provided multiplier column (> 0).
      3. Asset-class fallback:
           FUT/FOP/Future        -> lookup by underlying/symbol root, default 1
           OPT                   -> 100
           STK                   -> 1
           unknown/blank         -> futures root lookup, then 100 (equity option default)

    `symbol` should be the raw CSV symbol (prefix intact) when available.
    """
    # 1. Prefixed futures symbols: hardcoded lookup is authoritative
    for candidate in (symbol, underlying):
        root = _prefixed_futures_root(candidate)
        if root:
            return FUT_MULTIPLIERS[root]

    # 2. Broker-provided multiplier column
    if csv_multiplier and csv_multiplier > 0:
        return csv_multiplier

    asset_class = (asset_class or '').strip().upper()

    # 3a. Futures asset classes without a prefix: look up the root
    if asset_class in ('FUT', 'FOP', 'FUTURE', 'FUTURE OPTION'):
        for candidate in (underlying, symbol):
            root = extract_futures_underlying(candidate)
            if root and root in FUT_MULTIPLIERS:
                return FUT_MULTIPLIERS[root]
        return 1  # Unknown futures contract

    # 3b. Equity option / stock
    if asset_class == 'OPT':
        return 100
    if asset_class == 'STK':
        return 1

    # 3c. Unknown asset class: try a futures root match, else assume equity option
    for candidate in (underlying, symbol):
        root = extract_futures_underlying(candidate)
        if root and root in FUT_MULTIPLIERS:
            return FUT_MULTIPLIERS[root]
    return 100

# IB execution reports fold all broker/clearing/third-party commissions into the
# 'Commission' column. Regulatory and other fees are reported in separate columns
# and are summed into the total commission on import.
IB_FEE_COLUMNS = (
    'RegFINRATradingActivityFee',
    'RegSection31TransactionFee',
    'RegOther',
    'OtherCommission',
)

def process_java_journal_csv(file_content, filename, account_id, selected_row_indices=None):
    """
    Process Interactive Brokers execution report CSV
    
    Expected columns (Interactive Brokers format):
    - ClientAccountID
    - Symbol, Description, AssetClass
    - UnderlyingSymbol, Strike, Expiry, Put/Call, Multiplier
    - TradeID, OrderID, ExecID, TransactionType
    - TradeDate, Date/Time, SettleDate
    - Buy/Sell, Quantity, Price, Amount, Proceeds
    - NetCash
    - Commission (includes all broker/clearing/third-party commissions)
    - RegFINRATradingActivityFee, RegSection31TransactionFee, RegOther, OtherCommission
      (summed into Commission on import)
    - CommissionCurrency
    - Exchange
    """
    # Fetch account for fallback values and timezone
    account = Account.query.get(account_id)
    account_name = account.name if account else None
    account_number = account.account_number if account else None
    account_fallback = account_number if account_number else account_name
    
    # IB timestamps are in Eastern Time by default
    source_timezone = get_broker_source_timezone('ib')
    target_timezone = get_account_timezone(account)
    
    # Create import record
    import_record = ImportHistory(
        account_id=account_id,
        filename=filename,
        file_size=len(file_content) if isinstance(file_content, bytes) else len(file_content.encode()),
        status='pending'
    )
    db.session.add(import_record)
    db.session.commit()

    try:
        # Read CSV
        if isinstance(file_content, bytes):
            file_content = file_content.decode('utf-8')
        
        df = pd.read_csv(io.StringIO(file_content))
        
        # Normalize column names (strip spaces, lowercase)
        df.columns = [col.strip() for col in df.columns]
        
        executions_added = 0
        errors = []
        
        for idx, row in df.iterrows():
            # Skip rows not selected by user
            if selected_row_indices is not None and int(idx) not in selected_row_indices:
                continue
            try:
                # Skip rows that look like headers or empty rows
                if pd.isna(row.get('Symbol')) or str(row.get('Symbol')).strip() == '':
                    continue
                
                # Parse trade date (required)
                trade_date = parse_java_journal_date(row.get('TradeDate'))
                if not trade_date:
                    errors.append(f'Row {idx + 1}: Missing or invalid TradeDate')
                    continue
                
                # Parse side
                side = str(row.get('Buy/Sell', '')).strip().upper()
                if side not in ['BUY', 'SELL']:
                    errors.append(f'Row {idx + 1}: Invalid Buy/Sell value: {side}')
                    continue
                
                # Parse quantity and normalize sign based on side
                # IB CSV already has signed quantities, but normalize for consistency
                quantity = parse_numeric(row.get('Quantity'))
                if side == 'SELL':
                    quantity = -abs(quantity)
                else:
                    quantity = abs(quantity)
                
                price = parse_numeric(row.get('Price'))
                
                if quantity == 0:
                    errors.append(f'Row {idx + 1}: Zero quantity')
                    continue
                
                # Get symbol and description
                raw_symbol = str(row.get('Symbol', '')).strip()
                symbol = normalize_option_symbol(raw_symbol)
                description = str(row.get('Description', '')).strip()
                # Generate a consistent option description when the symbol is normalized
                generated_desc = _generate_option_description(symbol)
                if generated_desc:
                    description = generated_desc
                
                # Parse option details
                strike = parse_numeric(row.get('Strike'))
                expiry = parse_java_journal_date(row.get('Expiry'))
                put_call = str(row.get('Put/Call', '')).strip().upper() if pd.notna(row.get('Put/Call')) else None

                underlying = _strip_futures_prefix(str(row.get('UnderlyingSymbol', '')).strip())
                if not underlying:
                    underlying = get_option_underlying(symbol)

                asset_class = str(row.get('AssetClass', '')).strip()

                multiplier = determine_multiplier(
                    asset_class, underlying, raw_symbol,
                    csv_multiplier=parse_numeric(row.get('Multiplier')),
                )
                
                # Skip CASH entries (deposits, withdrawals, dividends, etc.)
                if asset_class == 'CASH':
                    continue
                
                # Parse commissions
                # IB folds all broker/clearing/third-party commissions into 'Commission';
                # regulatory and other fees are separate columns and summed in.
                # Commissions/fees in CSV are negative (costs), store as positive for consistency
                commission = abs(parse_numeric(row.get('Commission')))
                commission += sum(abs(parse_numeric(row.get(col))) for col in IB_FEE_COLUMNS)
                
                # Older IB exports put commissions in BrokerExecutionCommission when Commission was 0
                if commission == 0:
                    commission = abs(parse_numeric(row.get('BrokerExecutionCommission')))
                
                # Parse financials
                amount = parse_numeric(row.get('Amount'))
                proceeds = parse_numeric(row.get('Proceeds'))
                net_cash = parse_numeric(row.get('NetCash'))
                
                # Parse timestamps (IB timestamps are in Eastern Time)
                exec_datetime = parse_java_journal_datetime(row.get('Date/Time'), source_timezone)
                order_time = parse_java_journal_datetime(row.get('OrderTime'), source_timezone)
                settle_date = parse_java_journal_date(row.get('SettleDate'))
                
                # Parse IDs
                trade_id = str(row.get('TradeID', '')).strip() if pd.notna(row.get('TradeID')) else None
                order_id = str(row.get('OrderID', '')).strip() if pd.notna(row.get('OrderID')) else None
                exec_id = str(row.get('ExecID', '')).strip() if pd.notna(row.get('ExecID')) else None
                # Handle NaN values that become string 'nan'
                if exec_id and exec_id.lower() == 'nan':
                    exec_id = None
                if trade_id and trade_id.lower() == 'nan':
                    trade_id = None
                
                # Parse additional info
                transaction_type = str(row.get('TransactionType', '')).strip()
                exchange = str(row.get('Exchange', '')).strip()
                commission_currency = str(row.get('CommissionCurrency', '')).strip()
                currency = str(row.get('CurrencyPrimary', '')).strip()
                client_account_id = str(row.get('ClientAccountID', '')).strip()
                
                # Handle NaN values that become string 'nan'
                if client_account_id.lower() == 'nan':
                    client_account_id = ''
                
                # Check if client_account_id is masked/obscured (contains * or X for security)
                # IB sometimes masks account IDs with ***** or XXXXX
                is_masked = client_account_id and ('*' in client_account_id or 
                                                    all(c == 'X' for c in client_account_id if c.isalpha()))
                
                # Use account number/name as fallback if CSV doesn't have client_id OR if masked
                if (not client_account_id or is_masked) and account_fallback:
                    client_account_id = account_fallback
                # IB exports no longer include AccountAlias; fall back to the account name
                account_alias = account_name if account_name else ''
                
                # Check for duplicate execution by TradeID + TradeDate (primary unique identifier from IB)
                # Both fields together uniquely identify an IB execution
                if trade_id and trade_date:
                    existing_by_trade_id = Execution.query.filter(
                        Execution.trade_id == trade_id,
                        Execution.trade_date == trade_date,
                        Execution.account_id == account_id
                    ).first()
                    if existing_by_trade_id:
                        continue  # Skip duplicate by TradeID + TradeDate
                
                # Secondary check: ExecID (only if present and valid)
                if exec_id and exec_id.lower() != 'nan':
                    existing = Execution.query.filter_by(exec_id=exec_id).first()
                    if existing:
                        continue  # Skip duplicate
                
                # Create execution record
                execution = Execution(
                    client_account_id=client_account_id,
                    account_alias=account_alias,
                    symbol=symbol,
                    description=description,
                    asset_class=asset_class,
                    underlying_symbol=underlying,
                    strike=strike,
                    expiry=expiry,
                    put_call=put_call,
                    multiplier=multiplier,
                    trade_id=trade_id,
                    order_id=order_id,
                    exec_id=exec_id,
                    import_id=import_record.id,  # Track which import this execution belongs to
                    transaction_type=transaction_type,
                    side=side,
                    quantity=quantity,
                    price=price,
                    amount=amount,
                    proceeds=proceeds,
                    net_cash=net_cash,
                    commission=commission,
                    commission_currency=commission_currency,
                    currency=currency,
                    trade_date=trade_date,
                    exec_datetime=exec_datetime,
                    order_time=order_time,
                    settle_date=settle_date,
                    exchange=exchange,
                    account_id=account_id,  # ADD THIS
                )
                
                db.session.add(execution)
                executions_added += 1
                
            except Exception as e:
                errors.append(f'Row {idx + 1}: {str(e)}')
                continue
        
        db.session.commit()
        # Update import record
        import_record.executions_count = executions_added
        import_record.status = 'success' if not errors else 'partial'
        # After importing executions, process trades (match opens and closes)
        trade_summary = None
        if executions_added > 0:
            trade_summary = process_executions_into_trades(account_id)
        
        # Recalculate stats so dashboard/calendar reflect the new data
        try:
            from stats_calculator import (
                calculate_daily_stats_for_account,
                calculate_hourly_stats_for_account,
                calculate_overall_stats_for_account
            )
            calculate_daily_stats_for_account(account_id)
            calculate_hourly_stats_for_account(account_id)
            calculate_overall_stats_for_account(account_id)
        except Exception as e:
            import traceback
            logging.getLogger(__name__).debug(f"Error recalculating stats after import: {e}")
            traceback.print_exc()
        
        result = {
            'success': True,
            'import_id': import_record.id,
            'executions_added': executions_added,
            'total_rows': len(df),
            'errors': errors[:20]  # Return first 20 errors
        }
        if trade_summary:
            result['trade_processing'] = trade_summary
        return result
        
    except Exception as e:
        db.session.rollback()
        import_record.status = 'error'
        import_record.error_message = str(e)
        db.session.commit()
        return {
            'success': False,
            'error': str(e),
            'import_id': import_record.id
        }


# ============================================================================
# SCHWAB CSV PROCESSOR
# ============================================================================

def parse_schwab_date(date_str):
    """
    Parse Schwab date field.
    Format examples:
      "03/31/2026" → trade_date=03/31/2026
      "03/30/2026 as of 03/27/2026" → trade_date=03/27/2026
    
    Returns: trade_date
    """
    if pd.isna(date_str) or date_str == '' or date_str == 'N/A':
        return None
    
    try:
        date_str = str(date_str).strip()
        
        if ' as of ' in date_str:
            # Split on " as of " - use RIGHT date for trade_date
            _, right_date_str = date_str.split(' as of ')
            trade_date = datetime.strptime(right_date_str.strip(), '%m/%d/%Y').date()
        else:
            trade_date = datetime.strptime(date_str, '%m/%d/%Y').date()
        
        return trade_date
    except Exception:
        return None


def detect_schwab_asset_class(description):
    """
    Determine asset class and put_call from description.

    Returns: (asset_class, put_call)
    """
    if pd.isna(description) or description == '':
        return 'STK', None

    description_upper = str(description).upper()

    if 'CALL' in description_upper:
        return 'OPT', 'C'
    elif 'PUT' in description_upper:
        return 'OPT', 'P'
    else:
        return 'STK', None


def extract_schwab_underlying(symbol):
    """
    Extract underlying symbol (first word before space), stripping futures notation.
    
    Examples:
      "USO 04/02/2026 225.00 C" → "USO"
      "META" → "META"
      "./MNQ 04/02/2026 225.00 C" → "MNQ"
    """
    if pd.isna(symbol) or symbol == '':
        return ''
    
    symbol = _strip_futures_prefix(str(symbol).strip())
    if ' ' in symbol:
        return symbol.split()[0].strip()
    return symbol


def parse_schwab_option_details(symbol):
    """
    Parse option details from Schwab symbol format.
    Format: UNDERLYING MM/DD/YYYY STRIKE.TYPE
    Example: "USO 04/02/2026 225.00 C"
    
    Returns: dict with expiry, strike or None if not an option symbol
    """
    if pd.isna(symbol) or symbol == '':
        return None
    
    symbol = str(symbol).strip()
    
    # Pattern: UNDERLYING MM/DD/YYYY STRIKE.TYPE (e.g., 04/02/2026 or 04/2/2026)
    option_pattern = r'^(\S+)\s+(\d{1,2}/\d{1,2}/\d{4})\s+(\d+(?:\.\d+)?)\s+([CP])$'
    
    match = re.match(option_pattern, symbol)
    if match:
        underlying, expiry_str, strike, put_call = match.groups()
        try:
            expiry = datetime.strptime(expiry_str, '%m/%d/%Y').date()
            return {
                'underlying': underlying,
                'expiry': expiry,
                'strike': float(strike),
                'put_call': put_call
            }
        except Exception:
            return None
    return None


def parse_schwab_numeric(value):
    """Parse numeric value from Schwab CSV, handling $ and commas."""
    if pd.isna(value) or value == '' or value == 'N/A':
        return 0.0
    
    try:
        # Remove $, commas, and whitespace
        cleaned = str(value).replace('$', '').replace(',', '').strip()
        if cleaned == '' or cleaned == '--':
            return 0.0
        return float(cleaned)
    except (ValueError, TypeError):
        return 0.0


def get_schwab_transaction_type(action):
    """Map Schwab action to transaction type.
    
    Uses substring matching (case-insensitive):
    - Any action containing 'BUY' or 'SELL' -> BookTrade
    - Any action containing 'EXPIRED' -> Expiration
    - Any action containing 'ASSIGNED' -> Assignment
    - Any action containing 'EXCHANGE' -> Exchange
    - Any action containing 'EXERCISE' -> Exercise
    """
    if not action or pd.isna(action):
        return None
    
    action_str = str(action).strip().upper()
    
    # Check for BUY or SELL anywhere in the action (catches Buy, Selling, Rebought, etc.)
    if 'BUY' in action_str or 'SELL' in action_str:
        return 'BookTrade'
    elif 'EXPIRED' in action_str:
        return 'Expiration'
    elif 'ASSIGNED' in action_str:
        return 'Assignment'
    elif 'EXCHANGE' in action_str:
        return 'Exchange'
    elif 'EXERCISE' in action_str:
        return 'Exercise'
    return None


def process_schwab_csv(file_content, filename, account_id, selected_row_indices=None, manual_matching=False):
    """
    Process Charles Schwab transaction history CSV format.
    
    Expected columns:
    - Date: Trade date (may include "as of" format)
    - Action: Transaction type (Buy to Open, Sell to Close, Expired, etc.)
    - Symbol: Option symbol with expiry/strike or stock symbol
    - Description: Full instrument description
    - Quantity: Number of contracts/shares
    - Price: Execution price
    - Fees & Comm: Total commissions and fees
    - Amount: Net amount
    """
    from models import BrokerFormat
    
    # Get account for timezone info and fallback values
    account = Account.query.get(account_id)
    account_name = account.name if account else None
    account_number = account.account_number if account else None
    account_fallback = account_number if account_number else account_name
    
    # Create import record
    import_record = ImportHistory(
        account_id=account_id,
        filename=filename,
        file_size=len(file_content) if isinstance(file_content, bytes) else len(file_content.encode()),
        status='pending'
    )
    db.session.add(import_record)
    db.session.commit()
    
    # List of actions to skip (non-trade transactions)
    skip_actions = [
        'Bank Interest', 'Wire Sent', 'Wire Received', 'Service Fee', 'Misc Cash Entry',
        'Security Transfer', 'ACAT', 'Dividend', 'Journal', 'Deposit', 'Withdrawal',
        'Credit Interest', 'Mark to Market', 'Balance Adjustment', 'Transfer'
    ]
    
    try:
        # Decode file content if needed
        if isinstance(file_content, bytes):
            file_content = file_content.decode('utf-8-sig')  # Handle BOM
        
        # Read CSV
        df = pd.read_csv(io.StringIO(file_content))
        
        # Normalize column names (strip spaces)
        df.columns = [col.strip() for col in df.columns]
        
        executions_added = 0
        errors = []
        
        for idx, row in df.iterrows():
            # Skip rows not selected by user
            if selected_row_indices is not None and int(idx) not in selected_row_indices:
                continue
            try:
                # Get action and check if we should skip
                action = str(row.get('Action', '')).strip()
                
                # Skip non-trade transactions (case-insensitive)
                action_upper = action.upper()
                if any(skip.upper() in action_upper for skip in skip_actions):
                    continue
                
                # Get symbol and description
                symbol = str(row.get('Symbol', '')).strip()
                description = str(row.get('Description', '')).strip()
                
                if not symbol or symbol == 'nan':
                    continue
                
                # Detect asset class from original description
                # (symbol is still raw here, so futures prefixes inform the multiplier)
                asset_class, put_call = detect_schwab_asset_class(description)
                multiplier = determine_multiplier(
                    asset_class, extract_schwab_underlying(symbol), symbol,
                )
                
                # Parse option details from Schwab symbol format before normalization
                strike = None
                expiry = None
                option_details = parse_schwab_option_details(symbol)
                if option_details:
                    strike = option_details['strike']
                    expiry = option_details['expiry']
                    if option_details['put_call']:
                        put_call = option_details['put_call']
                
                # Normalize symbol to consistent format and regenerate description
                symbol = normalize_option_symbol(symbol)
                generated_desc = _generate_option_description(symbol)
                if generated_desc:
                    description = generated_desc
                
                # Extract underlying (first word of normalized symbol)
                underlying = extract_schwab_underlying(symbol)
                
                # Parse dates - use RIGHT date for trade_date (from "as of" format)
                date_field = row.get('Date', '')
                trade_date = parse_schwab_date(date_field)
                
                if not trade_date:
                    errors.append(f'Row {idx + 1}: Missing or invalid date')
                    continue
                
                # Default exec_datetime to market open (9:30 AM ET)
                exec_datetime = datetime.combine(trade_date, time(9, 30, 0))
                
                # Parse quantity
                quantity = parse_schwab_numeric(row.get('Quantity'))
                
                # Determine side based on action and quantity
                # Uses substring matching: any action containing BUY/SELL/etc will match
                if 'BUY' in action_upper:
                    side = 'BUY'
                    quantity = abs(quantity)
                elif 'SELL' in action_upper:
                    side = 'SELL'
                    quantity = -abs(quantity)
                elif 'EXPIRED' in action_upper:
                    # Use quantity sign to determine side
                    side = 'SELL' if quantity < 0 else 'BUY'
                    quantity = -abs(quantity) if side == 'SELL' else abs(quantity)
                elif 'ASSIGNED' in action_upper:
                    # Use quantity sign to determine side
                    side = 'SELL' if quantity < 0 else 'BUY'
                    quantity = -abs(quantity) if side == 'SELL' else abs(quantity)
                elif 'EXCHANGE' in action_upper:
                    # Use quantity sign to determine side (same as Expired/Assigned)
                    side = 'SELL' if quantity < 0 else 'BUY'
                    quantity = -abs(quantity) if side == 'SELL' else abs(quantity)
                elif 'EXERCISE' in action_upper:
                    # Use quantity sign to determine side (same as Expired/Assigned)
                    side = 'SELL' if quantity < 0 else 'BUY'
                    quantity = -abs(quantity) if side == 'SELL' else abs(quantity)
                else:
                    errors.append(f'Row {idx + 1}: Unknown action type: {action}')
                    continue
                
                # Parse price
                price = parse_schwab_numeric(row.get('Price'))
                
                # Parse commission (store as negative to represent cost)
                commission = -abs(parse_schwab_numeric(row.get('Fees & Comm')))
                
                # Parse amount
                amount = parse_schwab_numeric(row.get('Amount'))
                
                # Skip if quantity is zero - ALL actions require a quantity
                if quantity == 0:
                    errors.append(f'Row {idx + 1}: Zero quantity')
                    continue
                
                # Calculate proceeds
                proceeds = abs(quantity * price * multiplier) if quantity and price else 0
                
                # Get transaction type
                transaction_type = get_schwab_transaction_type(action)
                
                # Create execution record
                # Schwab CSV doesn't include account ID/alias; use account number or name as fallback
                client_account_id = account_fallback if account_fallback else ''
                account_alias = account_name if account_name else ''
                
                execution = Execution(
                    symbol=symbol,
                    description=description,
                    underlying_symbol=underlying,
                    asset_class=asset_class,
                    put_call=put_call,
                    strike=strike,
                    expiry=expiry,
                    multiplier=multiplier,
                    side=side,
                    quantity=quantity,
                    price=price,
                    amount=amount,
                    proceeds=proceeds,
                    net_cash=amount,
                    commission=commission,  # Negative to represent cost
                    commission_currency='USD',
                    currency='USD',
                    trade_date=trade_date,
                    exec_datetime=exec_datetime,
                    transaction_type=transaction_type,
                    account_id=account_id,
                    import_id=import_record.id,
                    client_account_id=client_account_id,
                    account_alias=account_alias,
                    # Schwab doesn't provide these fields
                    trade_id=None,
                    order_id=None,
                    exec_id=None,
                    exchange=None,
                )
                
                db.session.add(execution)
                executions_added += 1
                
            except Exception as e:
                errors.append(f'Row {idx + 1}: {str(e)}')
                continue
        
        # Commit executions
        db.session.commit()
        
        # Update import record
        import_record.executions_count = executions_added
        import_record.status = 'success' if not errors else 'partial'
        
        # Process trades after importing executions, unless the user will match them by hand
        trade_summary = None
        if executions_added > 0 and not manual_matching:
            trade_summary = process_executions_into_trades(account_id)
        
        # Recalculate stats so dashboard/calendar reflect the new data
        try:
            from stats_calculator import (
                calculate_daily_stats_for_account,
                calculate_hourly_stats_for_account,
                calculate_overall_stats_for_account
            )
            calculate_daily_stats_for_account(account_id)
            calculate_hourly_stats_for_account(account_id)
            calculate_overall_stats_for_account(account_id)
        except Exception as e:
            import traceback
            logging.getLogger(__name__).debug(f"Error recalculating stats after import: {e}")
            traceback.print_exc()
        
        result = {
            'success': True,
            'import_id': import_record.id,
            'executions_added': executions_added,
            'total_rows': len(df),
            'errors': errors[:20]
        }
        if trade_summary:
            result['trade_processing'] = trade_summary
        if manual_matching:
            result['manual_matching'] = True
            result['executions'] = _executions_for_import(import_record.id)
        return result
        
    except Exception as e:
        db.session.rollback()
        import_record.status = 'error'
        import_record.error_message = str(e)
        db.session.commit()
        return {
            'success': False,
            'error': str(e),
            'import_id': import_record.id
        }


def _executions_for_import(import_id):
    """Executions created by one import, oldest timestamp first."""
    rows = Execution.query.filter_by(import_id=import_id).all()
    rows.sort(key=lambda e: (
        e.exec_datetime or datetime.min,
        e.symbol or '',
        e.id or 0,
    ))
    return [e.to_dict() for e in rows]


def process_csv_with_format(file_content, filename, account_id, broker_format=None, selected_row_indices=None, advanced_matching=False, manual_matching=False):
    """
    Process CSV file using a broker format configuration.
    Falls back to Interactive Brokers format if no broker format provided.
    """
    # If no broker format provided, use default IB format
    if broker_format is None:
        from models import BrokerFormat
        broker_format = BrokerFormat.query.filter_by(code='ib').first()

    # Check if this is Schwab format (code='schwab')
    is_schwab = broker_format and broker_format.code == 'schwab'

    # Handle Schwab format with dedicated processor
    if is_schwab:
        # Schwab files are date-only; advanced timestamp matching does not apply
        return process_schwab_csv(file_content, filename, account_id, selected_row_indices, manual_matching=manual_matching)
    
    if broker_format:
        column_mappings = json.loads(broker_format.column_mappings) if broker_format.column_mappings else {}
        parser_config = json.loads(broker_format.parser_config) if broker_format.parser_config else {}
        value_mappings = json.loads(broker_format.value_mappings) if broker_format.value_mappings else {}
        broker_format_id = broker_format.id
        broker_format_code = broker_format.code  # Pass the code to detect tastytrade

    else:
        # Fallback to hardcoded IB format
        column_mappings = {}
        parser_config = {}
        value_mappings = {}
        broker_format_id = None
        broker_format_code = None
    
    # Use the existing processor with format awareness
    return _process_csv_flexible(file_content, filename, account_id, column_mappings, parser_config, broker_format_id, value_mappings, broker_format_code, selected_row_indices, advanced_matching, manual_matching)


def _process_csv_flexible(file_content, filename, account_id, column_mappings, parser_config, broker_format_id, value_mappings=None, broker_format_code=None, selected_row_indices=None, advanced_matching=False, manual_matching=False):
    """
    Internal flexible CSV processor that uses column mappings.
    """
    if value_mappings is None:
        value_mappings = {}
    
    # Decode file content if needed
    if isinstance(file_content, bytes):
        file_content = file_content.decode('utf-8')
    
    # Check if this is tastytrade format (for price adjustment)
    # Can be set via broker_format_code or auto-detection
    is_tastytrade = broker_format_code == 'tastytrade'
    is_schwab = broker_format_code == 'schwab'
    
    # If no column mappings provided, try to auto-detect format from CSV columns
    if not column_mappings:
        # Read a preview of the CSV to detect format
        try:
            preview_df = pd.read_csv(io.StringIO(file_content), nrows=1)
            preview_cols = [col.strip() for col in preview_df.columns]
            
            # Check for Schwab format
            if 'Date' in preview_cols and 'Action' in preview_cols and 'Fees & Comm' in preview_cols:
                is_schwab = True
                logging.getLogger(__name__).debug(f"DEBUG FLEX: Auto-detected Schwab format")
                # Use dedicated Schwab processor
                return process_schwab_csv(file_content, filename, account_id, selected_row_indices, manual_matching=manual_matching)
            
            # Check for tastytrade format
            if 'Date' in preview_cols and 'Action' in preview_cols and 'Average Price' in preview_cols:
                is_tastytrade = True
                column_mappings = {
                    'trade_date': 'Date',
                    'exec_datetime': 'Date',
                    'symbol': 'Symbol',
                    'side': 'Action',
                    'quantity': 'Quantity',
                    'price': 'Average Price',
                    'underlying_symbol': 'Underlying Symbol',
                    'asset_class': 'Instrument Type',
                    'strike': 'Strike Price',
                    'expiry': 'Expiration Date',
                    'put_call': 'Call or Put',
                    'multiplier': 'Multiplier',
                    'commission': 'Commissions',
                    'fees': 'Fees',
                    'order_id': 'Order #',
                    'total': 'Total',
                    'net_cash': 'Total',
                    'currency': 'Currency',
                    'description': 'Description',
                    'transaction_type': 'Sub Type',
                }
                logging.getLogger(__name__).debug(f"DEBUG FLEX: Auto-detected tastytrade format")
        except Exception as e:
            logging.getLogger(__name__).debug(f"DEBUG FLEX: Could not auto-detect format: {e}")
    
    # Create import record with broker format
    import_record = ImportHistory(
        account_id=account_id,
        broker_format_id=broker_format_id,
        filename=filename,
        file_size=len(file_content) if isinstance(file_content, bytes) else len(file_content.encode()),
        status='pending'
    )
    db.session.add(import_record)
    db.session.commit()
    
    try:
        # Read CSV (file_content is already decoded to string)
        header_row = parser_config.get('header_row_index', parser_config.get('header_row', 0))
        
        df = pd.read_csv(io.StringIO(file_content), header=header_row)
        
        # Normalize column names (strip spaces)
        df.columns = [col.strip() for col in df.columns]
        
        # Advanced timestamp matching only applies when the file has real times
        if advanced_matching and not detect_execution_timestamps(df, column_mappings, parser_config, broker_format_code):
            logging.getLogger(__name__).debug("DEBUG FLEX: advanced_matching requested but file has no execution timestamps - ignoring")
            advanced_matching = False
        
        executions_added = 0
        errors = []
        
        # Fetch account for fallback values and timezone info
        account = Account.query.get(account_id)
        account_name = account.name if account else None
        account_number = account.account_number if account else None
        account_fallback = account_number if account_number else account_name
        
        # Determine source timezone based on broker format
        # Tastytrade CSV exports are in GMT/UTC
        # IB exports are in Eastern Time (ET)
        if is_tastytrade:
            # Tastytrade exports timestamps in UTC (GMT)
            # Use account timezone setting if available, default to UTC
            source_timezone = account.timezone if account and account.timezone else 'UTC'
        else:
            # IB uses Eastern Time
            source_timezone = 'America/New_York'
        
        logging.getLogger(__name__).debug(f"DEBUG FLEX: Source timezone: {source_timezone}, is_tastytrade: {is_tastytrade}")
        
        # Helper to get column value with mapping fallback
        def get_col_value(row, field_name):
            """Get value from row using column mapping or direct column name"""
            col_name = column_mappings.get(field_name, field_name)
            return row.get(col_name)
        
        # Helper to translate values using value_mappings
        def translate_value(field_name, value):
            return _translate_value(value_mappings, field_name, value)
        
        # Helper to parse date based on format
        def parse_date(date_str, format_hint=None):
            if pd.isna(date_str) or date_str == '' or date_str == 'N/A':
                return None
            try:
                date_str = str(date_str).strip()
                if format_hint == 'YYYYMMDD' and len(date_str) >= 8:
                    year = int(date_str[:4])
                    month = int(date_str[4:6])
                    day = int(date_str[6:8])
                    return date(year, month, day)
                # Try default format
                return pd.to_datetime(date_str).date()
            except Exception:
                return None
        
        # Helper to parse datetime based on format
        def safe_float(value, default=0):
            """Safely convert value to float, handling '--', commas, and other non-numeric strings"""
            if pd.isna(value) or value == '' or value == 'N/A' or value == '--':
                return default
            try:
                # Remove commas from numeric strings (e.g., "-17,749.00" -> "-17749.00")
                cleaned = str(value).replace(',', '')
                return float(cleaned)
            except (ValueError, TypeError):
                return default
        
        def parse_datetime(dt_str, format_hint=None):
            """Parse datetime and normalize to Eastern Time"""
            if pd.isna(dt_str) or dt_str == '' or dt_str == 'N/A':
                return None
            try:
                dt = None
                if format_hint == 'YYYYMMDD;HHMMSS' and ';' in str(dt_str):
                    date_part, time_part = str(dt_str).split(';')
                    year = int(date_part[:4])
                    month = int(date_part[4:6])
                    day = int(date_part[6:8])
                    hour = int(time_part[:2])
                    minute = int(time_part[2:4])
                    second = int(time_part[4:6]) if len(time_part) >= 6 else 0
                    dt = datetime(year, month, day, hour, minute, second)
                else:
                    # Try default format
                    dt = pd.to_datetime(dt_str)
                    if isinstance(dt, pd.Timestamp):
                        dt = dt.to_pydatetime()
                
                # Normalize to Eastern Time
                if dt:
                    dt = normalize_to_eastern(dt, source_timezone)
                return dt
            except Exception:
                return None
        
        logging.getLogger(__name__).debug(f"DEBUG FLEX: Processing {len(df)} rows")
        logging.getLogger(__name__).debug(f"DEBUG FLEX: Column mappings: {column_mappings}")
        logging.getLogger(__name__).debug(f"DEBUG FLEX: CSV columns: {list(df.columns)}")
        
        # Optional type filter for preview/import inclusion
        type_filter = parser_config.get('type_filter')
        type_filter_col = type_filter.get('column') if isinstance(type_filter, dict) else None
        type_filter_include = [str(v).strip().lower() for v in type_filter.get('include', [])] if isinstance(type_filter, dict) else []
        derive_asset_class_from_symbol = parser_config.get('asset_class_from_symbol', False)
        parse_option_details_from_symbol = parser_config.get('parse_option_details_from_symbol', False)
        
        for idx, row in df.iterrows():
            # Skip rows not selected by user
            if selected_row_indices is not None and int(idx) not in selected_row_indices:
                continue
            
            try:
                # Apply optional type filter before doing heavy parsing
                if type_filter_col:
                    type_val = str(row.get(type_filter_col, '')).strip()
                    if type_val.lower() not in type_filter_include:
                        logging.getLogger(__name__).debug(f"DEBUG FLEX Row {idx}: Skipping - type filter excludes '{type_val}'")
                        continue
                
                # Skip empty rows
                raw_symbol = str(get_col_value(row, 'symbol') or '').strip()
                symbol = normalize_option_symbol(raw_symbol)
                logging.getLogger(__name__).debug(f"DEBUG FLEX Row {idx}: symbol={symbol}")
                
                if pd.isna(symbol) or symbol == '':
                    logging.getLogger(__name__).debug(f"DEBUG FLEX Row {idx}: Skipping - empty symbol")
                    continue
                
                # Parse required fields
                trade_date = parse_date(get_col_value(row, 'trade_date'), parser_config.get('date_format'))
                logging.getLogger(__name__).debug(f"DEBUG FLEX Row {idx}: trade_date={trade_date}")
                if not trade_date:
                    errors.append(f'Row {idx + 1}: Missing or invalid trade date')
                    logging.getLogger(__name__).debug(f"DEBUG FLEX Row {idx}: Skipping - no trade_date")
                    continue
                
                # Parse side and translate value if needed
                side_raw = get_col_value(row, 'side')
                logging.getLogger(__name__).debug(f"DEBUG FLEX Row {idx}: side_raw={side_raw}")
                # Handle NaN/None/blank side
                if pd.isna(side_raw) or str(side_raw).strip() == '' or str(side_raw).strip().lower() == 'nan':
                    side = ''
                else:
                    side = str(side_raw).strip()
                    side = translate_value('side', side).upper()
                
                # Parse transaction_type for special handling (e.g., cash-settled exercises)
                transaction_type_raw = str(get_col_value(row, 'transaction_type') or '').strip()
                transaction_type = translate_value('transaction_type', transaction_type_raw)
                
                # Fallback: if transaction_type is empty or looks like the 'Type' column (Trade/Receive Deliver),
                # try reading from 'Sub Type' column directly
                if not transaction_type or transaction_type in ('Trade', 'Receive Deliver'):
                    sub_type_val = row.get('Sub Type')
                    if sub_type_val and not pd.isna(sub_type_val):
                        transaction_type = str(sub_type_val).strip()
                
                # Get underlying symbol early (needed for side inference)
                underlying = _strip_futures_prefix(str(get_col_value(row, 'underlying_symbol') or '').strip())
                if underlying.lower() in ('nan', 'none', 'null'):
                    underlying = ''
                if not underlying:
                    underlying = get_option_underlying(symbol)
                
                logging.getLogger(__name__).debug(f"DEBUG FLEX Row {idx}: side={side}, transaction_type={transaction_type}, underlying={underlying}")
                
                # Handle rows with no side - try to infer from Action column (tastytrade format)
                if not side:
                    # Check Action column for tastytrade format
                    action = str(row.get('Action', '')).strip().upper()
                    logging.getLogger(__name__).debug(f"DEBUG FLEX Row {idx}: action={action}")
                    if 'BUY' in action:
                        side = 'BUY'
                    elif 'SELL' in action:
                        side = 'SELL'
                
                # Handle rows with no side - check Sub Type for special cases and skip types
                if not side:
                    # Skip non-trade Sub Types
                    skip_sub_types = ['Credit Interest', 'Mark to Market', 'Transfer', 'ACAT', 'Balance Adjustment',
                                      'CREDIT INTEREST', 'MARK TO MARKET', 'TRANSFER', 'ACAT', 'BALANCE ADJUSTMENT']
                    if transaction_type in skip_sub_types:
                        logging.getLogger(__name__).debug(f"DEBUG FLEX Row {idx}: Skipping non-trade Sub Type: {transaction_type}")
                        continue
                    
                    # Handle Assignment/Exercise cases when Action is blank
                    if transaction_type in ('Assignment', 'ASSIGNMENT'):
                        side = 'BUY'  # Short option assigned = buy to close
                    elif transaction_type in ('Exercise', 'EXERCISE'):
                        side = 'SELL'  # Long option exercised = sell to close
                    elif transaction_type in ('Cash Settled Exercise', 'CASH_SETTLED_EXERCISE'):
                        side = 'SELL'  # Long position closed via cash settlement
                    elif transaction_type in ('Cash Settled Assignment', 'CASH_SETTLED_ASSIGNMENT'):
                        side = 'BUY'  # Short position closed via cash settlement
                    if not side:
                        logging.getLogger(__name__).debug(f"DEBUG FLEX Row {idx}: Skipping - no side determined for Sub Type: {transaction_type}")
                        continue
                
                logging.getLogger(__name__).debug(f"DEBUG FLEX Row {idx}: final side={side}")
                
                if side not in ['BUY', 'SELL']:
                    errors.append(f'Row {idx + 1}: Invalid side value: {side}')
                    continue
                
                # Parse asset class first (needed for multiplier determination)
                asset_class = str(get_col_value(row, 'asset_class') or '').strip()
                asset_class = translate_value('asset_class', asset_class)
                
                # Derive asset class from symbol when configured
                if derive_asset_class_from_symbol:
                    derived_asset_class = _derive_asset_class_from_symbol(raw_symbol)
                    if derived_asset_class:
                        asset_class = derived_asset_class
                
                # Note: underlying is already parsed earlier (before side inference)
                
                # For futures/futures options, derive the underlying symbol if it is missing
                # or still contains the futures notation. This handles Tastytrade rows where the
                # "Underlying Symbol" column is blank (e.g. /MNQM6 -> MNQ, ./MNQH6D4BG6 -> MNQ).
                if asset_class and asset_class.upper() in ('FUT', 'FOP', 'FUTURE', 'FUTURE OPTION'):
                    if not underlying or underlying.startswith('/') or underlying.startswith('./'):
                        extracted = extract_futures_underlying(underlying or symbol)
                        if extracted:
                            underlying = extracted
                
                # Unified multiplier: prefixed futures symbols use the hardcoded lookup
                # (tastytrade reports a wrong multiplier of 1 for futures options),
                # then the CSV column when valid, then the asset-class fallback.
                multiplier = determine_multiplier(
                    asset_class, underlying, raw_symbol,
                    csv_multiplier=safe_float(get_col_value(row, 'multiplier')),
                )
                
                # Parse quantity and normalize sign based on side
                # Tastytrade uses positive quantities even for sells, so we normalize based on side
                quantity = safe_float(get_col_value(row, 'quantity'))
                # Normalize: BUY = positive, SELL = negative
                if side == 'SELL':
                    quantity = -abs(quantity)
                else:
                    quantity = abs(quantity)
                
                price = safe_float(get_col_value(row, 'price'))
                
                # Tastytrade: Average Price has sign (negative for buys, positive for sells)
                # Normalize to get true price: abs(price) / multiplier
                if is_tastytrade and multiplier > 0:
                    price = abs(price) / multiplier
                
                if quantity == 0:
                    errors.append(f'Row {idx + 1}: Zero quantity')
                    continue
                
                # Get option details
                strike = safe_float(get_col_value(row, 'strike'))
                expiry = parse_date(get_col_value(row, 'expiry'), parser_config.get('date_format'))
                put_call_raw = str(get_col_value(row, 'put_call') or '').strip() if get_col_value(row, 'put_call') else None
                put_call = translate_value('put_call', put_call_raw).upper() if put_call_raw else None
                
                # Extract option details from normalized symbol when configured
                if parse_option_details_from_symbol and asset_class in ('OPT', 'FOP'):
                    option_details = _extract_option_details_from_normalized_symbol(symbol)
                    if option_details:
                        opt_underlying, opt_expiry, opt_strike, opt_pc = option_details
                        if not underlying:
                            underlying = opt_underlying
                        if not expiry:
                            expiry = opt_expiry
                        if not strike:
                            strike = opt_strike
                        if not put_call:
                            put_call = opt_pc
                
                # Note: asset_class, underlying, and multiplier are already set earlier
                
                # Skip CASH entries (after translation)
                if asset_class == 'CASH':
                    continue
                
                # Parse commissions (combine regular commission + fees for total commission)
                # Tastytrade: commissions and fees are negative values (costs)
                commission_raw = safe_float(get_col_value(row, 'commission'))
                # Tastytrade reports fees in a separate 'Fees' column; sum them into commission
                fees_raw = safe_float(row.get('Fees')) if is_tastytrade else 0
                # IB reports regulatory/other fees in separate columns; sum them into commission
                ib_fees = 0 if is_tastytrade else sum(abs(safe_float(row.get(col))) for col in IB_FEE_COLUMNS)
                
                # Store as positive values for consistency
                commission = abs(commission_raw) + abs(fees_raw) + ib_fees
                
                # Parse financials
                amount = safe_float(get_col_value(row, 'amount'))
                proceeds = safe_float(get_col_value(row, 'proceeds'))
                net_cash = safe_float(get_col_value(row, 'net_cash'))
                
                # For tastytrade: use proceeds (Total column) if net_cash is not set
                # Both should map to the same 'Total' column, but proceeds might be set while net_cash isn't
                if is_tastytrade and net_cash == 0 and proceeds != 0:
                    net_cash = proceeds
                elif is_tastytrade and net_cash == 0 and amount != 0:
                    # Fallback: calculate net_cash = Value + Commissions + Fees
                    net_cash = amount + commission_raw + fees_raw
                
                # Parse timestamps
                exec_datetime = parse_datetime(get_col_value(row, 'exec_datetime'), parser_config.get('datetime_format'))
                order_time = parse_datetime(get_col_value(row, 'order_time'), parser_config.get('datetime_format'))
                settle_date = parse_date(get_col_value(row, 'settle_date'), parser_config.get('date_format'))
                
                # Parse IDs
                trade_id = str(get_col_value(row, 'trade_id') or '').strip() if get_col_value(row, 'trade_id') else None
                order_id = str(get_col_value(row, 'order_id') or '').strip() if get_col_value(row, 'order_id') else None
                exec_id = str(get_col_value(row, 'exec_id') or '').strip() if get_col_value(row, 'exec_id') else None
                # Handle NaN values that become string 'nan'
                if exec_id and exec_id.lower() == 'nan':
                    exec_id = None
                if trade_id and trade_id.lower() == 'nan':
                    trade_id = None
                
                # Parse additional info
                exchange = str(get_col_value(row, 'exchange') or '').strip()
                commission_currency = str(get_col_value(row, 'commission_currency') or '').strip()
                currency = str(get_col_value(row, 'currency') or '').strip()
                client_account_id = str(get_col_value(row, 'client_account_id') or '').strip()
                account_alias = str(get_col_value(row, 'account_alias') or '').strip()
                
                # Handle NaN values that become string 'nan'
                if client_account_id.lower() == 'nan':
                    client_account_id = ''
                if account_alias.lower() == 'nan':
                    account_alias = ''
                
                # Check if client_account_id is masked/obscured (contains * or X for security)
                # IB sometimes masks account IDs with ***** or XXXXX
                is_masked = client_account_id and ('*' in client_account_id or 
                                                    all(c == 'X' for c in client_account_id if c.isalpha()))
                
                # Use account number/name as fallback if CSV doesn't have client_id/alias fields OR if masked
                if (not client_account_id or is_masked) and account_fallback:
                    client_account_id = account_fallback
                if (not account_alias or is_masked) and account_name:
                    account_alias = account_name
                
                description = str(get_col_value(row, 'description') or '').strip()
                
                # Generate a consistent option description from the normalized symbol for options
                if asset_class in ('OPT', 'FOP'):
                    generated_desc = _generate_option_description(symbol)
                    if generated_desc:
                        description = generated_desc
                
                # Check for duplicate executions
                # For IB: Use TradeID + TradeDate (TradeID is unique per day but can repeat across days)
                # Note: For Tastytrade, we skip duplicate checking as exec_datetime + symbol can have 
                # legitimate duplicates (e.g., multiple trades at same time on same symbol)
                if trade_id and trade_date:
                    # IB-style duplicate check - only for IB format
                    if not is_tastytrade:
                        existing_by_trade_id = Execution.query.filter(
                            Execution.trade_id == trade_id,
                            Execution.trade_date == trade_date,
                            Execution.account_id == account_id
                        ).first()
                        if existing_by_trade_id:
                            continue
                
                # Secondary check: ExecID (only if present and valid)
                # Skip for tastytrade as exec_id may not be reliable
                if exec_id and exec_id.lower() != 'nan' and not is_tastytrade:
                    existing = Execution.query.filter_by(exec_id=exec_id).first()
                    if existing:
                        logging.getLogger(__name__).debug(f"DEBUG FLEX Row {idx}: Skipping - duplicate exec_id: {exec_id}")
                        continue
                
                logging.getLogger(__name__).debug(f"DEBUG FLEX Row {idx}: Creating execution for {symbol} {side} qty={quantity}")
                
                # Create execution record
                execution = Execution(
                    client_account_id=client_account_id,
                    account_alias=account_alias,
                    symbol=symbol,
                    description=description,
                    asset_class=asset_class,
                    underlying_symbol=underlying,
                    strike=strike,
                    expiry=expiry,
                    put_call=put_call,
                    multiplier=multiplier,
                    trade_id=trade_id,
                    order_id=order_id,
                    exec_id=exec_id,
                    import_id=import_record.id,
                    transaction_type=transaction_type,
                    side=side,
                    quantity=quantity,
                    price=price,
                    amount=amount,
                    proceeds=proceeds,
                    net_cash=net_cash,
                    commission=commission,
                    commission_currency=commission_currency,
                    currency=currency,
                    trade_date=trade_date,
                    exec_datetime=exec_datetime,
                    order_time=order_time,
                    settle_date=settle_date,
                    exchange=exchange,
                    account_id=account_id,
                )
                
                db.session.add(execution)
                executions_added += 1
                logging.getLogger(__name__).debug(f"DEBUG FLEX Row {idx}: Execution added (count: {executions_added})")
                
            except Exception as e:
                errors.append(f'Row {idx + 1}: {str(e)}')
                logging.getLogger(__name__).debug(f"DEBUG FLEX Row {idx}: ERROR - {str(e)}")
                continue
        
        # Update import record
        import_record.executions_count = executions_added
        import_record.status = 'success' if not errors else 'partial'
        
        logging.getLogger(__name__).debug(f"DEBUG FLEX: Total executions added: {executions_added}, errors: {len(errors)}")
        if errors:
            logging.getLogger(__name__).debug(f"DEBUG FLEX: First few errors: {errors[:5]}")
        
        # Commit all executions to database
        db.session.commit()
        logging.getLogger(__name__).debug(f"DEBUG FLEX: Database commit completed")
        
        # After importing executions, process trades unless the user will match them by hand
        trade_summary = None
        if manual_matching:
            advanced_matching = False
        if executions_added > 0 and not manual_matching:
            trade_summary = process_executions_into_trades(account_id, match_timestamps=advanced_matching)
        
        # Recalculate stats so dashboard/calendar reflect the new data
        try:
            from stats_calculator import (
                calculate_daily_stats_for_account,
                calculate_hourly_stats_for_account,
                calculate_overall_stats_for_account
            )
            calculate_daily_stats_for_account(account_id)
            calculate_hourly_stats_for_account(account_id)
            calculate_overall_stats_for_account(account_id)
        except Exception as e:
            import traceback
            logging.getLogger(__name__).debug(f"Error recalculating stats after import: {e}")
            traceback.print_exc()
        
        result = {
            'success': True,
            'import_id': import_record.id,
            'executions_added': executions_added,
            'total_rows': len(df),
            'errors': errors[:20]
        }
        if trade_summary:
            result['trade_processing'] = trade_summary
        if manual_matching:
            result['manual_matching'] = True
            result['executions'] = _executions_for_import(import_record.id)
        return result
        
    except Exception as e:
        db.session.rollback()
        import_record.status = 'error'
        import_record.error_message = str(e)
        db.session.commit()
        return {
            'success': False,
            'error': str(e),
            'import_id': import_record.id
        }




def _naive_exec_dt(e):
    """exec_datetime as a naive datetime, or None."""
    dt = e.exec_datetime
    if dt is None:
        return None
    return dt.replace(tzinfo=None) if dt.tzinfo is not None else dt


def _cluster_symbol_groups_by_timestamp(by_key):
    """
    Merge (account, symbol) execution groups whose members share an identical
    exec_datetime (union-find, so transitive chains merge too).

    Returns a list of (account_id, primary_symbol, execs, symbols) tuples where
    execs is the combined chronologically-sorted execution list and
    primary_symbol is the symbol of the earliest execution.
    """
    # (account_id, naive exec_datetime) -> list of group keys with an exec at that instant
    ts_index = {}
    for key, execs in by_key.items():
        for e in execs:
            t = _naive_exec_dt(e)
            if t is not None:
                ts_index.setdefault((key[0], t), []).append(key)

    parent = {key: key for key in by_key}

    def find(k):
        while parent[k] != k:
            parent[k] = parent[parent[k]]
            k = parent[k]
        return k

    for keys in ts_index.values():
        for other in keys[1:]:
            ra, rb = find(keys[0]), find(other)
            if ra != rb:
                parent[rb] = ra

    clusters = {}
    for key, execs in by_key.items():
        clusters.setdefault(find(key), []).extend(execs)

    groups = []
    for cluster_execs in clusters.values():
        cluster_execs.sort(key=lambda e: _naive_exec_dt(e) or datetime.min.replace(tzinfo=None))
        groups.append((
            cluster_execs[0].account_id,
            cluster_execs[0].symbol,
            cluster_execs,
            {e.symbol for e in cluster_execs},
        ))
    return groups


def _find_open_trade_for_cluster(account_id, symbols, new_execs):
    """
    For a multi-symbol cluster (advanced timestamp matching), find the open
    trade the cluster belongs to: the one containing a cluster symbol whose
    net position is being reduced/closed by the new executions (e.g. a roll).
    When several candidates qualify, the one whose closing execution is
    earliest wins. Returns None when no candidate is being closed.
    """
    EPS = 0.0001
    candidates = Trade.query.join(
        Execution, Trade.id == Execution.matched_trade_id
    ).filter(
        Trade.is_open == True,
        Trade.account_id == account_id,
        Execution.symbol.in_(list(symbols))
    ).all()

    best = None
    best_close_dt = None
    for cand in candidates:
        entry_ids = json.loads(cand.entry_execution_ids) if cand.entry_execution_ids else []
        exit_ids = json.loads(cand.exit_execution_ids) if cand.exit_execution_ids else []
        positions = {}
        for eid in entry_ids + exit_ids:
            e = Execution.query.get(eid)
            if e:
                positions[e.symbol] = positions.get(e.symbol, 0) + _normalize_execution_quantity(e)
        for e in new_execs:
            pos = positions.get(e.symbol, 0)
            if abs(pos) < EPS:
                continue
            qty = _normalize_execution_quantity(e)
            if (pos > 0) != (qty > 0):
                # This execution closes (part of) an existing position
                close_dt = _naive_exec_dt(e) or datetime.min.replace(tzinfo=None)
                if best is None or close_dt < best_close_dt:
                    best = cand
                    best_close_dt = close_dt
    return best


_SPLIT_MONEY_FIELDS = ('commission', 'broker_execution_commission', 'amount', 'proceeds', 'net_cash')
_SPLIT_COPY_SKIP = frozenset({'id', 'quantity', 'exec_id', 'created_at', 'updated_at'} | set(_SPLIT_MONEY_FIELDS))


def _split_execution_into_portions(exec, portion_qtys):
    """
    Split an unmatched execution into portions for FIFO allocation across
    multiple trades. portion_qtys are absolute quantities summing to
    abs(exec.quantity). The original row keeps its id and becomes the first
    portion; new rows are created for the rest (exec_id cleared). Money fields
    are prorated, with the remainder assigned to the last portion so column
    sums are preserved exactly. Returns the rows in portion order.
    """
    from decimal import Decimal, ROUND_HALF_UP

    total_qty = abs(float(exec.quantity))
    # Sign convention comes from the side (SELL rows may carry positive quantities)
    sign = -1 if str(exec.side).upper() == 'SELL' else 1
    money_orig = {f: float(getattr(exec, f) or 0) for f in _SPLIT_MONEY_FIELDS}
    money_assigned = {f: 0.0 for f in _SPLIT_MONEY_FIELDS}

    rows = []
    for i, portion in enumerate(portion_qtys):
        if i == 0:
            row = exec
        else:
            row = Execution()
            for col in Execution.__table__.columns:
                if col.name in _SPLIT_COPY_SKIP:
                    continue
                setattr(row, col.name, getattr(exec, col.name))
            row.exec_id = None
            db.session.add(row)
        row.quantity = sign * portion
        last = i == len(portion_qtys) - 1
        for f in _SPLIT_MONEY_FIELDS:
            if last:
                share = money_orig[f] - money_assigned[f]
            else:
                share = float(
                    Decimal(str(money_orig[f] * portion / total_qty)).quantize(
                        Decimal('0.0001'), rounding=ROUND_HALF_UP
                    )
                )
                money_assigned[f] += share
            setattr(row, f, share)
        rows.append(row)
    return rows


def process_executions_into_trades(account_id=None, match_timestamps=False):
    """
    Process executions into trades using a continuous-position model.

    Executions are grouped by (account, symbol) and processed chronologically.
    Within a group, each distinct-timestamp entry sequence becomes its own
    trade window: a same-direction execution at a different time starts a
    separate trade rather than scaling into the existing one; only fills
    sharing an entry timestamp (partial fills) scale in. An execution that
    moves the position toward zero is a closing execution (is_open=False) and
    is allocated FIFO across open windows, oldest first - the execution row is
    split when it spans multiple trades. When all of a window's legs are flat
    the trade is finalized as closed. This correctly handles multiple
    round-trips for the same symbol in a single import, as well as closing an
    existing open position and then opening a new one.

    When match_timestamps is True, symbol groups whose executions share an
    identical exec_datetime are processed together as one multi-symbol window
    (spreads). Executions that share a timestamp join an existing open trade
    only when every one of them closes a symbol that trade already holds.
    Otherwise the whole timestamp group becomes its own new trade, including
    fills that would have closed an existing position. The group is not split
    between an existing trade and a new one. A group whose members all close
    the same trade still joins that trade in full, which supersedes FIFO
    allocation across older windows. The exception is 16:00:00 (EOD)
    timestamps, which brokers assign to every expiring option regardless of
    underlying: those groups are not atomic, an execution at EOD may only
    join an existing trade as a closing execution, and an EOD execution that
    opens a position always starts its own trade.

    Returns a dict with processing summary for diagnostics.
    """
    summary = {
        'success': True,
        'executions_found': 0,
        'groups_processed': 0,
        'trades_created': 0,
        'trades_updated': 0,
        'errors': []
    }

    EPS = 0.0001

    try:
        # Get all unprocessed executions (not linked to a trade yet)
        query = Execution.query.filter(
            Execution.matched_trade_id == None,
            Execution.asset_class != 'CASH'
        )
        if account_id:
            query = query.filter(Execution.account_id == account_id)
        executions = query.all()

        summary['executions_found'] = len(executions)
        logging.getLogger(__name__).debug(f"DEBUG process_executions_into_trades: found {len(executions)} unmatched executions for account_id={account_id}")

        if not executions:
            return summary

        # Group by (account_id, symbol)
        by_key = {}
        for exec in executions:
            key = (exec.account_id, exec.symbol)
            if key not in by_key:
                by_key[key] = []
            by_key[key].append(exec)

        if match_timestamps:
            groups = _cluster_symbol_groups_by_timestamp(by_key)
        else:
            groups = [(acct, sym, execs, {sym}) for (acct, sym), execs in by_key.items()]

        logging.getLogger(__name__).debug(f"DEBUG process_executions_into_trades: processing {len(groups)} groups (match_timestamps={match_timestamps})")

        def _calculate_entry_quantity(entry_execs):
            """Spread-aware quantity from entry executions."""
            qty_by_symbol = {}
            for e in entry_execs:
                qty_by_symbol[e.symbol] = qty_by_symbol.get(e.symbol, 0) + abs(float(e.quantity or 0))
            if len(qty_by_symbol) <= 1:
                return sum(qty_by_symbol.values())
            from math import gcd
            from functools import reduce
            qtys = [int(round(q)) for q in qty_by_symbol.values() if round(q) > 0]
            return float(reduce(gcd, qtys)) if qtys else sum(qty_by_symbol.values())

        def _time_key(e):
            """Naive exec_datetime, falling back to trade_date, for timestamp equality checks."""
            dt = e.exec_datetime
            if dt is not None:
                return dt.replace(tzinfo=None) if dt.tzinfo is not None else dt
            return e.trade_date

        def _is_eod_close_ts(ts):
            """16:00:00 timestamps are broker-assigned EOD expiration times, shared
            by expiring options of every underlying."""
            return isinstance(ts, datetime) and (ts.hour, ts.minute, ts.second, ts.microsecond) == (16, 0, 0, 0)

        class TradeWindow:
            """Holds the state for one trade window (a single round-trip or open position)."""
            __slots__ = ('trade', 'entry_execs', 'exit_execs', 'symbol_positions',
                         'first_entry_exec', 'entry_times', 'dirty')

            def __init__(self, trade=None, symbol_positions=None):
                self.trade = trade
                self.entry_execs = []
                self.exit_execs = []
                self.symbol_positions = symbol_positions or {}
                self.first_entry_exec = None
                self.entry_times = set()
                self.dirty = False  # True once a new execution has been added

            def has_execs(self):
                return bool(self.entry_execs or self.exit_execs)

            def is_fully_closed(self):
                """Return True when every tracked symbol has a net-zero position."""
                return all(abs(pos) < EPS for pos in self.symbol_positions.values())

        for acct_id, symbol, symbol_execs, cluster_symbols in groups:
            summary['groups_processed'] += 1
            try:
                # Sort by execution timestamp to ensure chronological processing
                def get_sort_key(x):
                    if x.exec_datetime is None:
                        dt = datetime.min.replace(tzinfo=None)
                    elif x.exec_datetime.tzinfo is not None:
                        dt = x.exec_datetime.replace(tzinfo=None)
                    else:
                        dt = x.exec_datetime
                    price = float(x.price) if x.price is not None else 0
                    return (dt, -price)

                symbol_execs.sort(key=get_sort_key)

                # Find existing open trade that contains an execution with this symbol.
                # Multi-symbol clusters (advanced timestamp matching) instead look for
                # the open trade being closed by any of the cluster's executions.
                if len(cluster_symbols) > 1:
                    existing_trade = _find_open_trade_for_cluster(acct_id, cluster_symbols, symbol_execs)
                else:
                    existing_trade = Trade.query.join(
                        Execution, Trade.id == Execution.matched_trade_id
                    ).filter(
                        Trade.is_open == True,
                        Trade.account_id == acct_id,
                        Execution.symbol == symbol
                    ).first()

                logging.getLogger(__name__).debug(f"DEBUG process_executions_into_trades: group ({acct_id}, {symbol}) has {len(symbol_execs)} execs, existing trade={existing_trade is not None}")

                # A group is processed as a FIFO queue of trade windows. Each
                # distinct-timestamp entry sequence gets its own window: a
                # same-direction execution at a different time starts a separate
                # trade, and closing executions are allocated to the oldest open
                # window first (splitting the execution row when it spans
                # multiple trades).
                windows = []
                active = None       # window that continuations may still join
                active_ts = None    # timestamp of the last execution handled by `active`
                is_atomic_window = len(cluster_symbols) > 1

                def _resume_window(trade):
                    """Build a TradeWindow resumed from an existing open trade."""
                    entry_ids = json.loads(trade.entry_execution_ids) if trade.entry_execution_ids else []
                    exit_ids = json.loads(trade.exit_execution_ids) if trade.exit_execution_ids else []
                    loaded_entry_execs = [Execution.query.get(eid) for eid in entry_ids if Execution.query.get(eid)]
                    loaded_exit_execs = [Execution.query.get(eid) for eid in exit_ids if Execution.query.get(eid)]

                    # Track per-symbol net positions so closing one leg of a spread
                    # does not incorrectly close the whole trade.
                    symbol_positions = {}
                    for e in loaded_entry_execs + loaded_exit_execs:
                        symbol_positions[e.symbol] = symbol_positions.get(e.symbol, 0) + _normalize_execution_quantity(e)

                    resumed = TradeWindow(trade=trade, symbol_positions=symbol_positions)
                    resumed.entry_execs = loaded_entry_execs
                    resumed.exit_execs = loaded_exit_execs
                    resumed.first_entry_exec = loaded_entry_execs[0] if loaded_entry_execs else None
                    resumed.entry_times = {_time_key(e) for e in loaded_entry_execs}
                    return resumed

                def _resume_open_trade_closing(sym, qty):
                    """Lazily resume an open trade whose position in sym this quantity
                    reduces. EOD expirations of unrelated underlyings share a 16:00:00
                    timestamp but each belongs to its own trade, which may not have
                    been picked as the cluster's single resumed trade."""
                    candidates = Trade.query.join(
                        Execution, Trade.id == Execution.matched_trade_id
                    ).filter(
                        Trade.is_open == True,
                        Trade.account_id == acct_id,
                        Execution.symbol == sym
                    ).all()
                    for cand in candidates:
                        if any(w.trade is not None and w.trade.id == cand.id for w in windows):
                            continue
                        w = _resume_window(cand)
                        pos = w.symbol_positions.get(sym, 0)
                        if abs(pos) >= EPS and (pos > 0) != (qty > 0):
                            windows.append(w)
                            return w
                    return None

                if existing_trade:
                    resumed = _resume_window(existing_trade)
                    windows.append(resumed)
                    active = resumed

                def _finalize_trade_window(window):
                    """Persist a single trade window (closed or still open)."""
                    if not window.has_execs():
                        return

                    is_new = window.trade is None
                    if is_new:
                        first_exec = window.entry_execs[0] if window.entry_execs else window.exit_execs[0]
                        logging.getLogger(__name__).debug(f"DEBUG process_executions_into_trades: creating new trade for ({acct_id}, {symbol}) with entry_date={first_exec.trade_date}")
                        window.trade = Trade(
                            account_id=acct_id,
                            symbol=symbol,
                            underlying_symbol=first_exec.underlying_symbol,
                            asset_class=first_exec.asset_class,
                            strike=first_exec.strike,
                            expiry=first_exec.expiry,
                            put_call=first_exec.put_call,
                            entry_date=first_exec.trade_date,
                            entry_price=0,
                            exit_price=None,
                            quantity=0,
                            side='LONG',
                            gross_pnl=0,
                            total_commissions=0,
                            net_pnl=0,
                            entry_execution_ids=json.dumps([]),
                            exit_execution_ids=json.dumps([]),
                            is_open=True,
                            open_qty=0,
                        )
                        db.session.add(window.trade)
                        db.session.flush()
                        summary['trades_created'] += 1
                        logging.getLogger(__name__).debug(f"DEBUG process_executions_into_trades: trade created with id={window.trade.id}")
                    else:
                        summary['trades_updated'] += 1
                        logging.getLogger(__name__).debug(f"DEBUG process_executions_into_trades: updating existing trade id={window.trade.id}")

                    trade = window.trade
                    all_execs = window.entry_execs + window.exit_execs

                    # Ensure every execution in this window points to the correct trade
                    for e in all_execs:
                        e.matched_trade_id = trade.id

                    trade.entry_execution_ids = json.dumps([e.id for e in window.entry_execs])
                    trade.exit_execution_ids = json.dumps([e.id for e in window.exit_execs])

                    first_entry_exec = window.first_entry_exec

                    if window.entry_execs:
                        trade.entry_price = _net_price(window.entry_execs, is_exit=False)
                        trade.quantity = _calculate_entry_quantity(window.entry_execs)
                        trade.entry_date = min(
                            (e.trade_date for e in window.entry_execs if e.trade_date),
                            default=trade.entry_date or (first_entry_exec.trade_date if first_entry_exec else None)
                        )

                        # Side from the initial executions only (earliest date,
                        # largest absolute price) so later executions never flip it
                        trade.side = _determine_trade_side(window.entry_execs)

                    is_closed = window.is_fully_closed() and window.exit_execs
                    if is_closed:
                        trade.is_open = False
                        trade.open_qty = 0

                        if window.exit_execs:
                            trade.exit_price = _net_price(window.exit_execs, is_exit=True)
                            trade.exit_date = max(
                                (e.trade_date for e in window.exit_execs if e.trade_date),
                                default=None
                            )

                        entry_net_cash = sum(float(e.net_cash or 0) for e in window.entry_execs)
                        exit_net_cash = sum(float(e.net_cash or 0) for e in window.exit_execs)
                        total_entry_commissions = sum(float(e.commission or 0) for e in window.entry_execs)
                        total_exit_commissions = sum(float(e.commission or 0) for e in window.exit_execs)

                        trade.gross_pnl = entry_net_cash + exit_net_cash + total_entry_commissions + total_exit_commissions
                        trade.net_pnl = entry_net_cash + exit_net_cash
                        trade.total_commissions = total_entry_commissions + total_exit_commissions
                    else:
                        trade.is_open = True
                        trade.exit_date = None
                        trade.exit_price = None
                        trade.gross_pnl = 0
                        trade.net_pnl = 0
                        trade.total_commissions = 0
                        trade.open_qty = _calculate_open_quantity(all_execs)

                    if not trade.description:
                        try:
                            auto_desc = _generate_trade_description(all_execs)
                            if auto_desc:
                                trade.description = auto_desc
                        except Exception as desc_err:
                            summary['errors'].append(f"Description error for {symbol}: {str(desc_err)}")

                def _finalize(window):
                    """Persist a window and mark it as no longer pending."""
                    _finalize_trade_window(window)
                    window.dirty = False

                def _finalize_if_flat(window):
                    """Finalize a finished (flat) window that received new executions."""
                    if window.has_execs() and window.is_fully_closed() and window.dirty:
                        _finalize(window)
                        return True
                    return False

                def _process_single(exec, opening_starts_new_window=False):
                    """Process one execution with the standard per-execution rules.
                    When opening_starts_new_window is True, an execution that does not
                    close an existing position always starts its own trade instead of
                    joining the active window as an opening leg (EOD expirations)."""
                    nonlocal active, active_ts
                    qty = _normalize_execution_quantity(exec)
                    sym = exec.symbol
                    ts = _time_key(exec)
                    pos_total = sum(w.symbol_positions.get(sym, 0) for w in windows)

                    if abs(pos_total) < EPS:
                        # Fresh position for this symbol. Join the active window when
                        # it still has open legs (multi-leg entries accumulate), or when
                        # a flat atomic window continues at the same instant (roll leg);
                        # otherwise start a new window.
                        if active is not None and active.has_execs() and active.is_fully_closed():
                            if not (is_atomic_window and ts == active_ts):
                                _finalize_if_flat(active)
                                active = None
                        if opening_starts_new_window and active is not None:
                            _finalize_if_flat(active)
                            active = None
                        if active is None:
                            active = TradeWindow()
                            windows.append(active)
                        active.symbol_positions[sym] = qty
                        if not active.entry_execs:
                            active.first_entry_exec = exec
                        active.entry_execs.append(exec)
                        active.entry_times.add(ts)
                        active.dirty = True
                        exec.is_open = True

                    elif (pos_total > 0 and qty > 0) or (pos_total < 0 and qty < 0):
                        # Same direction: only a fill sharing an entry timestamp scales
                        # into the window holding the position (partial fills); a
                        # different time is a separate trade.
                        target = None
                        for w in windows:
                            if abs(w.symbol_positions.get(sym, 0)) >= EPS and ts in w.entry_times:
                                target = w
                                break
                        if target is None:
                            if active is not None:
                                _finalize_if_flat(active)
                            target = TradeWindow()
                            windows.append(target)
                        active = target
                        active.symbol_positions[sym] = active.symbol_positions.get(sym, 0) + qty
                        active.entry_execs.append(exec)
                        active.entry_times.add(ts)
                        active.dirty = True
                        exec.is_open = True

                    else:
                        # Opposite direction: close FIFO across open windows, oldest
                        # first, splitting the execution when it spans multiple trades.
                        # Any leftover quantity opens a new window (reversal).
                        remaining = abs(qty)
                        sign = 1 if qty > 0 else -1
                        allocations = []
                        for w in windows:
                            wpos = w.symbol_positions.get(sym, 0)
                            if abs(wpos) < EPS or (wpos > 0) == (sign > 0):
                                continue
                            take = min(remaining, abs(wpos))
                            allocations.append((w, take))
                            remaining -= take
                            if remaining < EPS:
                                break

                        portion_qtys = [take for (_, take) in allocations]
                        has_leftover = remaining >= EPS
                        if has_leftover:
                            portion_qtys.append(remaining)
                        if len(portion_qtys) > 1:
                            portion_execs = _split_execution_into_portions(exec, portion_qtys)
                            db.session.flush()  # assign ids to the new rows
                        else:
                            portion_execs = [exec]

                        flat_windows = []
                        for (w, take), row in zip(allocations, portion_execs):
                            w.symbol_positions[sym] = w.symbol_positions.get(sym, 0) + sign * take
                            w.exit_execs.append(row)
                            row.is_open = False
                            w.dirty = True
                            if w.is_fully_closed():
                                flat_windows.append(w)

                        if has_leftover:
                            leftover_row = portion_execs[len(allocations)]
                            leftover_row.is_open = True
                            active = TradeWindow()
                            windows.append(active)
                            active.symbol_positions[sym] = sign * remaining
                            active.entry_execs.append(leftover_row)
                            active.first_entry_exec = leftover_row
                            active.entry_times.add(ts)
                            active.dirty = True
                            for w in flat_windows:
                                _finalize_if_flat(w)
                        elif flat_windows:
                            if is_atomic_window:
                                # Keep the most recent flat window active so same-instant
                                # legs of other cluster symbols (rolls) stay in one trade
                                for w in flat_windows[:-1]:
                                    _finalize_if_flat(w)
                                active = flat_windows[-1]
                            else:
                                for w in flat_windows:
                                    _finalize_if_flat(w)
                                if active in flat_windows:
                                    active = None

                    if active is not None:
                        active_ts = ts

                def _closes_positions(exec_row, positions):
                    """True when exec_row reduces an open position in its symbol."""
                    qty = _normalize_execution_quantity(exec_row)
                    pos = positions.get(exec_row.symbol, 0)
                    return abs(pos) >= EPS and (pos > 0) != (qty > 0)

                def _find_group_target(ts_group):
                    """Window that may take this whole same-timestamp group.

                    Every execution must close that window's position in its own
                    symbol. A group that opens a symbol, adds to one, or closes
                    symbols held by different trades does not qualify.
                    """
                    def qualifying(window):
                        return all(
                            _closes_positions(e, window.symbol_positions) for e in ts_group
                        )

                    for w in windows:
                        if qualifying(w):
                            return w

                    symbols = list({e.symbol for e in ts_group})
                    candidates = Trade.query.join(
                        Execution, Trade.id == Execution.matched_trade_id
                    ).filter(
                        Trade.is_open == True,
                        Trade.account_id == acct_id,
                        Execution.symbol.in_(symbols),
                    ).all()
                    seen = set()
                    for cand in candidates:
                        if cand.id in seen:
                            continue
                        seen.add(cand.id)
                        if any(w.trade is not None and w.trade.id == cand.id for w in windows):
                            continue
                        resumed = _resume_window(cand)
                        if qualifying(resumed):
                            windows.append(resumed)
                            return resumed
                    return None

                def _start_new_trade_for_group(ts_group, ts):
                    """Put every execution in the group on one new trade.

                    Positions already open on other trades are left alone, even
                    when an execution would have closed them.
                    """
                    nonlocal active, active_ts
                    if active is not None:
                        _finalize_if_flat(active)
                        active = None
                    active = TradeWindow()
                    windows.append(active)
                    for exec in ts_group:
                        qty = _normalize_execution_quantity(exec)
                        sym = exec.symbol
                        wpos = active.symbol_positions.get(sym, 0)
                        if abs(wpos) < EPS or (wpos > 0) == (qty > 0):
                            active.symbol_positions[sym] = wpos + qty
                            if not active.entry_execs:
                                active.first_entry_exec = exec
                            active.entry_execs.append(exec)
                            exec.is_open = True
                        else:
                            sign = 1 if qty > 0 else -1
                            close_qty = min(abs(qty), abs(wpos))
                            leftover_qty = abs(qty) - close_qty
                            if leftover_qty >= EPS:
                                rows = _split_execution_into_portions(exec, [close_qty, leftover_qty])
                                db.session.flush()
                                close_row, reversal_row = rows
                            else:
                                close_row, reversal_row = exec, None
                            active.symbol_positions[sym] = wpos + sign * close_qty
                            active.exit_execs.append(close_row)
                            close_row.is_open = False
                            if reversal_row is not None:
                                active.symbol_positions[sym] += sign * leftover_qty
                                active.entry_execs.append(reversal_row)
                                reversal_row.is_open = True
                        active.entry_times.add(ts)
                        active.dirty = True
                    active_ts = ts

                def _process_timestamp_group(ts_group, ts):
                    """Match a same-timestamp group as a unit.

                    The group joins an existing trade only when every execution
                    closes a symbol that trade holds. Otherwise every execution
                    in the group opens one new trade together.
                    """
                    nonlocal active, active_ts
                    if _is_eod_close_ts(ts):
                        # EOD expiration timestamp: expirations of unrelated
                        # underlyings all share 16:00:00, so the group is NOT atomic.
                        # An execution may only join an existing trade as a closing
                        # execution - lazily resuming the open trade it closes when
                        # it is not the cluster's resumed trade - and anything that
                        # would open a position starts its own trade instead.
                        for e in ts_group:
                            if not any(_closes_positions(e, w.symbol_positions) for w in windows):
                                _resume_open_trade_closing(e.symbol, _normalize_execution_quantity(e))
                            _process_single(e, opening_starts_new_window=True)
                        return

                    target = _find_group_target(ts_group)
                    if target is None:
                        _start_new_trade_for_group(ts_group, ts)
                        return

                    for exec in ts_group:
                        qty = _normalize_execution_quantity(exec)
                        sym = exec.symbol
                        wpos = target.symbol_positions.get(sym, 0)

                        if abs(wpos) >= EPS and (wpos > 0) != (qty > 0):
                            # Closing against the target window; any excess quantity
                            # stays in the same trade as a reversal leg.
                            sign = 1 if qty > 0 else -1
                            close_qty = min(abs(qty), abs(wpos))
                            leftover_qty = abs(qty) - close_qty
                            if leftover_qty >= EPS:
                                rows = _split_execution_into_portions(exec, [close_qty, leftover_qty])
                                db.session.flush()  # assign ids to the new rows
                                close_row, reversal_row = rows
                            else:
                                close_row, reversal_row = exec, None
                            target.symbol_positions[sym] = wpos + sign * close_qty
                            target.exit_execs.append(close_row)
                            close_row.is_open = False
                            if reversal_row is not None:
                                target.symbol_positions[sym] += sign * leftover_qty
                                target.entry_execs.append(reversal_row)
                                reversal_row.is_open = True
                        else:
                            # Position is already flat after an earlier fill in this
                            # group. The remainder stays on this trade.
                            target.symbol_positions[sym] = target.symbol_positions.get(sym, 0) + qty
                            if not target.entry_execs:
                                target.first_entry_exec = exec
                            target.entry_execs.append(exec)
                            exec.is_open = True

                        target.entry_times.add(ts)
                        target.dirty = True

                    active = target
                    active_ts = ts

                if is_atomic_window:
                    # Process the cluster in same-timestamp groups
                    i = 0
                    while i < len(symbol_execs):
                        ts = _time_key(symbol_execs[i])
                        j = i + 1
                        while j < len(symbol_execs) and _time_key(symbol_execs[j]) == ts:
                            j += 1
                        _process_timestamp_group(symbol_execs[i:j], ts)
                        i = j
                else:
                    for exec in symbol_execs:
                        _process_single(exec)

                # Finalize every window that received new executions
                for w in windows:
                    if w.has_execs() and w.dirty:
                        _finalize(w)

            except Exception as group_err:
                import traceback
                err_msg = f"Error processing {symbol}: {str(group_err)}"
                summary['errors'].append(err_msg)
                logging.getLogger(__name__).debug(err_msg)
                traceback.print_exc()
                # Continue with next group instead of rolling back everything

        db.session.commit()
        logging.getLogger(__name__).debug(f"DEBUG process_executions_into_trades: commit successful. Summary: {summary}")
        return summary

    except Exception as e:
        db.session.rollback()
        import traceback
        summary['success'] = False
        summary['errors'].append(f"Fatal error: {str(e)}")
        logging.getLogger(__name__).debug(f"Error processing executions into trades: {e}")
        traceback.print_exc()
        return summary

def validate_csv(file_content, filename, account_id, broker_format=None):
    """
    Validate a CSV file before import.
    Checks if the CSV fits the template and returns row-level data for preview.
    Does NOT save anything to the database.
    
    Returns:
        {
            'valid': True/False,
            'fits_template': True/False,
            'expected_executions': int,
            'total_rows': int,
            'skipped_rows': int,
            'errors': list of error messages,
            'template_info': {
                'required_columns': list,
                'missing_columns': list,
                'detected_format': str
            },
            'rows': [
                {
                    'index': int,
                    'data': {col: value, ...},
                    'include': bool,
                    'reason': str or None
                }
            ]
        }
    """
    # Decode file content if needed
    if isinstance(file_content, bytes):
        file_content = file_content.decode('utf-8')
    
    # Default result structure
    result = {
        'valid': False,
        'fits_template': False,
        'expected_executions': 0,
        'total_rows': 0,
        'skipped_rows': 0,
        'errors': [],
        'has_timestamps': False,
        'template_info': {
            'required_columns': [],
            'missing_columns': [],
            'detected_format': 'unknown'
        },
        'rows': []
    }
    
    # Parse broker format config before reading CSV so header_row can be applied
    is_tastytrade = False
    is_schwab = False
    column_mappings = {}
    parser_config = {}
    value_mappings = {}
    broker_format_code = None
    
    if broker_format:
        column_mappings = json.loads(broker_format.column_mappings) if broker_format.column_mappings else {}
        parser_config = json.loads(broker_format.parser_config) if broker_format.parser_config else {}
        value_mappings = json.loads(broker_format.value_mappings) if broker_format.value_mappings else {}
        broker_format_code = broker_format.code
        is_tastytrade = broker_format_code == 'tastytrade'
        is_schwab = broker_format_code == 'schwab'
        result['template_info']['detected_format'] = broker_format.name
    
    try:
        # Try to read the CSV
        try:
            header_row = parser_config.get('header_row_index', parser_config.get('header_row', 0))
            df = pd.read_csv(io.StringIO(file_content), header=header_row)
        except Exception as e:
            result['errors'].append(f"Unable to parse CSV file: {str(e)}")
            return result
        
        # Normalize column names (strip spaces)
        df.columns = [col.strip() for col in df.columns]
        result['total_rows'] = len(df)
        
        # Auto-detect format if no broker format provided
        if not broker_format:
            preview_cols = list(df.columns)
            
            # Check for Schwab format
            if 'Date' in preview_cols and 'Action' in preview_cols and 'Fees & Comm' in preview_cols:
                is_schwab = True
                result['template_info']['detected_format'] = 'schwab (auto-detected)'
                result['template_info']['required_columns'] = ['Date', 'Action', 'Symbol', 'Quantity', 'Price']
                result['template_info']['missing_columns'] = []
            
            # Check for tastytrade format
            elif 'Date' in preview_cols and 'Action' in preview_cols and 'Average Price' in preview_cols:
                is_tastytrade = True
                result['template_info']['detected_format'] = 'tastytrade (auto-detected)'
                column_mappings = {
                    'trade_date': 'Date',
                    'exec_datetime': 'Date',
                    'symbol': 'Symbol',
                    'side': 'Action',
                    'quantity': 'Quantity',
                    'price': 'Average Price',
                    'underlying_symbol': 'Underlying Symbol',
                    'asset_class': 'Instrument Type',
                    'strike': 'Strike Price',
                    'expiry': 'Expiration Date',
                    'put_call': 'Call or Put',
                    'multiplier': 'Multiplier',
                    'commission': 'Commissions',
                    'fees': 'Fees',
                    'order_id': 'Order #',
                    'total': 'Total',
                    'net_cash': 'Total',
                    'currency': 'Currency',
                    'description': 'Description',
                    'transaction_type': 'Sub Type',
                }
            else:
                result['template_info']['detected_format'] = 'Interactive Brokers (default)'
                column_mappings = {}
        
        # Define required columns based on format
        if is_schwab:
            required_columns = ['Date', 'Action', 'Symbol', 'Quantity']
            result['template_info']['required_columns'] = required_columns
        elif is_tastytrade:
            required_columns = ['Date', 'Symbol', 'Action', 'Quantity', 'Average Price']
            result['template_info']['required_columns'] = required_columns
        elif column_mappings:
            # Custom mapping: required Java Journal fields mapped back to CSV headers
            required_jj_fields = ['symbol', 'side', 'quantity', 'price', 'trade_date']
            required_columns = [
                column_mappings[field] for field in required_jj_fields
                if field in column_mappings
            ]
            result['template_info']['required_columns'] = required_columns
        else:
            # IB format
            required_columns = ['Symbol', 'TradeDate', 'Buy/Sell', 'Quantity', 'Price']
            result['template_info']['required_columns'] = required_columns
        
        # Detect whether the file carries real execution timestamps (not just dates)
        result['has_timestamps'] = detect_execution_timestamps(
            df, column_mappings, parser_config,
            'schwab' if is_schwab else broker_format_code,
        )
        
        # Check for missing columns
        missing_columns = [col for col in required_columns if col not in df.columns]
        result['template_info']['missing_columns'] = missing_columns
        
        if missing_columns:
            result['errors'].append(f"Missing required columns: {', '.join(missing_columns)}")
            # Still build row preview with raw data, but mark all as not importable
            for idx, row in df.iterrows():
                row_data = {col: (str(row.get(col, '')) if pd.notna(row.get(col, '')) else '') for col in df.columns}
                result['rows'].append({
                    'index': int(idx),
                    'data': row_data,
                    'include': False,
                    'reason': f"Missing required columns: {', '.join(missing_columns)}"
                })
            return result
        
        # CSV is valid and fits template
        result['valid'] = True
        result['fits_template'] = True
        
        # Count expected executions (without saving)
        expected_count = 0
        skipped_count = 0
        errors = []
        
        # Helper to get column value with mapping fallback
        def get_col_value(row, field_name):
            col_name = column_mappings.get(field_name, field_name)
            return row.get(col_name)
        
        # Helper to translate values using value_mappings
        def translate_value(field_name, value):
            return _translate_value(value_mappings, field_name, value)
        
        # Helper to parse date based on format
        def parse_date(date_str, format_hint=None):
            if pd.isna(date_str) or date_str == '' or date_str == 'N/A':
                return None
            try:
                date_str = str(date_str).strip()
                if format_hint == 'YYYYMMDD' and len(date_str) >= 8:
                    year = int(date_str[:4])
                    month = int(date_str[4:6])
                    day = int(date_str[6:8])
                    return date(year, month, day)
                return pd.to_datetime(date_str).date()
            except Exception:
                return None
        
        # Helper to parse datetime based on format
        def safe_float(value, default=0):
            if pd.isna(value) or value == '' or value == 'N/A' or value == '--':
                return default
            try:
                cleaned = str(value).replace(',', '')
                return float(cleaned)
            except (ValueError, TypeError):
                return default
        
        def parse_datetime(dt_str, format_hint=None):
            if pd.isna(dt_str) or dt_str == '' or dt_str == 'N/A':
                return None
            try:
                dt = pd.to_datetime(dt_str)
                if isinstance(dt, pd.Timestamp):
                    return dt.to_pydatetime()
                return dt
            except Exception:
                return None
        
        def _display_str(value):
            """Convert a value to a display string, treating null/NaN as empty."""
            if value is None or pd.isna(value):
                return ''
            s = str(value).strip()
            if s.lower() in ('nan', 'none', 'null'):
                return ''
            return s
        
        # Define skip actions for Schwab
        schwab_skip_actions = [
            'Bank Interest', 'Wire Sent', 'Wire Received', 'Service Fee', 'Misc Cash Entry',
            'Security Transfer', 'ACAT', 'Dividend', 'Journal', 'Deposit', 'Withdrawal',
            'Credit Interest', 'Mark to Market', 'Balance Adjustment', 'Transfer'
        ]
        
        # Optional type filter for preview inclusion
        type_filter = parser_config.get('type_filter')
        type_filter_col = type_filter.get('column') if isinstance(type_filter, dict) else None
        type_filter_include = [str(v).strip().lower() for v in type_filter.get('include', [])] if isinstance(type_filter, dict) else []
        
        for idx, row in df.iterrows():
            # Build curated row data for display (only important saved fields)
            def _cell(col_name):
                return _display_str(row.get(col_name, ''))
            
            if is_schwab:
                row_data = {
                    'Date': _cell('Date'),
                    'Action': _cell('Action'),
                    'Symbol': _cell('Symbol'),
                    'Quantity': _cell('Quantity'),
                    'Price': _cell('Price'),
                    'Fees & Comm': _cell('Fees & Comm'),
                    'Amount': _cell('Amount'),
                    'Description': _cell('Description'),
                }
            elif is_tastytrade:
                row_data = {
                    'Date': _cell('Date'),
                    'Symbol': _cell('Symbol'),
                    'Action': _cell('Action'),
                    'Quantity': _cell('Quantity'),
                    'Average Price': _cell('Average Price'),
                    'Underlying Symbol': _cell('Underlying Symbol'),
                    'Instrument Type': _cell('Instrument Type'),
                    'Strike Price': _cell('Strike Price'),
                    'Expiration Date': _cell('Expiration Date'),
                    'Call or Put': _cell('Call or Put'),
                    'Commissions': _cell('Commissions'),
                    'Fees': _cell('Fees'),
                    'Total': _cell('Total'),
                    'Currency': _cell('Currency'),
                    'Description': _cell('Description'),
                    'Sub Type': _cell('Sub Type'),
                }
            elif column_mappings:
                # Custom mapping (e.g., Tradier) - compute transformed values for display
                raw_symbol = str(get_col_value(row, 'symbol') or '').strip()
                symbol = normalize_option_symbol(raw_symbol) if raw_symbol else raw_symbol
                
                # Side (with value mapping support)
                side_raw = get_col_value(row, 'side')
                if pd.isna(side_raw) or str(side_raw).strip() == '':
                    side = ''
                else:
                    side = str(side_raw).strip()
                    side = translate_value('side', side).upper()
                
                # Asset class (with value mapping and symbol derivation)
                asset_class = str(get_col_value(row, 'asset_class') or '').strip()
                asset_class = translate_value('asset_class', asset_class)
                if parser_config.get('asset_class_from_symbol'):
                    derived = _derive_asset_class_from_symbol(raw_symbol)
                    if derived:
                        asset_class = derived
                
                # Underlying
                underlying = _strip_futures_prefix(str(get_col_value(row, 'underlying_symbol') or '').strip())
                if not underlying and symbol:
                    underlying = get_option_underlying(symbol)
                
                # Option details
                strike = safe_float(get_col_value(row, 'strike'))
                expiry = parse_date(get_col_value(row, 'expiry'))
                put_call_raw = str(get_col_value(row, 'put_call') or '').strip() if get_col_value(row, 'put_call') else ''
                put_call = translate_value('put_call', put_call_raw).upper() if put_call_raw else ''
                
                if parser_config.get('parse_option_details_from_symbol') and asset_class in ('OPT', 'FOP'):
                    option_details = _extract_option_details_from_normalized_symbol(symbol)
                    if option_details:
                        opt_underlying, opt_expiry, opt_strike, opt_pc = option_details
                        if not underlying:
                            underlying = opt_underlying
                        if not expiry:
                            expiry = opt_expiry
                        if not strike:
                            strike = opt_strike
                        if not put_call:
                            put_call = opt_pc
                
                # Dates
                trade_date = parse_date(get_col_value(row, 'trade_date'))
                exec_datetime = parse_datetime(get_col_value(row, 'exec_datetime'))
                
                # Financials
                commission = safe_float(get_col_value(row, 'commission'))
                # IB reports regulatory/other fees separately; include them in the preview total
                commission += sum(safe_float(row.get(col)) for col in IB_FEE_COLUMNS)
                net_cash = safe_float(get_col_value(row, 'net_cash'))
                if net_cash == 0:
                    net_cash = safe_float(get_col_value(row, 'amount'))
                
                price = safe_float(get_col_value(row, 'price'))
                quantity = safe_float(get_col_value(row, 'quantity'))
                
                # Description (generate consistent option description for options)
                description = str(get_col_value(row, 'description') or '').strip()
                if asset_class in ('OPT', 'FOP'):
                    generated_desc = _generate_option_description(symbol)
                    if generated_desc:
                        description = generated_desc
                
                row_data = {
                    'Symbol': _display_str(symbol or raw_symbol),
                    'Description': _display_str(description),
                    'Buy/Sell': _display_str(side),
                    'Quantity': _display_str(quantity),
                    'Price': _display_str(price),
                    'AssetClass': _display_str(asset_class),
                    'UnderlyingSymbol': _display_str(underlying),
                    'Strike': _display_str(strike),
                    'Expiry': _display_str(expiry.isoformat() if expiry else ''),
                    'Put/Call': _display_str(put_call),
                    'Commission': _display_str(commission),
                    'NetCash': _display_str(net_cash),
                    'TradeDate': _display_str(trade_date.isoformat() if trade_date else ''),
                    'Date/Time': _display_str(exec_datetime.isoformat() if exec_datetime else ''),
                    'Exchange': _display_str(get_col_value(row, 'exchange')),
                    'TradeID': _display_str(get_col_value(row, 'trade_id')),
                    'ExecID': _display_str(get_col_value(row, 'exec_id')),
                }
            else:
                # IB format - curated preview of raw IB columns
                row_data = {
                    'Symbol': _cell('Symbol'),
                    'Description': _cell('Description'),
                    'Buy/Sell': _cell('Buy/Sell'),
                    'Quantity': _cell('Quantity'),
                    'Price': _cell('Price'),
                    'AssetClass': _cell('AssetClass'),
                    'UnderlyingSymbol': _cell('UnderlyingSymbol'),
                    'Strike': _cell('Strike'),
                    'Expiry': _cell('Expiry'),
                    'Put/Call': _cell('Put/Call'),
                    'Commission': _cell('Commission'),
                    'NetCash': _cell('NetCash'),
                    'TradeDate': _cell('TradeDate'),
                    'Date/Time': _cell('Date/Time'),
                    'Exchange': _cell('Exchange'),
                    'TradeID': _cell('TradeID'),
                    'ExecID': _cell('ExecID'),
                }
            
            try:
                # Apply optional type filter for preview
                if type_filter_col:
                    type_val = str(row.get(type_filter_col, '')).strip()
                    if type_val.lower() not in type_filter_include:
                        skipped_count += 1
                        result['rows'].append({
                            'index': int(idx),
                            'data': row_data,
                            'include': False,
                            'reason': f"Non-trade type: {type_val}"
                        })
                        continue
                
                # Skip empty rows
                if is_schwab:
                    symbol = str(row.get('Symbol', '')).strip()
                else:
                    symbol = str(get_col_value(row, 'symbol') or '').strip()
                
                if pd.isna(symbol) or symbol == '' or symbol == 'nan':
                    skipped_count += 1
                    result['rows'].append({
                        'index': int(idx),
                        'data': row_data,
                        'include': False,
                        'reason': 'Empty symbol'
                    })
                    continue
                
                # Parse required fields
                if is_schwab:
                    # Schwab date parsing
                    date_field = row.get('Date', '')
                    trade_date = parse_schwab_date(date_field)
                elif is_tastytrade or column_mappings:
                    # Custom mapping: use mapped trade_date column with flexible parsing
                    trade_date = parse_date(get_col_value(row, 'trade_date'))
                else:
                    trade_date = parse_java_journal_date(row.get('TradeDate'))
                
                if not trade_date:
                    skipped_count += 1
                    result['rows'].append({
                        'index': int(idx),
                        'data': row_data,
                        'include': False,
                        'reason': 'Missing or invalid date'
                    })
                    continue
                
                # Parse side
                if is_schwab:
                    action = str(row.get('Action', '')).strip()
                    action_upper = action.upper()
                    # Skip non-trade actions (case-insensitive substring matching)
                    if any(skip.upper() in action_upper for skip in schwab_skip_actions):
                        skipped_count += 1
                        result['rows'].append({
                            'index': int(idx),
                            'data': row_data,
                            'include': False,
                            'reason': f'Non-trade action: {action}'
                        })
                        continue
                    # Determine side from action (substring matching: contains BUY, SELL, etc.)
                    if 'BUY' in action_upper:
                        side = 'BUY'
                    elif 'SELL' in action_upper:
                        side = 'SELL'
                    elif 'EXPIRED' in action_upper or 'ASSIGNED' in action_upper or 'EXCHANGE' in action_upper or 'EXERCISE' in action_upper:
                        # For expiration/assignment/exchange/exercise, check quantity sign
                        qty = parse_schwab_numeric(row.get('Quantity'))
                        side = 'SELL' if qty < 0 else 'BUY'
                    else:
                        side = ''
                elif is_tastytrade or column_mappings:
                    side_raw = get_col_value(row, 'side')
                    if pd.isna(side_raw) or str(side_raw).strip() == '':
                        # Check Action column (tastytrade fallback)
                        action = str(row.get('Action', '')).strip().upper()
                        if 'BUY' in action:
                            side = 'BUY'
                        elif 'SELL' in action:
                            side = 'SELL'
                        else:
                            # Check Sub Type for special cases (tastytrade)
                            sub_type = str(row.get('Sub Type', '')).strip()
                            skip_sub_types = ['Credit Interest', 'Mark to Market', 'Transfer', 'ACAT', 'Balance Adjustment']
                            if sub_type in skip_sub_types:
                                skipped_count += 1
                                result['rows'].append({
                                    'index': int(idx),
                                    'data': row_data,
                                    'include': False,
                                    'reason': f'Non-trade sub-type: {sub_type}'
                                })
                                continue
                            side = ''
                    else:
                        side = str(side_raw).strip()
                        side = translate_value('side', side).upper()
                else:
                    side = str(row.get('Buy/Sell', '')).strip().upper()
                
                if side not in ['BUY', 'SELL']:
                    skipped_count += 1
                    result['rows'].append({
                        'index': int(idx),
                        'data': row_data,
                        'include': False,
                        'reason': f'Invalid side: {side}'
                    })
                    continue
                
                # Parse quantity
                if is_schwab:
                    quantity = parse_schwab_numeric(row.get('Quantity'))
                elif is_tastytrade or column_mappings:
                    quantity = safe_float(get_col_value(row, 'quantity'))
                else:
                    quantity = parse_numeric(row.get('Quantity'))
                
                if quantity == 0:
                    skipped_count += 1
                    result['rows'].append({
                        'index': int(idx),
                        'data': row_data,
                        'include': False,
                        'reason': 'Zero quantity'
                    })
                    continue
                
                # This row would be imported as an execution
                expected_count += 1
                result['rows'].append({
                    'index': int(idx),
                    'data': row_data,
                    'include': True,
                    'reason': None
                })
                
            except Exception as e:
                errors.append(f'Row {idx + 1}: {str(e)}')
                skipped_count += 1
                result['rows'].append({
                    'index': int(idx),
                    'data': row_data,
                    'include': False,
                    'reason': f'Error: {str(e)}'
                })
                continue
        
        result['expected_executions'] = expected_count
        result['skipped_rows'] = skipped_count
        result['errors'] = errors[:20]  # Return first 20 errors
        
        return result
        
    except Exception as e:
        result['errors'].append(f"Validation error: {str(e)}")
        return result


def get_sample_csv_template():
    """Generate a sample Interactive Brokers CSV template for users"""
    template = """ClientAccountID,CurrencyPrimary,AssetClass,SubCategory,Symbol,Description,UnderlyingSymbol,Multiplier,Strike,Expiry,Put/Call,TransactionType,TradeID,OrderID,ExecID,Date/Time,SettleDate,TradeDate,Exchange,Buy/Sell,Quantity,Price,Amount,Proceeds,NetCash,Commission,RegFINRATradingActivityFee,RegSection31TransactionFee,RegOther,OtherCommission,CommissionCurrency
U1234567,USD,OPT,P,SPXW  251031C06880000,SPXW 31OCT25 6880 C,SPX,100,6880,20251031,C,ExchTrade,8471600458,4559820179,0000fb35.69047912.02.01,20251031;132045,20251103,20251031,CBOE,SELL,-2,0.28,-56,56,53.6032,-2.3,-0.0066,-0.0012,-0.089,0,USD
U1234567,USD,OPT,P,SPXW  251031C06880000,SPXW 31OCT25 6880 C,SPX,100,6880,20251031,C,ExchTrade,8471797957,4559937018,0000fb35.69048423.02.01,20251031;134138,20251103,20251031,CBOE,SELL,-3,0.25,-75,75,71.4048,-3.45,-0.0099,-0.0019,-0.13342,0,USD
"""
    return template
