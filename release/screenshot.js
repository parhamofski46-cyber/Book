#!/usr/bin/env node
// Render the dashboard against seeded telemetry and save the images the
// release post needs. Run from the repository root:
//
//   make fixtures && node release/screenshot.js
//
// The page is screenshotted in both themes because it ships supporting both,
// and a release post that only ever shows one is hiding half the work.

// Resolved rather than hard-coded: the previous absolute path meant this
// script only ran on the machine that first wrote it.
async function loadChromium() {
  for (const name of ['playwright-core', 'playwright']) {
    try { return (await import(name)).chromium; } catch { /* try the next */ }
  }
  throw new Error('playwright-core is not installed. Run: npm i -D playwright-core');
}

function findBrowser() {
  if (process.env.PULSE_CHROMIUM) return process.env.PULSE_CHROMIUM;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return undefined;  // let playwright find its own
  const dir = readdirSync(root).filter((d) => d.startsWith('chromium-')).sort().pop();
  if (!dir) return undefined;
  for (const candidate of ['chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
    const full = join(root, dir, candidate);
    if (existsSync(full)) return full;
  }
  return undefined;
}

import { mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openStore } from '../backend/src/db/store.js';
import { loadConfig } from '../backend/src/config.js';
import { createApp } from '../backend/src/app.js';

const DB = 'backend/data/shots.db';
rmSync(DB, { force: true });
rmSync(`${DB}-wal`, { force: true });
rmSync(`${DB}-shm`, { force: true });

console.log('seeding...');
const seeded = execFileSync('node', ['--no-warnings', 'backend/scripts/seed-demo.js'],
  { env: { ...process.env, PULSE_DB: DB }, encoding: 'utf8' });
const token = seeded.match(/token (pls_[\w-]+)/)[1];
const serverId = seeded.match(/server id (\d+)/)[1];
console.log(seeded.trim().split('\n').filter((l) => l.includes('regressions')).join('\n'));

const store = openStore(DB);
const app = createApp({ store, config: { ...loadConfig({}), adminToken: 'shot-admin' } });
const listening = await app.listen(0, '127.0.0.1');
const base = `http://127.0.0.1:${listening.address().port}`;

mkdirSync('release/screenshots', { recursive: true });
const chromium = await loadChromium();
const browser = await chromium.launch({ executablePath: findBrowser() });

async function shoot(name, { theme, path, clip, width = 1200, height = 900 }) {
  const context = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: 2, colorScheme: theme,
  });
  const page = await context.newPage();
  await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
  const target = clip ? page.locator(clip).first() : page;
  await target.screenshot({ path: `release/screenshots/${name}.png`, ...(clip ? {} : { fullPage: false }) });
  await context.close();
  console.log(`  ${name}.png`);
}

const detail = `/s/${serverId}?token=${token}`;
// One navigation with the token turns it into a cookie; after that the clean
// address works, which is what the images should show.
const warm = await browser.newContext();
const warmPage = await warm.newPage();
await warmPage.goto(`${base}${detail}`, { waitUntil: 'networkidle' });
const cookies = await warm.cookies();
await warm.close();

async function shootAuthed(name, opts) {
  const context = await browser.newContext({
    viewport: { width: opts.width ?? 1200, height: opts.height ?? 900 },
    deviceScaleFactor: 2, colorScheme: opts.theme,
  });
  await context.addCookies(cookies);
  const page = await context.newPage();
  await page.goto(`${base}${opts.path}`, { waitUntil: 'networkidle' });
  if (opts.clip) {
    await page.locator(opts.clip).first().screenshot({ path: `release/screenshots/${name}.png` });
  } else {
    await page.screenshot({ path: `release/screenshots/${name}.png`, fullPage: opts.full ?? false });
  }
  await context.close();
  console.log(`  release/screenshots/${name}.png`);
}

console.log('rendering...');
// The hero shot uses the seven-day range: the regression happened two days
// ago, so a 24-hour view shows its aftermath without the moment it began --
// and the orange restart marker that carries the whole story is off-screen.
await shootAuthed('dashboard-detail', { path: `/s/${serverId}?range=7d`, theme: 'dark', height: 1150 });
await shootAuthed('dashboard-light', { path: `/s/${serverId}?range=7d`, theme: 'light', height: 1150 });
await shootAuthed('regression', { path: `/s/${serverId}?range=7d`, theme: 'dark', clip: '.scroll:has(table)' });
await shootAuthed('timeline', { path: `/s/${serverId}?range=7d`, theme: 'dark', clip: 'figure.chartbox' });
// The list needs the admin token: a collector token is scoped to one server,
// so "/" redirects to it and this shot was silently the detail page again.
{
  const context = await browser.newContext({
    viewport: { width: 1200, height: 520 }, deviceScaleFactor: 2, colorScheme: 'dark',
  });
  await context.addCookies([{
    name: 'pulse_token', value: 'shot-admin', domain: '127.0.0.1',
    path: '/', httpOnly: true, sameSite: 'Lax',
  }]);
  const page = await context.newPage();
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: 'release/screenshots/server-list.png' });
  await context.close();
  console.log('  release/screenshots/server-list.png');
}

await browser.close();
listening.close();
store.close();
rmSync(DB, { force: true });
rmSync(`${DB}-wal`, { force: true });
rmSync(`${DB}-shm`, { force: true });
console.log('done');
