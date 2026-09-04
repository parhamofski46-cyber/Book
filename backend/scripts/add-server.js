#!/usr/bin/env node
// Register a server and print the block to paste into server.cfg.
//
//   node backend/scripts/add-server.js "My RP Server"
//   node backend/scripts/add-server.js "My RP" --webhook https://discord.com/api/webhooks/...
//
// This exists because the alternative was a curl incantation with a bearer
// header, and the first thing anyone does with a monitoring tool is install
// it -- if that step is fiddly, they never see the part that works.

import { openStore, nowS } from '../src/db/store.js';
import { loadConfig, PLANS } from '../src/config.js';
import { resolveAdminToken } from '../src/admin-token.js';

const args = process.argv.slice(2);
const FLAGS = ['plan', 'webhook', 'endpoint'];

const flag = (key) => {
  const i = args.indexOf(`--${key}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
};

// The name is the first bare word that is not the value of a flag.
const flagValueIndexes = new Set(
  FLAGS.map((k) => args.indexOf(`--${k}`)).filter((i) => i >= 0).map((i) => i + 1));
const name = args.find((a, i) => !a.startsWith('--') && !flagValueIndexes.has(i));

if (!name || args.includes('--help') || args.includes('-h')) {
  console.log(`Register a FiveM server with this Pulse backend.

  node backend/scripts/add-server.js "<server name>" [options]

  --plan <free|pro|team>   retention tier (default: ${loadConfig().defaultPlan})
  --webhook <url>          Discord webhook for alerts
  --endpoint <url>         backend URL to put in the config block
                           (default: PULSE_PUBLIC_URL, else http://127.0.0.1:<port>)
`);
  process.exit(name ? 0 : 1);
}

const config = loadConfig();
const plan = Object.hasOwn(PLANS, flag('plan')) ? flag('plan') : config.defaultPlan;
const store = openStore(config.dbPath);
const created = store.createServer({
  name, plan, webhook: flag('webhook'), createdS: nowS(),
});

// An unset PULSE_PUBLIC_URL is an empty string, not null, so `??` would keep
// it and print "set pulse_endpoint \"/v1/ingest\"".
const base = (flag('endpoint') || config.publicUrl || `http://127.0.0.1:${config.port}`).replace(/\/$/, '');
const admin = resolveAdminToken(config, { quiet: true });

const line = '─'.repeat(68);
console.log(`
Registered "${name}" (id ${created.id}, plan ${plan}).

${line}
  Download the ready-made collector -- endpoint and token already in it:

  ${base}/s/${created.id}/collector.zip?token=${created.token}

  Unzip into your resources folder, add one line to server.cfg:

      ensure pulse_collector

  Restart, then run "pulse test" in the server console.
${line}

Dashboard:  ${base}/s/${created.id}?token=${created.token}

If you would rather configure it by hand instead of using the download:

    set pulse_endpoint    "${base}/v1/ingest"
    set pulse_token       "${created.token}"
    set pulse_server_name "${name}"
`);

if (admin) console.log(`Every server at once: ${base}/?token=${admin}\n`);

console.log(`The token above is shown once -- only its hash is stored, so it cannot
be read back. Losing it means registering the server again.
`);
store.close();
