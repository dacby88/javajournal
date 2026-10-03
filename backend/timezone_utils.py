"""
Timezone utilities for normalizing trade timestamps.
All timestamps are stored in the database as Eastern Time (ET) since that's
the standard timezone for US markets (9:30 AM - 4:00 PM ET).
"""
from datetime import datetime
from typing import Optional
import pytz

# Define common timezones
EASTERN = pytz.timezone('America/New_York')
UTC = pytz.UTC
PACIFIC = pytz.timezone('America/Los_Angeles')
CENTRAL = pytz.timezone('America/Chicago')

# Map of common broker timezones
BROKER_TIMEZONES = {
    'ib': 'America/New_York',        # Interactive Brokers uses ET
    'tastytrade': 'UTC',             # Tastytrade exports in GMT/UTC
    'td': 'America/New_York',        # TD Ameritrade uses ET
    'schwab': 'America/New_York',    # Schwab uses ET
    'tradestation': 'America/New_York', # TradeStation uses ET
    'etrade': 'America/New_York',    # E*Trade uses ET
}


def normalize_to_eastern(dt: Optional[datetime], source_timezone: str = 'America/New_York') -> Optional[datetime]:
    """
    Normalize a datetime to Eastern Time (ET).
    
    Args:
        dt: The datetime to normalize (can be naive or timezone-aware)
        source_timezone: The timezone the datetime is in (default: America/New_York)
    
    Returns:
        A naive datetime in Eastern Time (or None if input is None)
    """
    if dt is None:
        return None
    
    # If datetime is naive, assume it's in the source timezone
    if dt.tzinfo is None:
        source_tz = pytz.timezone(source_timezone)
        dt = source_tz.localize(dt)
    
    # Convert to Eastern Time
    dt_eastern = dt.astimezone(EASTERN)
    
    # Return naive datetime (strip timezone info for storage)
    # This keeps the database schema simple while ensuring all times are ET
    return dt_eastern.replace(tzinfo=None)


def parse_datetime_with_timezone(
    dt_str: str,
    source_timezone: str = 'America/New_York',
    format_hint: Optional[str] = None
) -> Optional[datetime]:
    """
    Parse a datetime string and normalize it to Eastern Time.
    
    Args:
        dt_str: The datetime string to parse
        source_timezone: The timezone the string is in
        format_hint: Optional format hint for parsing
    
    Returns:
        A naive datetime in Eastern Time
    """
    if not dt_str or str(dt_str).strip() == '' or str(dt_str).strip().upper() == 'N/A':
        return None
    
    try:
        dt_str = str(dt_str).strip()
        
        # Handle Interactive Brokers format: YYYYMMDD;HHMMSS
        if format_hint == 'YYYYMMDD;HHMMSS' and ';' in dt_str:
            date_part, time_part = dt_str.split(';')
            year = int(date_part[:4])
            month = int(date_part[4:6])
            day = int(date_part[6:8])
            hour = int(time_part[:2])
            minute = int(time_part[2:4])
            second = int(time_part[4:6]) if len(time_part) >= 6 else 0
            dt = datetime(year, month, day, hour, minute, second)
        else:
            # Try pandas parsing
            import pandas as pd
            dt = pd.to_datetime(dt_str)
            if isinstance(dt, pd.Timestamp):
                dt = dt.to_pydatetime()
        
        # Normalize to Eastern Time
        return normalize_to_eastern(dt, source_timezone)
        
    except Exception:
        return None


def get_account_timezone(account) -> str:
    """
    Get the timezone for an account.
    Falls back to Eastern Time if not set.
    """
    if account and account.timezone:
        return account.timezone
    return 'America/New_York'


def get_broker_source_timezone(broker_format_code: str) -> str:
    """
    Get the source timezone for a broker format.
    This is the timezone that the broker's CSV exports use.
    """
    code_lower = broker_format_code.lower() if broker_format_code else 'ib'
    return BROKER_TIMEZONES.get(code_lower, 'America/New_York')


def format_et_datetime(dt: Optional[datetime]) -> Optional[str]:
    """
    Format a datetime for display in Eastern Time.
    Returns ISO format string with ET indication.
    """
    if dt is None:
        return None
    
    # If naive, assume ET
    if dt.tzinfo is None:
        dt = EASTERN.localize(dt)
    else:
        dt = dt.astimezone(EASTERN)
    
    return dt.strftime('%Y-%m-%dT%H:%M:%S') + ' ET'


def is_market_hours(dt: datetime) -> bool:
    """
    Check if a datetime falls within US market hours (9:30 AM - 4:00 PM ET).
    """
    if dt is None:
        return False
    
    # Ensure we're working with ET
    if dt.tzinfo is None:
        dt = EASTERN.localize(dt)
    else:
        dt = dt.astimezone(EASTERN)
    
    # Check if it's a weekday (0=Monday, 6=Sunday)
    if dt.weekday() >= 5:  # Saturday or Sunday
        return False
    
    # Check time (9:30 AM - 4:00 PM ET)
    market_open = dt.replace(hour=9, minute=30, second=0, microsecond=0)
    market_close = dt.replace(hour=16, minute=0, second=0, microsecond=0)
    
    return market_open <= dt <= market_close
