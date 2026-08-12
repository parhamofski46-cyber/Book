# Build brief — turn these HTML books into sellable ebooks

Hand this whole file to Claude Code, in the folder that contains the source files.

---

## Project

Two editions of the same novel, plus a cover generator.

| File | What it is |
|---|---|
| `faramushkhaneh.html` | Persian edition — «مردی که دخترش را فراموش کرد» |
| `the-man-who-forgot-his-daughter.html` | English edition — *The Man Who Forgot His Daughter* |
| `cover.html` | Cover generator (canvas, exports 1600×2560 PNG, FA/EN toggle) |

**Author (both editions):** محمدپرهام پلنگ سنگدوینی / Mohammadparham Palangsangdovini

**Deliverables:** for each language — a validated EPUB 3, a print-ready PDF, and a cover PNG.

---

## Task 1 — Covers

Open `cover.html` in a headless browser (Playwright is fine). Wait for
`document.fonts.ready` before capturing, or the Persian text will render as boxes.

Export four PNGs by clicking the language toggle and the full-size download:

- `cover-fa.png` — 1600×2560
- `cover-en.png` — 1600×2560
- plus 600×960 web versions of each for store listings

Verify each PNG is exactly 1600×2560 and under 50 MB (Amazon's ceiling).

---

## Task 2 — EPUB

Use pandoc. Two things matter more than anything else here:

### Persian EPUB — the part that usually breaks

Persian will not render on Kindle, Kobo, or Apple Books unless the font is
**embedded inside the EPUB**. Do this:

1. Download a Persian-capable font with an open licence (Vazirmatn or Noto Naskh Arabic).
2. Embed it via `--epub-embed-font`.
3. Set RTL in the CSS: `body { direction: rtl; text-align: justify; }`
4. Set `page-progression-direction="rtl"` in the OPF spine. Pandoc will not do this
   itself — unzip the EPUB, patch `content.opf`, rezip with `mimetype` stored
   uncompressed and first in the archive, or the file will be rejected.

### Metadata

Read the author from `<meta name="author">` in each HTML file. Build an
`epub-metadata.yaml` per language with: title, author, language (`fa` / `en`),
publisher, rights, and a UUID identifier. Give each language its **own** UUID —
they are two different books in every store.

### Structure

The HTML uses `<h3>` for chapter titles and `<h2>` for the three book dividers.
Set `--toc --toc-depth=2` and make sure the generated navigation lists all 23
chapters plus the interlude, in order. Check the interlude sits between chapter 17
and chapter 18 — that placement is deliberate, not a mistake.

Keep the styled elements intact: `.letter` (Dalaram's letter), `.journal`
(the interlude's diary entries), `.ledger`, `.names`, `.brk` scene breaks, and the
drop caps on `.lead`. If a reader strips the drop cap, that's acceptable; if it
strips the letter and journal styling, fix the CSS — those blocks need to read as
documents, not as body text.

---

## Task 3 — PDF

Use Chromium print-to-PDF (weasyprint mishandles RTL). Page size 6×9 inches,
0.75in margins, and add `@media print` rules so:

- each `<section class="chapter">` starts on a new page
- the cover, part dividers, and colophon each get their own page
- `.brk`, `.letter`, and `.journal` blocks never split across a page break
- no orphans or widows on paragraph breaks

---

## Task 4 — Validate

Run `epubcheck` on both EPUBs. Zero errors — Amazon rejects on any error, and
warnings about unusual CSS are fine to ignore. Then open both EPUBs in Calibre's
viewer and confirm by eye:

- Persian reads right-to-left and the letters are joined (if letters appear
  separated, some CSS `letter-spacing` survived — remove it, it breaks Persian script)
- the cover image is the first page
- the table of contents jumps correctly
- chapter numbering runs 1–23 with no gaps and no repeats

---

## Output

```
build/
  fa/  faramushkhaneh.epub   faramushkhaneh.pdf   cover-fa.png
  en/  the-man-who-forgot-his-daughter.epub  ...pdf  cover-en.png
```

Write a `Makefile` or `build.sh` so the whole thing can be re-run after any text
edit. I will be revising the manuscript, so the build has to be repeatable.

Report back with the epubcheck output and the final file sizes.
