#!/usr/bin/env python3
"""Minimal end-to-end probe for Telegram Stars payments.

Purpose: prove the money rail works BEFORE building a product on top of it.
Stdlib only - no pip install needed.

Usage:
    export BOT_TOKEN=123456:ABC...
    python3 tools/stars_probe.py            # start the probe bot
    python3 tools/stars_probe.py balance    # print Stars balance / transactions

Then, from a SECOND Telegram account, open your bot and send /buy.
Pay the invoice. The script prints every step it observes.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

TOKEN = os.getenv("BOT_TOKEN", "").strip()
API = f"https://api.telegram.org/bot{TOKEN}"
STAR_PRICE = int(os.getenv("STAR_PRICE", "1"))  # how many Stars to charge in the test


def call(method: str, **params):
    """POST a Bot API method as JSON and return the parsed `result`."""
    body = json.dumps(params).encode()
    req = urllib.request.Request(
        f"{API}/{method}",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=70) as resp:
            payload = json.load(resp)
    except urllib.error.HTTPError as exc:
        payload = json.load(exc)
    if not payload.get("ok"):
        print(f"  !! {method} failed: {payload.get('description')}")
        return None
    return payload.get("result")


def send_invoice(chat_id: int) -> None:
    """Stars invoices use currency XTR and an EMPTY provider_token."""
    result = call(
        "sendInvoice",
        chat_id=chat_id,
        title="Stars rail test",
        description="A throwaway purchase that proves Stars payments work.",
        payload=f"probe-{int(time.time())}",
        provider_token="",          # must be empty for Stars
        currency="XTR",             # Telegram Stars
        prices=[{"label": "Test", "amount": STAR_PRICE}],
    )
    if result:
        print(f"  -> invoice for {STAR_PRICE} star(s) sent to {chat_id}")


def show_balance() -> None:
    txs = call("getStarTransactions", offset=0, limit=20)
    if txs is None:
        print("getStarTransactions unavailable - check the balance in @BotFather instead:")
        print("  @BotFather -> /mybots -> your bot -> Bot Settings -> Payments")
        return
    entries = txs.get("transactions", [])
    print(f"Stars transactions on record: {len(entries)}")
    for tx in entries:
        print(f"  {tx.get('date')}  amount={tx.get('amount')}  id={tx.get('id')}")


def run() -> None:
    me = call("getMe")
    if not me:
        print("Bad BOT_TOKEN - could not call getMe. Stopping.")
        return
    print(f"Probe running as @{me['username']}. Open it from ANOTHER account and send /buy.")
    print("Ctrl+C to stop.\n")

    offset = None
    while True:
        updates = call("getUpdates", offset=offset, timeout=60) or []
        for update in updates:
            offset = update["update_id"] + 1

            # Step 2: Telegram asks for confirmation right before charging.
            if "pre_checkout_query" in update:
                query = update["pre_checkout_query"]
                print(f"[pre_checkout] from {query['from'].get('id')} - approving")
                call("answerPreCheckoutQuery", pre_checkout_query_id=query["id"], ok=True)
                continue

            message = update.get("message")
            if not message:
                continue

            # Step 3: the charge went through.
            if "successful_payment" in message:
                paid = message["successful_payment"]
                print("\n=== PAYMENT RECEIVED ===")
                print(f"  amount   : {paid.get('total_amount')} {paid.get('currency')}")
                print(f"  payload  : {paid.get('invoice_payload')}")
                print(f"  charge id: {paid.get('telegram_payment_charge_id')}")
                print("Stars are now on the bot's balance.")
                print("Next: try withdrawing them on fragment.com - that is the real test.\n")
                call("sendMessage", chat_id=message["chat"]["id"],
                     text="Payment received. The Stars rail works on the collection side.")
                continue

            # Step 1: someone asks for an invoice.
            text = (message.get("text") or "").strip()
            chat_id = message["chat"]["id"]
            if text.startswith("/buy"):
                print(f"[/buy] from {chat_id}")
                send_invoice(chat_id)
            elif text.startswith("/start"):
                call("sendMessage", chat_id=chat_id,
                     text="Send /buy to receive a test invoice priced in Stars.")


if __name__ == "__main__":
    if not TOKEN:
        sys.exit("Set BOT_TOKEN first:  export BOT_TOKEN=123456:ABC...")
    if len(sys.argv) > 1 and sys.argv[1] == "balance":
        show_balance()
    else:
        try:
            run()
        except KeyboardInterrupt:
            print("\nstopped.")
