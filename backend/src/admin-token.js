// Admin token bootstrap.
//
// An unset admin token used to leave a new operator with the admin API
// switched off and no way to switch it on: the first thing they needed it for
// was issuing the token their collector would use. So on first start we make
// one and keep it beside the database.
//
// This does not open anything. The API is still refused without the token --
// the config layer still fails closed if there is none. It only removes a dead
// end. Setting PULSE_ADMIN_TOKEN yourself, or PULSE_NO_ADMIN=1 to keep the
// endpoint shut, both still win.

import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function adminTokenPath(dbPath) {
  return join(dbPath === ':memory:' ? '.' : dirname(dbPath), 'admin-token');
}

/**
 * @returns {string} the token, or '' when the admin API is deliberately off
 */
export function resolveAdminToken(config, { quiet = false, log = console } = {}) {
  if (process.env.PULSE_NO_ADMIN === '1') return '';
  if (config.adminToken) return config.adminToken;

  const path = adminTokenPath(config.dbPath);
  if (existsSync(path)) {
    const saved = readFileSync(path, 'utf8').trim();
    if (saved) return saved;
  }

  const token = 'adm_' + randomBytes(24).toString('base64url');
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, token + '\n', { mode: 0o600 });
    chmodSync(path, 0o600);
  } catch (err) {
    if (!quiet) log.warn(`[pulse] could not save an admin token to ${path}: ${err.message}`);
    return token;
  }

  if (!quiet) {
    log.log(`\n[pulse] first run: generated an admin token and saved it to ${path}\n`);
  }
  return token;
}
