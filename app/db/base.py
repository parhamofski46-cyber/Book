from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings


class Base(DeclarativeBase):
    pass


_settings = get_settings()
engine = create_async_engine(_settings.database_url, echo=False, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


async def init_models() -> None:
    """Create tables directly, for tests only.

    Real deployments go through Alembic: ``create_all`` can create a schema but
    never change one, so using it in production means the first migration you
    need is the one you cannot run without dropping customer data.
    """
    from app.db import models  # noqa: F401  (import registers the mappers)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def assert_schema_ready() -> None:
    """Refuse to start against a database that has not been migrated.

    Starting anyway would half-work: reads succeed until the first query hits a
    column the migration would have added, and by then the bot has already told
    a customer their payment went through.
    """
    from sqlalchemy import inspect

    def _tables(conn) -> set[str]:
        return set(inspect(conn).get_table_names())

    async with engine.connect() as conn:
        tables = await conn.run_sync(_tables)

    if "alembic_version" not in tables:
        raise RuntimeError(
            "Database is not initialised. Run:  alembic upgrade head"
        )

    missing = {t.name for t in Base.metadata.sorted_tables} - tables
    if missing:
        raise RuntimeError(
            f"Database is behind the code (missing: {', '.join(sorted(missing))}). "
            "Run:  alembic upgrade head"
        )
