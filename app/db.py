"""SQLite persistence. Small enough that a single connection guarded by a lock
is plenty; calls are wrapped in asyncio.to_thread so the event loop never blocks.
"""
import asyncio
import os
import sqlite3
import threading
import time

from app.config import cfg

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    tg_id        INTEGER PRIMARY KEY,
    username     TEXT,
    lang         TEXT NOT NULL DEFAULT 'en',
    created_at   INTEGER NOT NULL,
    referred_by  INTEGER,
    plan_until   INTEGER NOT NULL DEFAULT 0,
    scans_date   TEXT NOT NULL DEFAULT '',
    scans_today  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS groups (
    chat_id   INTEGER PRIMARY KEY,
    title     TEXT,
    added_by  INTEGER,
    added_at  INTEGER NOT NULL,
    active    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS invoices (
    code       TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    plan       TEXT NOT NULL,
    asset      TEXT NOT NULL,
    amount     REAL NOT NULL,
    address    TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    paid_at    INTEGER,
    tx_hash    TEXT
);
CREATE INDEX IF NOT EXISTS idx_invoices_open ON invoices(status, expires_at);

CREATE TABLE IF NOT EXISTS watchlist (
    user_id    INTEGER NOT NULL,
    chain      TEXT NOT NULL,
    address    TEXT NOT NULL,
    symbol     TEXT,
    snapshot   TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, chain, address)
);

CREATE TABLE IF NOT EXISTS scans (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER,
    chat_id    INTEGER,
    chain      TEXT,
    address    TEXT,
    verdict    TEXT,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scans_time ON scans(created_at);

CREATE TABLE IF NOT EXISTS cache (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL
);
"""


def _connect() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        os.makedirs(os.path.dirname(cfg.db_path) or ".", exist_ok=True)
        _conn = sqlite3.connect(cfg.db_path, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.executescript(SCHEMA)
        _conn.commit()
    return _conn


def _run(sql: str, params: tuple = (), *, fetch: str | None = None):
    with _lock:
        conn = _connect()
        cur = conn.execute(sql, params)
        if fetch == "one":
            row = cur.fetchone()
            out = dict(row) if row else None
        elif fetch == "all":
            out = [dict(r) for r in cur.fetchall()]
        else:
            out = cur.rowcount
        conn.commit()
        return out


async def query(sql: str, params: tuple = (), *, fetch: str | None = None):
    return await asyncio.to_thread(_run, sql, params, fetch=fetch)


async def init() -> None:
    await asyncio.to_thread(_connect)


# ---------------------------------------------------------------- users

async def get_user(tg_id: int) -> dict | None:
    return await query("SELECT * FROM users WHERE tg_id=?", (tg_id,), fetch="one")


async def upsert_user(tg_id: int, username: str | None, referred_by: int | None = None) -> dict:
    user = await get_user(tg_id)
    if user is None:
        await query(
            "INSERT INTO users (tg_id, username, created_at, referred_by) VALUES (?,?,?,?)",
            (tg_id, username, int(time.time()), referred_by),
        )
        user = await get_user(tg_id)
    elif username and user.get("username") != username:
        await query("UPDATE users SET username=? WHERE tg_id=?", (username, tg_id))
        user["username"] = username
    return user


async def set_lang(tg_id: int, lang: str) -> None:
    await query("UPDATE users SET lang=? WHERE tg_id=?", (lang, tg_id))


async def is_pro(tg_id: int) -> bool:
    user = await get_user(tg_id)
    return bool(user and user["plan_until"] > int(time.time()))


async def extend_plan(tg_id: int, days: int) -> int:
    """Add days on top of the remaining plan (never shortens it). Returns new expiry."""
    now = int(time.time())
    user = await get_user(tg_id)
    base = max(now, user["plan_until"] if user else 0)
    until = base + days * 86400
    await query("UPDATE users SET plan_until=? WHERE tg_id=?", (until, tg_id))
    return until


async def bump_scan_quota(tg_id: int, today: str) -> int:
    """Increment today's scan counter and return the new value."""
    user = await get_user(tg_id)
    if user and user["scans_date"] == today:
        count = user["scans_today"] + 1
    else:
        count = 1
    await query("UPDATE users SET scans_date=?, scans_today=? WHERE tg_id=?", (today, count, tg_id))
    return count


async def referral_count(tg_id: int) -> int:
    row = await query(
        "SELECT COUNT(*) AS c FROM users WHERE referred_by=?", (tg_id,), fetch="one"
    )
    return row["c"] if row else 0


# ---------------------------------------------------------------- groups

async def register_group(chat_id: int, title: str | None, added_by: int | None) -> None:
    await query(
        "INSERT INTO groups (chat_id, title, added_by, added_at) VALUES (?,?,?,?) "
        "ON CONFLICT(chat_id) DO UPDATE SET title=excluded.title, active=1",
        (chat_id, title, added_by, int(time.time())),
    )


async def deactivate_group(chat_id: int) -> None:
    await query("UPDATE groups SET active=0 WHERE chat_id=?", (chat_id,))


# ---------------------------------------------------------------- cache

async def cache_get(key: str) -> str | None:
    row = await query(
        "SELECT value FROM cache WHERE key=? AND expires_at>?",
        (key, int(time.time())),
        fetch="one",
    )
    return row["value"] if row else None


async def cache_set(key: str, value: str, ttl: int) -> None:
    await query(
        "INSERT INTO cache (key, value, expires_at) VALUES (?,?,?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value, expires_at=excluded.expires_at",
        (key, value, int(time.time()) + ttl),
    )


# ---------------------------------------------------------------- settings

async def setting_get(k: str, default: str = "") -> str:
    row = await query("SELECT v FROM settings WHERE k=?", (k,), fetch="one")
    return row["v"] if row else default


async def setting_set(k: str, v: str) -> None:
    await query(
        "INSERT INTO settings (k, v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",
        (k, v),
    )
