from alembic import context
from sqlalchemy import create_engine

from config import database_url, load_environment
from models import db

config = context.config
target_metadata = db.metadata


def run(connection):
    context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    load_environment()
    context.configure(url=database_url(), target_metadata=target_metadata,
                      literal_binds=True, dialect_opts={'paramstyle': 'named'})
    with context.begin_transaction():
        context.run_migrations()
elif config.attributes.get('connection') is not None:
    run(config.attributes['connection'])
else:
    load_environment()
    engine = create_engine(database_url(), hide_parameters=True)
    with engine.connect() as connection:
        run(connection)
    engine.dispose()
