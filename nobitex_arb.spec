# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller build spec. Run build_exe.bat rather than invoking this directly."""

from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

SPEC_DIR = Path(SPECPATH)
ICON = SPEC_DIR / "assets" / "icon.ico"


def optional_data_files(name):
    """Package data for an optional dependency, or nothing if it is absent."""
    try:
        return collect_data_files(name)
    except Exception:
        return []


def optional_submodules(name):
    """Collect a package's submodules, or nothing if it is not installed.

    pywebview is optional: without it the app falls back to the browser, so a
    missing package must not be allowed to fail the whole build.
    """
    try:
        return collect_submodules(name)
    except Exception as exc:  # noqa: BLE001 - any import-time failure is equivalent here
        print(f"[spec] {name} not available ({exc.__class__.__name__}); "
              f"the build will use the browser fallback")
        return []

a = Analysis(
    [str(SPEC_DIR / "launcher.py")],
    pathex=[str(SPEC_DIR / "src")],
    binaries=[],
    # The UI is a real HTML/CSS/JS front end, so those files must travel with
    # the executable; PyInstaller only picks up imported .py modules by itself.
    datas=[
        (str(SPEC_DIR / "src" / "nobitex_arb" / "ui" / "static"), "nobitex_arb/ui/static"),
        *optional_data_files("webview"),   # pywebview ships its own JS bridge
    ],
    hiddenimports=optional_submodules("webview") + [
        "nobitex_arb.ui.controller",
        "nobitex_arb.ui.server",
    ],
    hookspath=[],
    runtime_hooks=[],
    excludes=[
        # Nothing here plots, tests, or does numerics -- keep the binary small.
        "matplotlib", "numpy", "pandas", "scipy", "PIL", "pytest", "unittest",
        "tkinter.test", "test", "pydoc_data",
    ],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="ArbitrageLab",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    runtime_tmpdir=None,
    console=False,          # windowed app: no console flashing behind the UI
    disable_windowed_traceback=False,
    icon=str(ICON) if ICON.exists() else None,
)
