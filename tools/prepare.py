#!/usr/bin/env python3
"""Rewrite an edition's HTML into the semantic shape pandoc's EPUB writer wants.

The source files are designed for the screen: one long scroll of <section>s, a
hand-written contents page, a full-bleed cover, and chapter headings split across
a <div class="chapter-num"> and an <h3>. None of that survives contact with an
EPUB reader intact, so this script:

  * drops the screen cover and the hand-written contents page (the EPUB gets a
    real cover image and a real generated nav)
  * folds "Chapter One" + "The Three O'Clock Customer" into one heading, so the
    navigation reads the way a reader expects
  * promotes part dividers to <h1> and chapters to <h2>, which is what makes
    --toc-depth=2 list every chapter (the source's <h3> would fall below it)
  * lifts the decorative part-divider SVGs out to real image files, so the XHTML
    stays valid instead of carrying raw un-namespaced <svg> through
  * pushes the per-part accent class down onto the elements that use it, because
    EPUB readers cannot be trusted with CSS custom properties
  * keeps .letter, .journal, .ledger, .names, .brk and .lead exactly as they are

Usage: tools/prepare.py --lang fa --src src/faramushkhaneh.html --out build/fa
"""
import argparse
import re
import sys
from pathlib import Path

from bs4 import BeautifulSoup

# Heading text for the front-matter section that has a chapter-num but no <h3>.
# Everything else is discovered from the markup itself.
PART_CLASS = re.compile(r"^p[123]$")


def classes(tag):
    return tag.get("class", []) if hasattr(tag, "get") else []


def accent_of(section):
    """The p1/p2/p3 class that decides this section's accent colour."""
    for c in classes(section):
        if PART_CLASS.match(c):
            return c
    return None


def strip_inline_styles(node):
    """Inline styles reference CSS variables that will not exist in the EPUB."""
    for tag in node.find_all(style=True):
        del tag["style"]
    if node.has_attr("style"):
        del node["style"]


def propagate_accent(node, accent):
    """Give .orn and .brk their accent colour as a real class, not a variable."""
    if not accent:
        return
    for tag in node.find_all(class_=["orn", "brk"]):
        tag["class"] = list(tag.get("class", [])) + [accent]


def unwrap_wraps(node):
    for w in node.find_all("div", class_="wrap"):
        w.unwrap()


def fix_names_lists(soup, node):
    """<ul class="names"> and <li class="me"> lose their classes in pandoc's AST
    (lists and list items carry no attributes), so move the hooks somewhere that
    survives: a wrapper div and an inner span."""
    for ul in node.find_all("ul", class_="names"):
        ul["class"] = [c for c in ul.get("class", []) if c != "names"]
        if not ul["class"]:
            del ul["class"]
        for li in ul.find_all("li", class_="me"):
            span = soup.new_tag("span")
            span["class"] = ["me"]
            for child in list(li.contents):
                span.append(child.extract())
            li.append(span)
            del li["class"]
        wrapper = soup.new_tag("div")
        wrapper["class"] = ["names"]
        ul.wrap(wrapper)


def heading(soup, level, parts, extra_classes):
    """A heading whose text reads well in the navigation ("Chapter One — Nights")
    but stacks on two lines on the page itself, via a separator span the
    stylesheet hides."""
    h = soup.new_tag(f"h{level}")
    h["class"] = extra_classes
    for i, (cls, text) in enumerate(parts):
        if i:
            sep = soup.new_tag("span")
            sep["class"] = ["numsep"]
            sep.string = " — "
            h.append(sep)
        span = soup.new_tag("span")
        span["class"] = [cls]
        span.string = text
        h.append(span)
    return h


