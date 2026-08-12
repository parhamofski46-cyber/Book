#!/usr/bin/env python3
"""Fetch the OFL fonts both editions need, as TTF, into assets/fonts/.

Idempotent: files already on disk are left alone, so re-running the build is cheap.
Everything here is Open Font Licence, which is what lets us embed it in a sold ebook.
"""
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "fonts"

# A UA with no advertised woff/woff2 support makes the Google Fonts API hand back
# plain TTF — pandoc's --epub-embed-font and fontconfig both want real font files,
# and an IE-era UA gets you EOT instead. This path serves one face per request, so
# each entry below pins a single weight/style rather than a whole family.
UA = "Mozilla/5.0 (X11; Linux x86_64)"
API = "https://fonts.googleapis.com/css2?family={}&display=swap"

WANTED = {
    # Persian edition
    "Vazirmatn-Light.ttf": "Vazirmatn:wght@300",
    "Vazirmatn-Regular.ttf": "Vazirmatn:wght@400",
    "Vazirmatn-Bold.ttf": "Vazirmatn:wght@700",
    "NotoNaskhArabic-Regular.ttf": "Noto+Naskh+Arabic:wght@400",
    "NotoNaskhArabic-Bold.ttf": "Noto+Naskh+Arabic:wght@700",
    "NotoNastaliqUrdu-Regular.ttf": "Noto+Nastaliq+Urdu:wght@400",
    # English edition
    "EBGaramond-Regular.ttf": "EB+Garamond:ital,wght@0,400",
    "EBGaramond-Medium.ttf": "EB+Garamond:ital,wght@0,500",
    "EBGaramond-Italic.ttf": "EB+Garamond:ital,wght@1,400",
    "CormorantGaramond-Regular.ttf": "Cormorant+Garamond:ital,wght@0,400",
    "CormorantGaramond-SemiBold.ttf": "Cormorant+Garamond:ital,wght@0,600",
    "CormorantGaramond-Italic.ttf": "Cormorant+Garamond:ital,wght@1,400",
    "Inter-Light.ttf": "Inter:wght@300",
    "Inter-Regular.ttf": "Inter:wght@400",
    "Inter-SemiBold.ttf": "Inter:wght@600",
}

# The OFL requires its text to travel with the fonts, and these fonts are
# embedded in a book that gets sold, so the licences ship in assets/fonts/.
LICENCES = {
    "OFL-Vazirmatn.txt": "vazirmatn",
    "OFL-NotoNaskhArabic.txt": "notonaskharabic",
    "OFL-NotoNastaliqUrdu.txt": "notonastaliqurdu",
    "OFL-EBGaramond.txt": "ebgaramond",
    "OFL-CormorantGaramond.txt": "cormorantgaramond",
    "OFL-Inter.txt": "inter",
}
LICENCE_URL = "https://raw.githubusercontent.com/google/fonts/main/ofl/{}/OFL.txt"

SRC = re.compile(r"src:\s*url\(([^)]+)\)")


def fetch(url, text=False):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    return data.decode("utf-8") if text else data


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    missing = []
    for name, query in WANTED.items():
        target = OUT / name
        if target.exists() and target.stat().st_size > 0:
            print(f"  = {name} (cached)")
            continue
        match = SRC.search(fetch(API.format(query), text=True))
        if not match:
            missing.append(f"{name} ({query})")
            continue
        target.write_bytes(fetch(match.group(1)))
        print(f"  + {name}  ({target.stat().st_size // 1024} KB)")

    for name, family in LICENCES.items():
        target = OUT / name
        if target.exists() and target.stat().st_size > 0:
            continue
        try:
            target.write_bytes(fetch(LICENCE_URL.format(family)))
            print(f"  + {name}")
        except Exception as exc:  # noqa: BLE001 - a missing licence is worth naming
            missing.append(f"{name} ({exc})")

    if missing:
        print("\nCould not resolve:\n  " + "\n  ".join(missing), file=sys.stderr)
        return 1
    print(f"Fonts ready in {OUT.relative_to(ROOT)}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
