"""Entry point: wire routers, middlewares and the hourly sweep, then poll."""

from __future__ import annotations

import asyncio
import logging

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.client.session.aiohttp import AiohttpSession
from aiogram.enums import ParseMode
from aiogram.fsm.storage.memory import MemoryStorage
from apscheduler.schedulers.asyncio import AsyncIOScheduler

import app.payments  # noqa: F401  (importing registers every provider)
from app.bot.handlers import admin, owner, start, subscriber
from app.bot.middlewares import DatabaseMiddleware, LocaleMiddleware
from app.config import get_settings
from app.db.base import assert_schema_ready
from app.scheduler.jobs import run_all

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
)
log = logging.getLogger(__name__)


def build_bot() -> Bot:
    settings = get_settings()
    # api.telegram.org is filtered in Iran; a proxy keeps an Iranian host usable.
    session = AiohttpSession(proxy=settings.telegram_proxy) if settings.telegram_proxy else None
    return Bot(
        token=settings.bot_token,
        session=session,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )


def build_dispatcher() -> Dispatcher:
    dp = Dispatcher(storage=MemoryStorage())

    # Order matters: the session must exist before the locale lookup runs.
    for observer in (dp.message, dp.callback_query, dp.pre_checkout_query):
        observer.middleware(DatabaseMiddleware())
        observer.middleware(LocaleMiddleware())

    # Admin first so its guarded commands win over the generic handlers.
    dp.include_router(admin.router)
    dp.include_router(start.router)
    dp.include_router(owner.router)
    dp.include_router(subscriber.router)
    return dp


async def main() -> None:
    settings = get_settings()
    if not settings.admins:
        log.warning("ADMIN_IDS is empty -- nobody can reach the admin panel")

    await assert_schema_ready()

    bot = build_bot()
    dp = build_dispatcher()

    scheduler = AsyncIOScheduler(timezone="UTC")
    scheduler.add_job(
        run_all,
        "interval",
        hours=1,
        args=[bot],
        id="subscription_sweep",
        max_instances=1,       # never let two sweeps overlap
        coalesce=True,         # a missed run catches up once, not N times
        misfire_grace_time=600,
    )
    scheduler.start()
    me = await bot.me()
    log.info("starting bot @%s", me.username)
    log.info("sweep scheduled hourly")

    try:
        await bot.delete_webhook(drop_pending_updates=False)
        await dp.start_polling(bot)
    finally:
        scheduler.shutdown(wait=False)
        await bot.session.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        log.info("shutting down")
