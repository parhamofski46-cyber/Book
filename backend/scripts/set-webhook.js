#!/usr/bin/env node
// Point an existing server's alerts at a Discord webhook.
//
//   node backend/scripts/set-webhook.js <server id> <webhook url>
//   node backend/scripts/set-webhook.js <server id> --clear
//
// A webhook could previously only be set when the server was first registered,
// which meant getting it wrong -- or deciding you wanted alerts later -- forced
// a re-registration and a new collector token.

import { openStore } from '../src/db/store.js';
import { loadConfig } from '../src/config.js';
import { planFor } from '../src/config.js';

const [idArg, url] = process.argv.slice(2);
const id = Number(idArg);

if (!Number.isInteger(id) || !url) {
  console.log(`Set the Discord webhook alerts for a server are sent to.

  node backend/scripts/set-webhook.js <server id> <webhook url>
  node backend/scripts/set-webhook.js <server id> --clear
`);
  process.exit(idArg ? 1 : 0);
}

if (url !== '--clear' && !/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(url)) {
  console.error('That does not look like a Discord webhook URL. Expected it to start with\n' +
                '  https://discord.com/api/webhooks/\nUse --clear to remove one.');
  process.exit(1);
}

const config = loadConfig();
const store = openStore(config.dbPath);
const server = store.getServer(id);

if (!server) {
  console.error(`No server with id ${id}. Registered: ` +
    (store.listServers().map((s) => `${s.id} (${s.name})`).join(', ') || 'none'));
  process.exit(1);
}

store.setWebhook(id, url === '--clear' ? null : url);
console.log(url === '--clear'
  ? `Alerts for "${server.name}" will no longer be delivered anywhere.`
  : `Alerts for "${server.name}" will go to that webhook.`);

if (!planFor(server.plan).alerts) {
  console.log(`Note: the "${server.plan}" plan does not send alerts, so nothing will be delivered ` +
              `until the plan changes.`);
}
store.close();
