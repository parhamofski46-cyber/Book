"""Entry point for the packaged executable.

Kept at the project root and deliberately tiny: PyInstaller freezes this
module, and anything heavy here would run before the window appears.
"""

from __future__ import annotations

import sys
from pathlib import Path

if not getattr(sys, "frozen", False):
    sys.path.insert(0, str(Path(__file__).parent / "src"))


def main() -> int:
    try:
        from nobitex_arb.ui.app import main as ui_main
        return ui_main()
    except Exception:
        # A frozen windowed app has no console, so a crash would otherwise be
        # silent. Write the traceback next to the executable and show it.
        import traceback

        base = Path(sys.executable).parent if getattr(sys, "frozen", False) else Path.cwd()
        report = base / "crash.log"
        try:
            report.write_text(traceback.format_exc(), encoding="utf-8")
        except Exception:
            pass
        try:
            import tkinter as tk
            from tkinter import scrolledtext

            root = tk.Tk()
            root.title("Arbitrage Lab - startup failed")
            root.geometry("760x420")
            box = scrolledtext.ScrolledText(root, wrap="word")
            box.insert("1.0", f"The application could not start.\n\nSaved to: {report}\n\n"
                              + traceback.format_exc())
            box.pack(fill="both", expand=True)
            root.mainloop()
        except Exception:
            traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
