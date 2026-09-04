#!/usr/bin/env node
// Inline the screenshots into the landing page.
//
//   node release/build-landing.js  ->  release/landing.html
//
// The template is kept without the images so the repository does not carry a
// half-megabyte of base64 that changes every time a screenshot is retaken.
// Regenerate the screenshots first with: node release/screenshot.js

import { readFileSync, writeFileSync } from 'node:fs';

const IMAGES = {
  __TIMELINE__: 'release/screenshots/timeline.png',
  __DASHBOARD__: 'release/screenshots/dashboard-detail.png',
};

let html = readFileSync('release/landing.template.html', 'utf8');
for (const [token, path] of Object.entries(IMAGES)) {
  const data = readFileSync(path).toString('base64');
  html = html.replaceAll(token, `data:image/png;base64,${data}`);
}
writeFileSync('release/landing.html', html);
console.log(`release/landing.html  ${Math.round(html.length / 1024)}KB`);
