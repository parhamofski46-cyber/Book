#!/usr/bin/env node
// Entry point.
import { loadConfig } from './config.js';
import { openStore } from './db/store.js';
import { createApp } from './app.js';

const config = loadConfig();
const store = openStore(config.dbPath);
const app = createApp({ store, config });

const server = await app.listen();
console.log(`[pulse] listening on http://${config.host}:${config.port} (db ${config.dbPath})`);
if (!config.adminToken) {
  console.warn('[pulse] PULSE_ADMIN_TOKEN is not set: the admin API is disabled.');
}

const shutdown = (signal) => {
  console.log(`[pulse] ${signal}, shutting down`);
  server.close(() => { store.close(); process.exit(0); });
  // Do not wait forever on a hung keep-alive connection.
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
