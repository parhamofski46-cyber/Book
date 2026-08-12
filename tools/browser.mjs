// Shared Chromium launcher.
//
// Playwright insists on the exact browser revision its npm package was built
// against. When the machine already ships a Chromium (CI images usually do),
// pointing at that binary is both faster and avoids a version-pin standoff.
// Set CHROMIUM_PATH to override; otherwise we probe the usual locations and
// fall back to whatever Playwright downloaded for itself.

import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const CANDIDATES = [
  process.env.CHROMIUM_PATH,
  '/opt/pw-browsers/chromium',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
].filter(Boolean);

export function chromiumPath() {
  return CANDIDATES.find((p) => existsSync(p));
}

export function launch(options = {}) {
  const executablePath = chromiumPath();
  return chromium.launch(executablePath ? { ...options, executablePath } : options);
}
