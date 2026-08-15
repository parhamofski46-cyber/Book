# مردی که دخترش را فراموش کرد / The Man Who Forgot His Daughter

Two editions of one novel by محمدپرهام پلنگ سنگدوینی / Mohammadparham
Palangsangdovini, built from HTML into sellable ebooks.

Each edition ships as a validated EPUB 3, a 6×9in print-ready PDF, and a cover
PNG at Amazon KDP's dimensions.

## Build

```sh
./build.sh              # everything, then validate
./build.sh fa           # Persian only
./build.sh en           # English only
./build.sh covers       # redraw the covers
./build.sh check        # epubcheck + structural verification
```

`make` does the same with dependency tracking, so editing one edition's HTML
rebuilds only that edition:

```sh
make            # both editions, then validate
make fa         # Persian only
make clean
```

### Requirements

| Tool | Why | Notes |
|---|---|---|
| `pandoc` 3.x | EPUB generation | `PANDOC=/path/to/pandoc` to override |
| `node` 18+ with `playwright` | covers and PDFs | `npm install playwright` |
| Chromium | canvas rendering, print-to-PDF | auto-detected; `CHROMIUM_PATH` to override |
| `python3` with `beautifulsoup4` | HTML restructuring | `pip install beautifulsoup4` |
| `java` + `epubcheck.jar` | validation | `EPUBCHECK=/path/to/epubcheck.jar` |

Validation is skipped with a notice when `EPUBCHECK` is unset, so the build
still runs without it.

Fonts download themselves into `assets/fonts/` on first build and are cached
after that. All are Open Font Licence; the licence texts sit beside them.

## Editing the manuscript

Edit `src/faramushkhaneh.html` or `src/the-man-who-forgot-his-daughter.html`
and re-run the build. The pipeline reads the structure out of the markup rather
than from a hard-coded list, so adding or reordering a chapter needs no change
here — as long as the existing shape holds:

- `<section class="chapter">` per chapter, with a `<div class="chapter-num">`
  and an `<h3>` inside `<div class="chapter-head">`
- `<section class="part">` for the three book dividers
- the interlude carries `class="chapter midbreak"`

`tools/verify-epub.py` re-checks chapter numbering, the interlude's position,
and the navigation after every build, so a mistake in the markup surfaces as a
failed check rather than as a broken store upload.

## Layout

```
src/          the two editions and the cover generator (the manuscript)
assets/css/   EPUB and print stylesheets
assets/fonts/ downloaded OFL fonts + their licences
metadata/     per-edition EPUB metadata, each with its own fixed UUID
tools/        build steps, each runnable on its own
build/        output: fa/ and en/
```

## Notes on the two formats

**EPUB.** Persian is embedded with Vazirmatn, Noto Naskh Arabic and Noto
Nastaliq Urdu, because no major reader ships a Persian face. Right-to-left is
declared through `dir` attributes and the OPF spine's
`page-progression-direction`, not through CSS — EPUB 3.3 forbids the CSS
`direction` property, and epubcheck rejects it.

**PDF.** Rendered by Chromium rather than weasyprint, which mishandles
Arabic-script shaping and bidi.

**No drop cap in the Persian edition.** A floated `::first-letter` lifts the
initial letter out of its word; in Arabic script that destroys the joined form,
so «هر» would set as «ه» plus a stranded «ر». The English edition keeps its
drop cap.
