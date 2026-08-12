# Thin wrapper over build.sh with per-target dependencies, so an edit to one
# edition's HTML does not rebuild the other.
#
#   make            both editions, then validate
#   make fa en      one edition
#   make covers
#   make check      epubcheck + structural verification
#   make clean

SHELL := /usr/bin/env bash

PANDOC    ?= pandoc
NODE      ?= node
EPUBCHECK ?=

FA_SRC := src/faramushkhaneh.html
EN_SRC := src/the-man-who-forgot-his-daughter.html

FA_EPUB := build/fa/faramushkhaneh.epub
FA_PDF  := build/fa/faramushkhaneh.pdf
EN_EPUB := build/en/the-man-who-forgot-his-daughter.epub
EN_PDF  := build/en/the-man-who-forgot-his-daughter.pdf

COVERS := build/fa/cover-fa.png build/en/cover-en.png

FONTS := assets/fonts/Vazirmatn-Regular.ttf

export PANDOC NODE EPUBCHECK

.PHONY: all fa en covers fonts check clean
.DEFAULT_GOAL := all

all: fa en check

fonts: $(FONTS)

$(FONTS): tools/fetch-fonts.py
	./build.sh fonts

covers: $(COVERS)

$(COVERS): src/cover.html tools/render-cover.mjs tools/browser.mjs | fonts
	./build.sh covers

fa: $(FA_EPUB) $(FA_PDF)

en: $(EN_EPUB) $(EN_PDF)

$(FA_EPUB) $(FA_PDF): $(FA_SRC) $(COVERS) \
                      metadata/epub-fa.yaml assets/css/epub-fa.css \
                      assets/css/print-common.css assets/css/print-fa.css \
                      tools/prepare.py tools/patch-epub.py tools/render-pdf.mjs
	./build.sh fa

$(EN_EPUB) $(EN_PDF): $(EN_SRC) $(COVERS) \
                      metadata/epub-en.yaml assets/css/epub-en.css \
                      assets/css/print-common.css assets/css/print-en.css \
                      tools/prepare.py tools/patch-epub.py tools/render-pdf.mjs
	./build.sh en

check: $(FA_EPUB) $(EN_EPUB)
	./build.sh check
	python3 tools/verify-epub.py $(FA_EPUB) --lang fa
	python3 tools/verify-epub.py $(EN_EPUB) --lang en

clean:
	rm -rf build
