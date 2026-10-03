import argparse
import json
from pathlib import Path
import time

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, select, text
from sqlalchemy.exc import OperationalError

from config import database_url, load_environment
from models import BrokerFormat

BROKER_FORMATS = (
    {'code': 'ibkr', 'name': 'Interactive Brokers', 'column_mappings': {
        'client_account_id': 'ClientAccountID', 'symbol': 'Symbol', 'description': 'Description',
        'trade_date': 'TradeDate', 'exec_datetime': 'Date/Time', 'side': 'Buy/Sell',
        'quantity': 'Quantity', 'price': 'Price', 'commission': 'Commission',
        'net_cash': 'NetCash', 'underlying_symbol': 'UnderlyingSymbol', 'asset_class': 'AssetClass',
        'strike': 'Strike', 'expiry': 'Expiry', 'put_call': 'Put/Call', 'multiplier': 'Multiplier',
        'trade_id': 'TradeID', 'order_id': 'OrderID', 'exec_id': 'ExecID', 'currency': 'Currency',
    }},
    {'code': 'schwab', 'name': 'Charles Schwab', 'column_mappings': {}},
    {'code': 'tastytrade', 'name': 'Tastytrade', 'column_mappings': {}},
)


def migration_config():
    return Config(str(Path(__file__).with_name('alembic.ini')))


SCHEMA_REVISION = ScriptDirectory.from_config(migration_config()).get_current_head()


def seed_formats(connection):
    for item in BROKER_FORMATS:
        table = BrokerFormat.__table__
        if connection.execute(select(table.c.id).where(table.c.code == item['code'])).first():
            continue
        connection.execute(table.insert().values(
            name=item['name'], code=item['code'], is_active=True,
            column_mappings=json.dumps(item['column_mappings']),
            parser_config='{}', value_mappings='{}',
        ))


def initialize(engine=None):
    load_environment()
    owned = engine is None
    engine = engine or create_engine(database_url(), pool_pre_ping=True, hide_parameters=True)
    try:
        # Create tables (with retry so the app can start even if DB is temporarily down)
        for attempt in range(10):
            try:
                with engine.connect() as connection:
                    connection.execute(text('SELECT 1'))
                break
            except OperationalError:
                if attempt == 9:
                    raise RuntimeError('Database unavailable. Check connection settings, TLS and network access.') from None
                time.sleep(3)
        with engine.begin() as connection:
            if engine.dialect.name == 'postgresql':
                connection.execute(text('SELECT pg_advisory_xact_lock(18042026)'))
            config = migration_config()
            config.attributes['connection'] = connection
            command.upgrade(config, 'head')
            seed_formats(connection)
    finally:
        if owned:
            engine.dispose()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['init', 'check'])
    args = parser.parse_args()
    try:
        if args.action == 'init':
            initialize()
            print('Database initialized and schema is up to date.')
        else:
            load_environment()
            engine = create_engine(database_url(), hide_parameters=True)
            with engine.connect() as connection:
                connection.execute(text('SELECT 1'))
            engine.dispose()
            print('Database connection succeeded.')
    except Exception:
        parser.exit(1, 'Database operation failed. Check configuration, credentials, TLS and network access.\n')


if __name__ == '__main__':
    main()
