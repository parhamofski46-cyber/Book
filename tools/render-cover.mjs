// Render src/cover.html's canvas to PNG for both languages.
//
// The page draws into a 1600x2560 canvas once webfonts are ready; we drive the
// same language toggle a human would click, then pull the canvas out with
// toDataURL instead of going through the browser's download plumbing.
//
// Usage: node tools/render-cover.mjs [--theme night|ember|ash]

import { launch } from './browser.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const themeArg = process.argv.indexOf('--theme');
const THEME = themeArg > -1 ? process.argv[themeArg + 1] : 'night';

const EDITIONS = [
  { lang: 'fa', dir: 'build/fa', name: 'cover-fa' },
  { lang: 'en', dir: 'build/en', name: 'cover-en' },
];

const FULL = { w: 1600, h: 2560 };
const WEB = { w: 600, h: 960 };

/** Width/height straight out of the PNG IHDR, so we verify the file, not our intent. */
function pngSize(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

async function canvasPng(page, w, h) {
  const dataUrl = await page.evaluate(({ w, h }) => {
    const c = document.getElementById('c');
    if (c.width === w && c.height === h) return c.toDataURL('image/png');
    const t = document.createElement('canvas');
    t.width = w;
    t.height = h;
    const tx = t.getContext('2d');
    tx.imageSmoothingEnabled = true;
    tx.imageSmoothingQuality = 'high';
    tx.drawImage(c, 0, 0, w, h);
    return t.toDataURL('image/png');
  }, { w, h });
  return Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
}

async function save(buf, path, expect) {
  const got = pngSize(buf);
  if (got.w !== expect.w || got.h !== expect.h) {
    throw new Error(`${path}: expected ${expect.w}x${expect.h}, got ${got.w}x${got.h}`);
  }
  const mb = buf.length / 1024 / 1024;
  // Amazon KDP rejects cover uploads above 50 MB.
  if (mb > 50) throw new Error(`${path}: ${mb.toFixed(1)} MB exceeds the 50 MB store ceiling`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buf);
  console.log(`  + ${path.replace(ROOT + '/', '')}  ${got.w}x${got.h}  ${mb.toFixed(2)} MB`);
}

const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
  await page.goto(pathToFileURL(resolve(ROOT, 'src/cover.html')).href, { waitUntil: 'load' });

  // The page's own boot() awaits document.fonts.ready before its first draw.
  // Waiting for a painted pixel means we never capture a half-drawn canvas, and
  // never capture Persian rendered as tofu boxes.
  await page.waitForFunction(async () => {
    await document.fonts.ready;
    const c = document.getElementById('c');
    return c && c.getContext('2d').getImageData(0, 0, 1, 1).data[3] !== 0;
  }, null, { timeout: 60_000 });

  if (THEME !== 'night') {
    await page.click(`.sw[data-theme="${THEME}"]`);
  }

  for (const ed of EDITIONS) {
    // cover.html boots in Persian; one click on the toggle switches to English.
    const current = await page.evaluate(() => lang);
    if (current !== ed.lang) {
      await page.click('#lang');
      await page.waitForFunction((want) => lang === want, ed.lang);
    }
    await save(await canvasPng(page, FULL.w, FULL.h), resolve(ROOT, ed.dir, `${ed.name}.png`), FULL);
    await save(await canvasPng(page, WEB.w, WEB.h), resolve(ROOT, ed.dir, `${ed.name}-600x960.png`), WEB);
  }
} finally {
  await browser.close();
}
