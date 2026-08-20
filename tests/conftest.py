import os
import tempfile
from pathlib import Path

# Settings are read once at import time, so the environment has to be complete
# before anything under app/ is imported. A file-backed database (not
# :memory:) is required because the scheduler opens its own sessions -- an
# in-memory database would give each connection a private, empty copy.
_DB_PATH = Path(tempfile.gettempdir()) / "chansub_test.db"
os.environ.setdefault("BOT_TOKEN", "1:test")
os.environ.setdefault("ADMIN_IDS", "1")
os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{_DB_PATH}")
os.environ.setdefault("PLATFORM_CARD_NUMBER", "6037-9911-0000-0000")
os.environ.setdefault("PLATFORM_CARD_HOLDER", "Test Holder")
os.environ.setdefault("PLATFORM_PAYPAL_ACCOUNT", "owner@example.com")

import pytest_asyncio

from app.db.base import Base, SessionLocal, engine


@pytest_asyncio.fixture
async def session():
    """A clean schema per test, shared with anything using SessionLocal."""
    from app.db import models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    async with SessionLocal() as s:
        yield s


@pytest_asyncio.fixture
def bot():
    from tests.fake_telegram import FakeBot

    return FakeBot()
