"""Per-update plumbing: a database session and a resolved locale.

Locale resolution order is: the choice the user saved, then the language
Telegram reports for their client, then English. Resolving it once here keeps
every handler from having to think about it.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import Any

from aiogram import BaseMiddleware
from aiogram.types import TelegramObject, User
from sqlalchemy import select

from app.db.base import SessionLocal
from app.db.models import Owner, Subscriber
from app.i18n import normalize

log = logging.getLogger(__name__)


class DatabaseMiddleware(BaseMiddleware):
    """Open one session per update and commit it if the handler succeeded."""

    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        async with SessionLocal() as session:
            data["session"] = session
            try:
                result = await handler(event, data)
            except Exception:
                await session.rollback()
                raise
            await session.commit()
            return result


class LocaleMiddleware(BaseMiddleware):
    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        user: User | None = data.get("event_from_user")
        session = data.get("session")
        locale = normalize(user.language_code if user else None)

        if user and session is not None:
            stored = await session.scalar(
                select(Owner.locale).where(Owner.telegram_user_id == user.id)
            ) or await session.scalar(
                select(Subscriber.locale).where(Subscriber.telegram_user_id == user.id)
            )
            if stored:
                locale = normalize(stored)

        data["locale"] = locale
        return await handler(event, data)
