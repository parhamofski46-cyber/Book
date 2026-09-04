#!/usr/bin/env node
// Entry point.
import { loadConfig } from './config.js';
import { openStore } from './db/store.js';
import { createApp } from './app.js';
import { resolveAdminToken } from './admin-token.js';

const base = loadConfig();
// Make sure an admin token exists before anything else: without one the first
// thing a new operator needs to do -- issue a collector token -- is impossible.
const config = { ...base, adminToken: resolveAdminToken(base) };

const store = openStore(config.dbPath);
const app = createApp({ store, config });
const server = await app.listen();

const url = config.publicUrl || `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`;
console.log(`[pulse] listening on ${url}  (db ${config.dbPath})`);

if (!config.adminToken) {
  console.log('[pulse] admin API is off (PULSE_NO_ADMIN=1)');
} else if (store.listServers().length === 0) {
  // Nothing registered yet: say what to do next rather than waiting silently.
  console.log(`
  Nothing is reporting yet. Register your first server:

    node backend/scripts/add-server.js "My RP Server"

  It prints the block to paste into server.cfg.
`);
} else {
  console.log(`[pulse] ${store.listServers().length} server(s) registered  ${url}/?token=<admin token>`);
}

const shutdown = (signal) => {
  console.log(`[pulse] ${signal}, shutting down`);
  server.close(() => { store.close(); process.exit(0); });
  // Do not wait forever on a hung keep-alive connection.
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
