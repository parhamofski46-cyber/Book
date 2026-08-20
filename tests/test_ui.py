"""Tests for the desktop UI layer: controller lifecycle and HTTP server.

The engine here is fed synthetic books, so nothing touches the network.
"""

from __future__ import annotations

import json
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from nobitex_arb.config import DEFAULT_CONFIG
from nobitex_arb.models import OrderBook
from nobitex_arb.nobitex import FetchStats
import nobitex_arb.ui.controller as controller_mod
from nobitex_arb.ui.controller import AppController
from nobitex_arb.ui.server import UiServer

USDT_IRT = 1_150_000.0
BTC_USDT = 95_000.0


def _book(symbol: str, mid: float, depth: float) -> OrderBook:
    half = mid * 0.0002
    return OrderBook.build(symbol, [[mid - half, depth], [mid - 4 * half, depth * 6]],
                           [[mid + half, depth], [mid + 4 * half, depth * 6]])


class FakeFeed:
    """Stands in for NobitexFeed, with a standing dislocation on BTC/IRT."""

    mode = "fake"

    def __init__(self, *args, **kwargs) -> None:
        self.stats = FetchStats()
        self.calls = 0

    def fetch(self, symbols):
        self.stats.attempts += 1
        self.calls += 1
        return {
            "USDTIRT": _book("USDTIRT", USDT_IRT, 8_000),
            "BTCUSDT": _book("BTCUSDT", BTC_USDT, 30),
            "BTCIRT": _book("BTCIRT", USDT_IRT * BTC_USDT * 1.015, 30),
        }

    def close(self) -> None:
        pass


def write_config(tmp: Path) -> Path:
    raw = dict(DEFAULT_CONFIG)
    raw.pop("_comment")
    raw["markets"] = [
        {"symbol": "USDTIRT", "base": "USDT", "quote": "IRT"},
        {"symbol": "BTCIRT", "base": "BTC", "quote": "IRT"},
        {"symbol": "BTCUSDT", "base": "BTC", "quote": "USDT"},
    ]
    raw["db_path"] = str(tmp / "ui.db")
    raw["log_path"] = str(tmp / "ui.log")
    raw["poll_interval_sec"] = 1.0
    raw["cooldown_sec"] = 0.0
    path = tmp / "config.json"
    path.write_text(json.dumps(raw, indent=2), encoding="utf-8")
    return path


class ControllerTestBase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.config_path = write_config(self.tmp)
        self._real_feed = controller_mod.NobitexFeed
        controller_mod.NobitexFeed = FakeFeed
        self.controller = AppController(self.config_path)

    def tearDown(self):
        try:
            if self.controller.is_running:
                self.controller.stop()
        finally:
            controller_mod.NobitexFeed = self._real_feed
            self._tmp.cleanup()

    def wait_for(self, predicate, timeout=15.0):
        deadline = time.time() + timeout
        while time.time() < deadline:
            if predicate():
                return True
            time.sleep(0.05)
        return False


class TestControllerLifecycle(ControllerTestBase):
    def test_starts_and_actually_polls(self):
        """Regression: the engine's SQLite handle must be opened on its own thread."""
        res = self.controller.start()
        self.assertTrue(res["ok"], res)
        self.assertTrue(self.wait_for(lambda: self.controller.status()["polls"] >= 2),
                        f"engine never polled: {self.controller.status()['last_error']}")
        status = self.controller.status()
        self.assertEqual(status["last_error"], "")
        self.assertTrue(status["running"])
        self.assertTrue(status["markets"])

    def test_trades_a_standing_dislocation(self):
        self.controller.start()
        self.assertTrue(self.wait_for(lambda: self.controller.status()["trades"] >= 1),
                        "engine saw a 1.5% dislocation and never traded it")

    def test_stop_is_idempotent_and_leaves_a_report(self):
        self.controller.start()
        self.wait_for(lambda: self.controller.status()["polls"] >= 2)
        self.assertTrue(self.controller.stop()["ok"])
        self.assertFalse(self.controller.is_running)
        self.assertFalse(self.controller.stop()["ok"])
        runs = self.controller.runs()
        self.assertEqual(len(runs), 1)
        self.assertGreater(runs[0]["snapshots"], 0)

    def test_double_start_is_refused(self):
        self.controller.start()
        self.assertFalse(self.controller.start()["ok"])

    def test_status_before_any_run_is_idle_not_an_error(self):
        s = self.controller.status()
        self.assertFalse(s["running"])
        self.assertEqual(s["trades"], 0)
        self.assertEqual(s["balance"], s["capital"])

    def test_report_of_a_finished_run_is_json_safe(self):
        self.controller.start()
        self.wait_for(lambda: self.controller.status()["trades"] >= 1)
        self.controller.stop()
        report = self.controller.report()
        json.dumps(report)          # must not raise
        self.assertIn("verdict", report)
        self.assertGreaterEqual(report["fills"], 1)


