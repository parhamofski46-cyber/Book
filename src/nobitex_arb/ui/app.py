"""Desktop entry point.

Starts the engine controller and a localhost HTTP server, then shows the UI
in a native window. WebView2 ships with Windows 11, so the native window is
the normal path; if it is unavailable the app falls back to the default
browser plus a small control window so there is always a way to quit.
"""

from __future__ import annotations

import logging
import os
import sys
import threading
import webbrowser
from pathlib import Path

from ..config import Config
from .controller import AppController
from .server import UiServer

log = logging.getLogger("ui.app")

WINDOW_TITLE = "آزمایشگاه آربیتراژ مثلثی — نوبیتکس"


def app_dir() -> Path:
    """Where config, data and reports live.

    Next to the .exe when frozen, so a user who moves the executable takes
    their database with it; the working directory otherwise.
    """
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    return Path.cwd()


def _setup_logging(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        handlers=[logging.FileHandler(path, encoding="utf-8")],
    )


def _fallback_window(url: str, on_close) -> None:
    """A tiny always-there control window when no webview is available."""
    try:
        import tkinter as tk
    except Exception:
        log.warning("no tkinter either; blocking until interrupted")
        try:
            threading.Event().wait()
        except KeyboardInterrupt:
            pass
        finally:
            on_close()
        return

    root = tk.Tk()
    root.title("Arbitrage Paper Lab")
    root.geometry("430x180")
    root.configure(bg="#1a1a19")
    opts = {"bg": "#1a1a19", "fg": "#e9e7e3", "font": ("Segoe UI", 10)}
    tk.Label(root, text="The app is running in your browser.", **opts).pack(pady=(26, 4))
    tk.Label(root, text=url, fg="#3987e5", bg="#1a1a19", font=("Consolas", 10)).pack()
    tk.Button(root, text="Open in browser", command=lambda: webbrowser.open(url),
              bg="#3987e5", fg="#ffffff", relief="flat", padx=14, pady=5,
              font=("Segoe UI", 9, "bold")).pack(pady=12)
    tk.Label(root, text="Closing this window quits the app.",
             bg="#1a1a19", fg="#898781", font=("Segoe UI", 8)).pack()

    def quit_app() -> None:
        on_close()
        root.destroy()

    root.protocol("WM_DELETE_WINDOW", quit_app)
    root.mainloop()


def main(argv: list[str] | None = None) -> int:
    base = app_dir()
    os.chdir(base)

    config_path = base / "config.json"
    Config.load(config_path)          # creates the file with defaults on first run
    _setup_logging(base / "data" / "app.log")

    controller = AppController(config_path)
    server = UiServer(controller)
    server.start()
    url = server.url
    log.info("ui listening on %s", url)

    stopping = threading.Event()

    def shutdown() -> None:
        if stopping.is_set():
            return
        stopping.set()
        try:
            if controller.is_running:
                controller.stop()
        except Exception:
            log.exception("engine did not stop cleanly")
        try:
            server.stop()
        except Exception:
            log.exception("server did not stop cleanly")

    try:
        import webview  # type: ignore

        window = webview.create_window(
            WINDOW_TITLE, url, width=1360, height=880, min_size=(980, 660),
            background_color="#0d0d0d",
        )
        window.events.closed += shutdown
        webview.start()
    except ImportError:
        log.info("pywebview unavailable; using the browser fallback")
        webbrowser.open(url)
        _fallback_window(url, shutdown)
    except Exception:
        log.exception("native window failed; using the browser fallback")
        webbrowser.open(url)
        _fallback_window(url, shutdown)

    shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
