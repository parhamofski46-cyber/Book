#!/usr/bin/env python3
"""Check the things a human would otherwise have to confirm by eye in a reader.

Covers the acceptance list for both editions: the cover is the first page, every
navigation link resolves to a real target, chapter numbering runs 1-23 with no
gap and no repeat, the interlude sits between 17 and 18, right-to-left is
actually declared, and — for Persian — no letter-spacing survived anywhere,
since that is what silently breaks joined Arabic script.

Usage: tools/verify-epub.py build/fa/faramushkhaneh.epub --lang fa
"""
import argparse
import posixpath
import re
import sys
import zipfile
from pathlib import PurePosixPath

ORDINALS = {
    "fa": [
        "یک", "دو", "سه", "چهار", "پنج", "شش", "هفت", "هشت", "نه", "ده",
        "یازده", "دوازده", "سیزده", "چهارده", "پانزده", "شانزده", "هفده",
        "هجده", "نوزده", "بیست", "بیست‌ویک", "بیست‌ودو", "بیست‌وسه",
    ],
    "en": [
        "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
        "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
        "Seventeen", "Eighteen", "Nineteen", "Twenty", "Twenty-One",
        "Twenty-Two", "Twenty-Three",
    ],
}
INTERLUDE = {"fa": "میان‌پرده", "en": "Interlude"}
CHAPTER_WORD = {"fa": "فصل", "en": "Chapter"}

NAV_LINK = re.compile(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', re.S)
CHAPTER_NUM = re.compile(r'<span class="chapter-num">(.*?)</span>', re.S)
ID_ATTR = re.compile(r'\bid="([^"]+)"')
TAGS = re.compile(r"<[^>]+>")


class Report:
    def __init__(self):
        self.failures = []

    def check(self, ok, label, detail=""):
        print(f"  {'PASS' if ok else 'FAIL'}  {label}" + (f" — {detail}" if detail else ""))
        if not ok:
            self.failures.append(label)


def text_of(fragment):
    return TAGS.sub("", fragment).strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("epub")
    ap.add_argument("--lang", required=True, choices=["fa", "en"])
    args = ap.parse_args()
    lang = args.lang
    r = Report()

    print(f"\n{args.epub} ({lang})")
    with zipfile.ZipFile(args.epub) as zf:
        names = zf.namelist()
        read = lambda n: zf.read(n).decode("utf-8")

        # mimetype must be the first entry and stored uncompressed.
        info = zf.infolist()[0]
        r.check(
            info.filename == "mimetype" and info.compress_type == zipfile.ZIP_STORED,
            "mimetype is first and uncompressed",
            f"{info.filename}, compress_type={info.compress_type}",
        )

        opf_name = next(n for n in names if n.endswith(".opf"))
        opf = read(opf_name)
        opf_dir = PurePosixPath(opf_name).parent

        want_dir = "rtl" if lang == "fa" else "ltr"
        r.check(
            f'page-progression-direction="{want_dir}"' in opf,
            f'spine declares page-progression-direction="{want_dir}"',
        )

        # Cover: first spine item, and a cover image in the manifest.
        spine = re.search(r"<spine.*?</spine>", opf, re.S).group(0)
        first = re.search(r'<itemref[^>]+idref="([^"]+)"', spine).group(1)
        r.check("cover" in first.lower(), "first spine item is the cover", first)
        r.check(
            'properties="cover-image"' in opf,
            "manifest marks a cover image",
            next((n for n in names if "cover" in n.lower() and n.endswith(".png")), "none"),
        )

        # Every nav link resolves to a real document, and to a real id when anchored.
        nav_name = next(n for n in names if n.endswith("nav.xhtml"))
        nav = read(nav_name)
        nav_dir = PurePosixPath(nav_name).parent
        broken = []
        for href, _ in NAV_LINK.findall(nav):
            if href.startswith("#"):
                continue
            path, _, frag = href.partition("#")
            target = str(PurePosixPath(nav_dir) / path)
            if target not in names:
                broken.append(href)
            elif frag and f'id="{frag}"' not in read(target):
                broken.append(href)
        r.check(not broken, "every navigation link resolves", f"{len(broken)} broken: {broken[:3]}")

        # Chapter numbering, in reading order, from the spine.
        order = re.findall(r'<itemref[^>]+idref="([^"]+)"', spine)
        hrefs = dict(re.findall(r'<item[^>]+id="([^"]+)"[^>]+href="([^"]+)"', opf))
        hrefs.update(dict(
            (m.group(2), m.group(1))
            for m in re.finditer(r'<item[^>]+href="([^"]+)"[^>]+id="([^"]+)"', opf)
        ))
        seen = []
        for idref in order:
            href = hrefs.get(idref)
            if not href:
                continue
            target = str(PurePosixPath(opf_dir) / href)
            if target not in names or target == nav_name:
                continue
            for num in CHAPTER_NUM.findall(read(target)):
                seen.append(text_of(num))

        expected = [f"{CHAPTER_WORD[lang]} {w}" for w in ORDINALS[lang]]
        chapters = [s for s in seen if s != INTERLUDE[lang]]
        r.check(
            chapters == expected,
            "chapters run 1-23 in order, no gaps or repeats",
            f"{len(chapters)} found" + ("" if chapters == expected else f"; got {chapters[:3]}…"),
        )
        r.check(seen.count(INTERLUDE[lang]) == 1, "exactly one interlude")
        if INTERLUDE[lang] in seen:
            i = seen.index(INTERLUDE[lang])
            r.check(
                seen[i - 1] == expected[16] and seen[i + 1] == expected[17],
                "interlude sits between chapter 17 and chapter 18",
                f"{seen[i-1]} / {INTERLUDE[lang]} / {seen[i+1]}",
            )

        # Direction on the documents themselves.
        docs = [n for n in names if n.endswith(".xhtml")]
        missing_dir = []
        for n in docs:
            tag = re.search(r"<html\b[^>]*>", read(n))
            if not tag or f'dir="{want_dir}"' not in tag.group(0):
                missing_dir.append(n)
        r.check(
            not missing_dir,
            f'every document carries dir="{want_dir}"',
            f"{len(docs) - len(missing_dir)}/{len(docs)}",
        )

        # Fonts: declared in CSS and actually present in the archive.
        css_name = next(n for n in names if n.endswith(".css"))
        css = read(css_name)
        css_dir = PurePosixPath(css_name).parent
        refs = re.findall(r'url\("([^"]+)"\)', css)
        absent = [u for u in refs if posixpath.normpath(posixpath.join(str(css_dir), u)) not in names]
        r.check(
            refs and not absent,
            "every @font-face file is embedded",
            f"{len(refs)} faces" + (f"; missing {absent}" if absent else ""),
        )

        if lang == "fa":
            # letter-spacing is what silently breaks joined Persian script.
            offenders = [
                line.strip()
                for line in css.splitlines()
                if "letter-spacing" in line and not line.strip().startswith("*")
            ]
            r.check(not offenders, "no letter-spacing in the Persian stylesheet", str(offenders[:2]))
            r.check("direction:" not in css, "no CSS direction property (EPUB 3.3 forbids it)")

    if r.failures:
        print(f"\n{len(r.failures)} check(s) failed")
        return 1
    print("  all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