def text_of(tag):
    return tag.get_text(" ", strip=True) if tag else ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lang", required=True)
    ap.add_argument("--src", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    args = ap.parse_args()

    src = BeautifulSoup(args.src.read_text(encoding="utf-8"), "html.parser")

    media = args.out / "media"
    media.mkdir(parents=True, exist_ok=True)

    out = BeautifulSoup(
        '<!DOCTYPE html>\n<html><head><meta charset="utf-8"></head><body></body></html>',
        "html.parser",
    )
    html = out.find("html")
    html["lang"] = args.lang
    html["dir"] = "rtl" if args.lang == "fa" else "ltr"
    title = src.find("title")
    head = out.find("head")
    if title:
        t = out.new_tag("title")
        t.string = title.get_text(strip=True)
        head.append(t)
    body = out.find("body")

    part_index = 0
    counts = {"part": 0, "chapter": 0, "front": 0}

    for section in src.find("body").find_all("section", recursive=False):
        cls = classes(section)

        # The screen cover is replaced by the real cover image.
        if "cover" in cls:
            continue
        # The hand-written contents page is replaced by the generated nav.
        if section.find("div", class_="toc"):
            continue

        strip_inline_styles(section)
        accent = accent_of(section)

        if "epigraph" in cls:
            div = out.new_tag("div")
            div["class"] = ["epigraph"]
            for child in list(section.find("div", class_="wrap").contents):
                div.append(child.extract())
            body.append(div)
            continue

        if "part" in cls:
            part_index += 1
            counts["part"] += 1
            svg = section.find("svg")
            label = text_of(section.find("div", class_="label"))
            name = text_of(section.find("h2"))
            note = text_of(section.find("div", class_="note"))

            body.append(heading(out, 1, [("part-label", label), ("part-name", name)], ["part-h"]))
            if svg:
                # Raw <svg> without a namespace makes epubcheck fail; a real .svg
                # file referenced by <img> is valid everywhere and keeps the art.
                svg["xmlns"] = "http://www.w3.org/2000/svg"
                path = media / f"part-{part_index}.svg"
                path.write_text(str(svg), encoding="utf-8")
                img = out.new_tag("img", src=f"media/{path.name}", alt="")
                img["class"] = ["part-mark"]
                body.append(img)
            if note:
                p = out.new_tag("p")
                p["class"] = ["part-note"]
                p.string = note
                body.append(p)
            continue

        if "end" in cls:
            div = out.new_tag("div")
            div["class"] = ["the-end"]
            for child in list(section.contents):
                div.append(child.extract())
            body.append(div)
            continue

        # Everything left is a .chapter section: prologue, a numbered chapter,
        # the interlude, or the colophon.
        head_div = section.find("div", class_="chapter-head")
        wrap = section.find("div", class_="wrap")

        if head_div is None:
            # Colophon — no heading of its own, so it rides along after the last
            # chapter and is pushed onto a fresh page by the stylesheet.
            div = out.new_tag("div")
            div["class"] = ["colophon"]
            source = wrap or section
            strip_inline_styles(source)
            for child in list(source.contents):
                div.append(child.extract())
            body.append(div)
            continue

        num = text_of(head_div.find("div", class_="chapter-num"))
        h3 = head_div.find("h3")
        head_div.extract()

        if h3 is None:
            # Prologue: a front-matter unit, so it sits at part level.
            counts["front"] += 1
            body.append(heading(out, 1, [("front-name", num)], ["front-h"]))
        else:
            counts["chapter"] += 1
            extra = ["chapter-h"]
            if "midbreak" in cls:
                extra.append("midbreak-h")
            body.append(
                heading(out, 2, [("chapter-num", num), ("chapter-title", text_of(h3))], extra)
            )

        unwrap_wraps(section)
        propagate_accent(section, accent)
        fix_names_lists(out, section)

        holder = body
        if "midbreak" in cls:
            # The interlude is set as a dark spread; keep a hook the CSS can scope to.
            holder = out.new_tag("div")
            holder["class"] = ["midbreak"]
            body.append(holder)

        for child in list(section.contents):
            holder.append(child.extract())

    args.out.mkdir(parents=True, exist_ok=True)
    target = args.out / "body.html"
    target.write_text(str(out), encoding="utf-8")
    print(
        f"  + {target}  "
        f"{counts['part']} parts, {counts['chapter']} chapter-level headings, "
        f"{counts['front']} front-matter headings"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
