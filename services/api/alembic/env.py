from logging.config import fileConfig

from sqlalchemy import create_engine, pool

from alembic import context
from demo_api.db import Base, database_url

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

if context.is_offline_mode():
    context.configure(url=database_url(), target_metadata=Base.metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    connectable = create_engine(database_url(), poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=Base.metadata)
        with context.begin_transaction():
            context.run_migrations()
