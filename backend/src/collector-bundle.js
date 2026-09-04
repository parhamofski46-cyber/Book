// Builds a download of the collector with this server's settings already in it.
//
// Installing used to mean: download a zip, extract it, then copy three convars
// out of a terminal and into server.cfg without a typo. Two of those steps were
// the ones people got wrong, so the settings now travel inside the download and
// the operator adds one line.
//
// The zip is written here rather than pulled from a library: the format is a
// few headers, node:zlib does the compression, and the project ships with no
// dependencies on either side.

import { deflateRawSync } from 'node:zlib';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

export const COLLECTOR_ROOT = process.env.PULSE_COLLECTOR_DIR
  || fileURLToPath(new URL('../../collector/', import.meta.url));

// Settings the bundle is allowed to carry. Anything else an operator wants to
// change belongs in a convar, where a later download will not overwrite it.
const BUNDLED_KEYS = ['endpoint', 'token', 'server_name'];

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** MS-DOS packed time and date, which is what the format wants. */
function dosStamp(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

/**
 * @param {{name: string, data: Buffer}[]} entries
 * @returns {Buffer} a zip archive
 */
export function makeZip(entries, when = new Date()) {
  const { time, day } = dosStamp(when);
  const locals = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const compressed = deflateRawSync(entry.data, { level: 9 });
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(0, 6);           // flags
    local.writeUInt16LE(8, 8);           // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);          // extra field length
    locals.push(local, name, compressed);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);            // version made by
    dir.writeUInt16LE(20, 6);            // version needed
    dir.writeUInt16LE(0, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt16LE(time, 12);
    dir.writeUInt16LE(day, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(compressed.length, 20);
    dir.writeUInt32LE(entry.data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt16LE(0, 30);            // extra
    dir.writeUInt16LE(0, 32);            // comment
    dir.writeUInt16LE(0, 34);            // disk number
    dir.writeUInt16LE(0, 36);            // internal attributes
    // External attributes carry the unix mode in the high half. `<<` in
    // JavaScript is a signed 32-bit operation, so shifting here overflows into
    // a negative number; multiply and coerce back to unsigned instead.
    dir.writeUInt32LE((0o100644 * 0x10000) >>> 0, 38);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 18);

  return Buffer.concat([...locals, centralBuf, end]);
}

/** Every file under `dir`, as paths relative to it, in a stable order. */
function walk(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, base));
    else out.push(relative(base, full).split(sep).join(posix.sep));
  }
  return out;
}

/**
 * The collector, packaged as `pulse_collector/`, with a settings.json holding
 * this server's endpoint and token.
 */
export function bundleCollector({ endpoint, token, serverName, root = COLLECTOR_ROOT, when }) {
  if (!existsSync(root)) {
    throw Object.assign(new Error(`collector sources not found at ${root}`), { status: 503 });
  }

  const settings = { endpoint, token, server_name: serverName };
  for (const key of Object.keys(settings)) {
    if (!BUNDLED_KEYS.includes(key)) delete settings[key];
  }

  const entries = walk(root).map((name) => ({
    name: `pulse_collector/${name}`,
    data: readFileSync(join(root, name)),
  }));

  entries.push({
    name: 'pulse_collector/settings.json',
    data: Buffer.from(JSON.stringify(settings, null, 2) + '\n', 'utf8'),
  });

  entries.push({
    name: 'pulse_collector/INSTALL.txt',
    data: Buffer.from(
`Pulse collector for "${serverName}"

1. Put this pulse_collector folder in your resources directory.
2. Add one line to server.cfg:

     ensure pulse_collector

3. Restart the server, then run this in its console:

     pulse test

That is the whole install. The endpoint and token are already set in
settings.json, so there is nothing to copy by hand.

  reporting to : ${endpoint}
  server name  : ${serverName}

Keep settings.json private -- it contains this server's token. If you would
rather set things through convars, any convar overrides the bundled value:

     set pulse_endpoint "..."
     set pulse_token    "..."

Licence: MIT. Read every file before running it on your server; that is what
the licence is for.
`, 'utf8'),
  });

  // Stable order so the same inputs make the same archive.
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return makeZip(entries, when);
}
