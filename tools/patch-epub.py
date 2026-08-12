#!/usr/bin/env python3
"""Apply the direction settings pandoc will not write, then repackage the EPUB.

Pandoc emits a correct EPUB 3 but leaves two things undone for a right-to-left
book, and EPUB 3.3 will not let you fix either one from the stylesheet (the CSS
`direction` property is banned outright — epubcheck CSS-001):

  * `page-progression-direction="rtl"` on the OPF spine, which is what tells a
    reader to page backwards and put the spine on the right
  * `dir="rtl"` on every XHTML root element, which is what actually lays the
    text out right-to-left

Repackaging matters as much as the patch: `mimetype` has to be the first entry
in the archive and stored uncompressed, or the file is rejected as not an EPUB.
Python's zipfile will happily write a valid-looking archive that no store
accepts, so the order and compression are set explicitly below.

Usage: tools/patch-epub.py build/fa/faramushkhaneh.epub --dir rtl
"""
import argparse
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

SPINE = re.compile(r"<spine\b[^>]*>")
HTML_TAG = re.compile(r"<html\b[^>]*>")


def patch_spine(opf: Path, direction: str) -> bool:
    text = opf.read_text(encoding="utf-8")
    match = SPINE.search(text)
    if not match:
        raise SystemExit(f"{opf}: no <spine> element found")
    tag = match.group(0)
    if "page-progression-direction" in tag:
        new = re.sub(
            r'page-progression-direction="[^"]*"',
            f'page-progression-direction="{direction}"',
            tag,
        )
    else:
        new = tag[:-1].rstrip() + f' page-progression-direction="{direction}">'
    if new == tag:
        return False
    opf.write_text(text.replace(tag, new, 1), encoding="utf-8")
    return True


def patch_html_dir(path: Path, direction: str) -> bool:
    text = path.read_text(encoding="utf-8")
    match = HTML_TAG.search(text)
    if not match:
        return False
    tag = match.group(0)
    if re.search(r'\bdir="[^"]*"', tag):
        new = re.sub(r'\bdir="[^"]*"', f'dir="{direction}"', tag)
    else:
        new = tag[:-1].rstrip() + f' dir="{direction}">'
    if new == tag:
        return False
    path.write_text(text.replace(tag, new, 1), encoding="utf-8")
    return True


def repackage(root: Path, target: Path) -> None:
    mimetype = root / "mimetype"
    if not mimetype.exists():
        raise SystemExit(f"{root}: no mimetype file to store first")

    files = sorted(p for p in root.rglob("*") if p.is_file() and p != mimetype)
    with zipfile.ZipFile(target, "w") as zf:
        # First entry, stored, no extra fields — this is what identifies the file
        # as an EPUB before anything else in the archive is read.
        zf.write(mimetype, "mimetype", compress_type=zipfile.ZIP_STORED)
        for path in files:
            zf.write(path, str(path.relative_to(root)), compress_type=zipfile.ZIP_DEFLATED)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("epub", type=Path)
    ap.add_argument("--dir", dest="direction", choices=["rtl", "ltr"], required=True)
    args = ap.parse_args()

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        with zipfile.ZipFile(args.epub) as zf:
            zf.extractall(root)

        opfs = list(root.rglob("*.opf"))
        if not opfs:
            raise SystemExit(f"{args.epub}: no .opf found")
        for opf in opfs:
            patch_spine(opf, args.direction)

        touched = sum(
            patch_html_dir(p, args.direction)
            for p in sorted(root.rglob("*.xhtml")) + sorted(root.rglob("*.html"))
        )

        staged = Path(tmp + ".epub")
        repackage(root, staged)
        shutil.move(str(staged), args.epub)

    size = args.epub.stat().st_size / 1024 / 1024
    print(
        f"  ~ {args.epub}  page-progression-direction={args.direction}, "
        f"dir on {touched} documents, {size:.2f} MB"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
