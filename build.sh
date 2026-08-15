#!/usr/bin/env bash
# Build both editions from src/ into build/.
#
#   ./build.sh            everything
#   ./build.sh covers     covers only
#   ./build.sh fa         Persian EPUB + PDF
#   ./build.sh en         English EPUB + PDF
#   ./build.sh check      epubcheck + structural verification
#   ./build.sh verify     structural verification only
#
# Safe to re-run after any edit to the source HTML — every step overwrites its
# own output and nothing is incremental except the font download.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PANDOC="${PANDOC:-pandoc}"
EPUBCHECK="${EPUBCHECK:-}"        # path to epubcheck.jar; skipped when unset
NODE="${NODE:-node}"

FA_FONTS=(Vazirmatn-Light Vazirmatn-Regular Vazirmatn-Bold
          NotoNaskhArabic-Regular NotoNaskhArabic-Bold NotoNastaliqUrdu-Regular)
EN_FONTS=(EBGaramond-Regular EBGaramond-Medium EBGaramond-Italic
          CormorantGaramond-Regular CormorantGaramond-SemiBold CormorantGaramond-Italic
          Inter-Light Inter-Regular Inter-SemiBold)

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "error: $1 not found on PATH" >&2
    exit 1
  }
}

fonts() {
  say "Fonts"
  python3 tools/fetch-fonts.py
}

covers() {
  say "Covers"
  need "$NODE"
  "$NODE" tools/render-cover.mjs
}

# Covers are an input to both EPUBs; re-rendering them on every edition build
# would keep retriggering make. Only draw them when they are missing.
covers_once() {
  if [ -s build/fa/cover-fa.png ] && [ -s build/en/cover-en.png ]; then
    say "Covers"
    echo "  = already rendered (run './build.sh covers' to redraw)"
  else
    covers
  fi
}

# epub <lang> <src html> <output name> <font list...>
epub() {
  local lang="$1" src="$2" name="$3"
  shift 3
  local fonts=("$@")

  local out="build/$lang"
  local target="$out/$name.epub"
  local dir="ltr"
  [ "$lang" = "fa" ] && dir="rtl"

  python3 tools/prepare.py --lang "$lang" --src "$src" --out "$out"

  local embed=()
  for f in "${fonts[@]}"; do embed+=("--epub-embed-font=assets/fonts/$f.ttf"); done

  "$PANDOC" "$out/body.html" \
    --from=html \
    --to=epub3 \
    --metadata-file="metadata/epub-$lang.yaml" \
    --css="assets/css/epub-$lang.css" \
    --epub-cover-image="$out/cover-$lang.png" \
    "${embed[@]}" \
    --toc --toc-depth=2 \
    --split-level=2 \
    --resource-path="$out:." \
    --output="$target"

  # Pandoc cannot write page-progression-direction or the per-document dir
  # attribute, and EPUB 3.3 forbids setting direction from CSS.
  python3 tools/patch-epub.py "$target" --dir "$dir"
}

pdf() {
  local lang="$1" src="$2" name="$3"
  need "$NODE"
  "$NODE" tools/render-pdf.mjs --lang "$lang" --src "$src" --out "build/$lang/$name.pdf"
}

edition_fa() {
  say "Persian edition"
  epub fa src/faramushkhaneh.html faramushkhaneh "${FA_FONTS[@]}"
  pdf fa src/faramushkhaneh.html faramushkhaneh
}

edition_en() {
  say "English edition"
  epub en src/the-man-who-forgot-his-daughter.html the-man-who-forgot-his-daughter "${EN_FONTS[@]}"
  pdf en src/the-man-who-forgot-his-daughter.html the-man-who-forgot-his-daughter
}

check() {
  say "Validation"
  if [ -z "$EPUBCHECK" ]; then
    echo "  EPUBCHECK is not set — skipping. Point it at epubcheck.jar to validate:"
    echo "    EPUBCHECK=/path/to/epubcheck.jar ./build.sh check"
    return 0
  fi
  need java
  local status=0
  for f in build/fa/faramushkhaneh.epub build/en/the-man-who-forgot-his-daughter.epub; do
    echo "--- $f"
    java -jar "$EPUBCHECK" "$f" || status=1
  done
  return $status
}

verify() {
  say "Structure"
  python3 tools/verify-epub.py build/fa/faramushkhaneh.epub --lang fa
  python3 tools/verify-epub.py build/en/the-man-who-forgot-his-daughter.epub --lang en
}

manifest() {
  say "Output"
  find build -type f \( -name '*.epub' -o -name '*.pdf' -o -name '*.png' \) \
    | sort | while read -r f; do
      printf '  %-58s %s\n' "$f" "$(du -h "$f" | cut -f1)"
    done
}

case "${1:-all}" in
  fonts)  fonts ;;
  covers) fonts; covers ;;
  fa)     fonts; covers_once; edition_fa; manifest ;;
  en)     fonts; covers_once; edition_en; manifest ;;
  check)  check; verify ;;
  verify) verify ;;
  all)
    need "$PANDOC"
    fonts
    covers
    edition_fa
    edition_en
    check
    verify
    manifest
    ;;
  *)
    echo "usage: $0 [all|fonts|covers|fa|en|check|verify]" >&2
    exit 2
    ;;
esac