class TestSettings(ControllerTestBase):
    def test_saves_a_valid_change(self):
        res = self.controller.save_config({"fee_rate": 0.003})
        self.assertTrue(res["ok"], res)
        self.assertAlmostEqual(self.controller.get_config()["fee_rate"], 0.003)
        self.assertAlmostEqual(self.controller.cfg.fee_rate, 0.003)

    def test_rejects_an_implausible_fee(self):
        res = self.controller.save_config({"fee_rate": 0.9})
        self.assertFalse(res["ok"])
        self.assertAlmostEqual(self.controller.get_config()["fee_rate"], 0.0025)

    def test_rejects_inverted_order_bounds(self):
        res = self.controller.save_config({"min_order_irt": 9e9})
        self.assertFalse(res["ok"])

    def test_rejects_a_poll_interval_below_the_rate_limit(self):
        self.assertFalse(self.controller.save_config({"poll_interval_sec": 0.1})["ok"])

    def test_rejects_unknown_keys(self):
        res = self.controller.save_config({"db_path_evil": "/etc/passwd"})
        self.assertFalse(res["ok"])

    def test_locked_while_running(self):
        self.controller.start()
        self.wait_for(lambda: self.controller.status()["polls"] >= 1)
        self.assertFalse(self.controller.save_config({"fee_rate": 0.003})["ok"])


class TestServer(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        tmp = Path(cls._tmp.name)
        cls._real_feed = controller_mod.NobitexFeed
        controller_mod.NobitexFeed = FakeFeed
        cls.controller = AppController(write_config(tmp))
        cls.server = UiServer(cls.controller, port=0)
        cls.server.start()
        cls.base = cls.server.url.rstrip("/")

    @classmethod
    def tearDownClass(cls):
        cls.server.stop()
        controller_mod.NobitexFeed = cls._real_feed
        cls._tmp.cleanup()

    def request(self, path, token=None, method="GET", body=None):
        req = urllib.request.Request(self.base + path, method=method)
        if token:
            req.add_header("X-Auth-Token", token)
        if body is not None:
            req.add_header("Content-Type", "application/json")
            req.data = json.dumps(body).encode()
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.status, r.read(), dict(r.headers)
        except urllib.error.HTTPError as e:
            return e.code, e.read(), dict(e.headers)

    def test_binds_to_loopback_only(self):
        self.assertEqual(self.server.host, "127.0.0.1")

    def test_index_serves_html_with_the_token_substituted(self):
        code, body, headers = self.request("/")
        self.assertEqual(code, 200)
        self.assertIn("text/html", headers["Content-Type"])
        self.assertNotIn(b"__AUTH_TOKEN__", body)
        self.assertIn(self.server.token.encode(), body)

    def test_static_assets_are_served(self):
        for path, ctype in (("/app.css", "text/css"), ("/app.js", "javascript")):
            code, body, headers = self.request(path)
            self.assertEqual(code, 200, path)
            self.assertIn(ctype, headers["Content-Type"])
            self.assertGreater(len(body), 500)

    def test_api_requires_the_token(self):
        self.assertEqual(self.request("/api/status")[0], 403)
        self.assertEqual(self.request("/api/status", token="nope")[0], 403)

    def test_api_returns_status_with_the_token(self):
        code, body, _ = self.request("/api/status", token=self.server.token)
        self.assertEqual(code, 200)
        self.assertIn("running", json.loads(body))

    def test_token_query_parameter_also_works(self):
        code, _, _ = self.request(f"/api/status?token={self.server.token}")
        self.assertEqual(code, 200)

    def test_post_without_token_cannot_start_the_engine(self):
        code, _, _ = self.request("/api/start", method="POST", body={})
        self.assertEqual(code, 403)
        self.assertFalse(self.controller.is_running)

    def test_path_traversal_is_refused(self):
        for path in ("/../config.json", "/..%2f..%2fetc%2fpasswd", "/static/../../launcher.py"):
            code, _, _ = self.request(path)
            self.assertIn(code, (403, 404), path)

    def test_unknown_api_route_is_404(self):
        self.assertEqual(self.request("/api/nope", token=self.server.token)[0], 404)

    def test_responses_carry_nosniff(self):
        _, _, headers = self.request("/")
        self.assertEqual(headers.get("X-Content-Type-Options"), "nosniff")

    def test_oversized_body_is_rejected_not_silently_accepted(self):
        code, body, _ = self.request("/api/config", token=self.server.token,
                                     method="POST", body={"pad": "x" * 300_000})
        self.assertEqual(code, 413)
        self.assertFalse(json.loads(body)["ok"])

    def test_malformed_body_is_rejected(self):
        req = urllib.request.Request(self.base + "/api/config", method="POST",
                                     data=b"{not json")
        req.add_header("X-Auth-Token", self.server.token)
        req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                code = r.status
        except urllib.error.HTTPError as e:
            code = e.code
        self.assertEqual(code, 400)

    def test_empty_body_still_reaches_the_route(self):
        code, body, _ = self.request("/api/export", token=self.server.token, method="POST")
        self.assertEqual(code, 200)
        self.assertIn("ok", json.loads(body))

    def test_concurrent_status_requests_are_safe(self):
        results = []

        def hit():
            results.append(self.request("/api/status", token=self.server.token)[0])

        threads = [threading.Thread(target=hit) for _ in range(12)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=15)
        self.assertEqual(results, [200] * 12)


if __name__ == "__main__":
    unittest.main(verbosity=2)
