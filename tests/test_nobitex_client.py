"""Tests the feed against the payloads Nobitex's own API documentation shows.

The live endpoint is not reachable from CI, so the next best thing is to
serve the exact response bodies from the official docs (nobitex/docs-api,
source/includes/_market_data.md and _other.md) and require the client to
parse them. If Nobitex changes its format, these examples go stale and
that is a signal worth having.
"""

from __future__ import annotations

import json
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from nobitex_arb.config import DEFAULT_CONFIG
from nobitex_arb.nobitex import FeedError, NobitexFeed, detect_irt_unit

# Verbatim from the documentation's GET /v3/orderbook/BTCIRT example.
ORDERBOOK_SINGLE = {
    "status": "ok",
    "lastUpdate": 1644991756704,
    "lastTradePrice": "35650565900",
    "asks": [["1476091000", "1.016"], ["1479700000", "0.2561"]],
    "bids": [["1470001120", "0.126571"], ["1470000000", "0.818994"]],
}

# Verbatim from the GET /v3/orderbook/all example.
ORDERBOOK_ALL = {
    "status": "ok",
    "BTCIRT": {
        "lastUpdate": 1644991756704,
        "asks": [["1476091000", "1.016"], ["1479700000", "0.2561"]],
        "bids": [["1470001120", "0.126571"], ["1470000000", "0.818994"]],
    },
    "USDTIRT": {
        "lastUpdate": 1644991767392,
        "asks": [["277990", "6688.3"], ["278000", "28185.03"]],
        "bids": [["277960", "119.31"], ["271240", "1079.75"]],
    },
}

# Verbatim shape from the GET /v2/options example.
OPTIONS = {
    "status": "ok",
    "nobitex": {
        "minOrders": {"rls": "3000000", "usdt": "11", "2": "3000000", "13": "11"},
        "amountPrecisions": {"BTCIRT": "0.000001", "BTCUSDT": "0.000001"},
    },
}


class _Handler(BaseHTTPRequestHandler):
    routes: dict
    hits: list

    def log_message(self, *args):  # noqa: A003
        pass

    def do_GET(self):  # noqa: N802
        self.hits.append(self.path)
        entry = self.routes.get(self.path)
        if entry is None:
            self.send_error(404, "not found")
            return
        status, payload = entry
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class FakeNobitex:
    """A stand-in exchange serving the documented payloads."""

    def __init__(self, routes: dict):
        self.hits: list[str] = []
        handler = type("H", (_Handler,), {"routes": routes, "hits": self.hits})
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    @property
    def url(self) -> str:
        host, port = self.httpd.server_address[0], self.httpd.server_address[1]
        return f"http://{host}:{port}"

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()


class TestConfiguredEndpoint(unittest.TestCase):
    def test_default_base_url_is_the_documented_host(self):
        """Regression: api.nobitex.ir is wrong; the documented host is apiv2."""
        self.assertEqual(DEFAULT_CONFIG["base_url"], "https://apiv2.nobitex.ir")

    def test_default_minimums_match_the_documented_ones(self):
        self.assertEqual(DEFAULT_CONFIG["min_order_by_quote"], {"IRT": 3000000, "USDT": 11})


class TestFeedAgainstDocumentedPayloads(unittest.TestCase):
    def serve(self, routes):
        server = FakeNobitex(routes)
        self.addCleanup(server.close)
        feed = NobitexFeed(server.url, timeout=5)
        self.addCleanup(feed.close)
        return server, feed

    def test_parses_the_batch_endpoint(self):
        server, feed = self.serve({"/v3/orderbook/all": (200, ORDERBOOK_ALL)})
        books = feed.fetch(("BTCIRT", "USDTIRT"))
        self.assertEqual(feed.mode, "batch")
        self.assertEqual(set(books), {"BTCIRT", "USDTIRT"})
        self.assertAlmostEqual(books["BTCIRT"].best_ask, 1_476_091_000.0)
        self.assertAlmostEqual(books["BTCIRT"].best_bid, 1_470_001_120.0)
        self.assertAlmostEqual(books["USDTIRT"].best_ask, 277_990.0)
        self.assertAlmostEqual(books["USDTIRT"].bids[0].amount, 119.31)
        self.assertTrue(all(b.is_valid() for b in books.values()))

    def test_falls_back_to_per_symbol_when_batch_is_absent(self):
        server, feed = self.serve({
            "/v3/orderbook/BTCIRT": (200, ORDERBOOK_SINGLE),
            "/v3/orderbook/USDTIRT": (200, ORDERBOOK_SINGLE),
        })
        books = feed.fetch(("BTCIRT", "USDTIRT"))
        self.assertEqual(feed.mode, "single")
        self.assertEqual(set(books), {"BTCIRT", "USDTIRT"})
        self.assertIn("/v3/orderbook/all", server.hits)

    def test_string_prices_become_numbers(self):
        _, feed = self.serve({"/v3/orderbook/all": (200, ORDERBOOK_ALL)})
        book = feed.fetch(("USDTIRT",))["USDTIRT"]
        for level in (*book.bids, *book.asks):
            self.assertIsInstance(level.price, float)
            self.assertIsInstance(level.amount, float)

    def test_reads_the_documented_minimum_orders(self):
        _, feed = self.serve({"/v2/options": (200, OPTIONS)})
        self.assertEqual(feed.fetch_options(), {"IRT": 3_000_000.0, "USDT": 11.0})

    def test_failure_names_the_endpoint_and_the_reason(self):
        """Regression: 'no order books returned' alone was undiagnosable."""
        _, feed = self.serve({})
        with self.assertRaises(FeedError) as ctx:
            feed.fetch(("BTCIRT",))
        message = str(ctx.exception)
        self.assertIn("orderbook", message)
        self.assertIn("BTCIRT", message)
        self.assertTrue(any(tok in message for tok in ("404", "HTTPError", "Error")), message)

    def test_a_server_error_is_reported_not_silently_empty(self):
        _, feed = self.serve({"/v3/orderbook/all": (503, {"status": "failed"})})
        with self.assertRaises(FeedError):
            feed.fetch(("BTCIRT",))
        self.assertEqual(feed.stats.failures, 1)

    def test_a_status_failed_body_is_not_treated_as_a_book(self):
        _, feed = self.serve({
            "/v3/orderbook/all": (200, {"status": "failed", "message": "nope"}),
            "/v3/orderbook/BTCIRT": (200, {"status": "failed", "message": "nope"}),
        })
        with self.assertRaises(FeedError):
            feed.fetch(("BTCIRT",))

    def test_documented_prices_are_recognised_as_rial(self):
        # 277,990 per USDT in the docs' example is rial, not toman.
        self.assertEqual(detect_irt_unit(277_990.0), "rial")
        self.assertEqual(detect_irt_unit(1_150_000.0), "rial")
        self.assertEqual(detect_irt_unit(115_000.0), "toman")


if __name__ == "__main__":
    unittest.main(verbosity=2)
