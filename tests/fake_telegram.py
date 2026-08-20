"""A stand-in for aiogram's Bot that records what would have been sent.

Everything below the transport is the real code: real services, real scheduler
sweeps, real SQL. Only the HTTP call to Telegram is replaced, so assertions
here are about behaviour the product actually has.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from types import SimpleNamespace


@dataclass
class SentMessage:
    chat_id: int
    text: str
    reply_markup: object | None = None


@dataclass
class FakeBot:
    sent: list[SentMessage] = field(default_factory=list)
    invites_created: list[dict] = field(default_factory=list)
    invites_revoked: list[str] = field(default_factory=list)
    banned: list[tuple[int, int]] = field(default_factory=list)
    unbanned: list[tuple[int, int]] = field(default_factory=list)
    blocked_chats: set[int] = field(default_factory=set)
    _invite_seq: int = 0

    async def me(self):
        return SimpleNamespace(id=999, username="chansub_bot")

    async def send_message(self, chat_id, text, **kw):
        if chat_id in self.blocked_chats:
            from aiogram.exceptions import TelegramForbiddenError

            raise TelegramForbiddenError(method=None, message="bot was blocked")
        msg = SentMessage(chat_id=chat_id, text=text, reply_markup=kw.get("reply_markup"))
        self.sent.append(msg)
        return msg

    async def create_chat_invite_link(self, chat_id, **kw):
        self._invite_seq += 1
        url = f"https://t.me/+invite{self._invite_seq}"
        self.invites_created.append({"chat_id": chat_id, "url": url, **kw})
        return SimpleNamespace(invite_link=url)

    async def revoke_chat_invite_link(self, chat_id, invite_link):
        self.invites_revoked.append(invite_link)

    async def ban_chat_member(self, chat_id, user_id, **kw):
        self.banned.append((chat_id, user_id))

    async def unban_chat_member(self, chat_id, user_id, **kw):
        self.unbanned.append((chat_id, user_id))

    async def get_chat_member(self, chat_id, user_id):
        return SimpleNamespace(can_invite_users=True, can_restrict_members=True)

    # --- assertion helpers -------------------------------------------------
    def texts_to(self, chat_id: int) -> list[str]:
        return [m.text for m in self.sent if m.chat_id == chat_id]

    def clear(self) -> None:
        self.sent.clear()
