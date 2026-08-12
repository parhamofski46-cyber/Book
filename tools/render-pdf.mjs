// Print an edition's source HTML to a 6x9in interior PDF via Chromium.
//
// Chromium rather than weasyprint: weasyprint mishandles Arabic-script shaping
// and bidi, which is exactly what the Persian edition is made of.
//
// The source files pull their webfonts from Google Fonts. We block that and
// serve the same families from assets/fonts instead, so a build produces the
// same PDF whether or not the machine has network, and never falls back to a
// system face that lacks Persian glyphs.
//
// Usage: node tools/render-pdf.mjs --lang fa --src src/faramushkhaneh.html \
//                                  --out build/fa/faramushkhaneh.pdf

import { launch } from './browser.mjs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const LANG = arg('lang');
const SRC = resolve(ROOT, arg('src'));
const SHEETS = ['assets/css/print-common.css', `assets/css/print-${LANG}.css`];
const OUT = resolve(ROOT, arg('out'));

// family, weight, style, file — mirrors what each edition's CSS asks for.
const FACES = {
  fa: [
    ['Vazirmatn', 300, 'normal', 'Vazirmatn-Light.ttf'],
    ['Vazirmatn', 400, 'normal', 'Vazirmatn-Regular.ttf'],
    ['Vazirmatn', 600, 'normal', 'Vazirmatn-Bold.ttf'],
    ['Vazirmatn', 700, 'normal', 'Vazirmatn-Bold.ttf'],
    ['Noto Naskh Arabic', 400, 'normal', 'NotoNaskhArabic-Regular.ttf'],
    ['Noto Naskh Arabic', 500, 'normal', 'NotoNaskhArabic-Regular.ttf'],
    ['Noto Naskh Arabic', 700, 'normal', 'NotoNaskhArabic-Bold.ttf'],
    ['Noto Nastaliq Urdu', 400, 'normal', 'NotoNastaliqUrdu-Regular.ttf'],
    ['Noto Nastaliq Urdu', 700, 'normal', 'NotoNastaliqUrdu-Regular.ttf'],
  ],
  en: [
    ['EB Garamond', 400, 'normal', 'EBGaramond-Regular.ttf'],
    ['EB Garamond', 500, 'normal', 'EBGaramond-Medium.ttf'],
    ['EB Garamond', 400, 'italic', 'EBGaramond-Italic.ttf'],
    ['Cormorant Garamond', 400, 'normal', 'CormorantGaramond-Regular.ttf'],
    ['Cormorant Garamond', 600, 'normal', 'CormorantGaramond-SemiBold.ttf'],
    ['Cormorant Garamond', 400, 'italic', 'CormorantGaramond-Italic.ttf'],
    ['Inter', 300, 'normal', 'Inter-Light.ttf'],
    ['Inter', 400, 'normal', 'Inter-Regular.ttf'],
    ['Inter', 600, 'normal', 'Inter-SemiBold.ttf'],
  ],
};

function fontFaceCss(lang) {
  return FACES[lang]
    .map(([family, weight, style, file]) => {
      const url = pathToFileURL(resolve(ROOT, 'assets/fonts', file)).href;
      return `@font-face{font-family:"${family}";font-weight:${weight};font-style:${style};` +
        `font-display:block;src:url("${url}") format("truetype");}`;
    })
    .join('\n');
}

const browser = await launch();
try {
  const page = await browser.newPage();

  // Cut off the remote font sources; the local @font-face block below stands in.
  await page.route('**://fonts.googleapis.com/**', (r) => r.abort());
  await page.route('**://fonts.gstatic.com/**', (r) => r.abort());

  await page.goto(pathToFileURL(SRC).href, { waitUntil: 'load' });
  await page.addStyleTag({ content: fontFaceCss(LANG) });
  for (const sheet of SHEETS) {
    await page.addStyleTag({ content: await readFile(resolve(ROOT, sheet), 'utf-8') });
  }

  // emulateMedia makes the @media print rules apply to layout before we measure,
  // and document.fonts.ready then reflects the real, embedded faces.
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => document.fonts.ready);

  await mkdir(dirname(OUT), { recursive: true });
  await page.pdf({
    path: OUT,
    width: '6in',
    height: '9in',
    margin: { top: '0.75in', right: '0.75in', bottom: '0.75in', left: '0.75in' },
    printBackground: true,
    preferCSSPageSize: false,
  });

  const { size } = await stat(OUT);
  console.log(`  + ${OUT.replace(ROOT + '/', '')}  ${(size / 1024 / 1024).toFixed(2)} MB`);
} finally {
  await browser.close();
}
