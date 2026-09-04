// Access control.
//
// Server ids are small integers. An unauthenticated dashboard would let anyone
// read every customer's telemetry by counting upwards, so this is given its own
// suite rather than being assumed.

import { suite, test, eq, ok, contains } from './harness.js';
import { openStore } from '../src/db/store.js';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';

async function start(overrides = {}) {
  const store = openStore(':memory:');
  const config = { ...loadConfig({}), adminToken: 'admin-secret', ...overrides };
  const app = createApp({ store, config });
  const listening = await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${listening.address().port}`;
  const a = store.createServer({ name: 'alpha-rp', plan: 'team' });
  const b = store.createServer({ name: 'beta-rp', plan: 'team' });
  return { store, base, a, b, stop: () => { listening.close(); store.close(); } };
}

const get = (base, path, opts = {}) =>
  fetch(base + path, { redirect: 'manual', ...opts });

export default async function run() {
  await suite('access: the dashboard is not public', async () => {
    const env = await start();

    await test('an anonymous visitor gets nothing', async () => {
      eq((await get(env.base, '/')).status, 401, 'index refuses');
      eq((await get(env.base, `/s/${env.a.id}`)).status, 401, 'detail refuses');
    });

    await test('the refusal explains how to authenticate', async () => {
      contains(await (await get(env.base, '/')).text(), 'token', 'tells the operator what to do');
    });

    await test("one server's token cannot read another's", async () => {
      const mine = await get(env.base, `/s/${env.a.id}`, { headers: { authorization: `Bearer ${env.a.token}` } });
      eq(mine.status, 200, 'own server is visible');
      contains(await mine.text(), 'alpha-rp');

      const theirs = await get(env.base, `/s/${env.b.id}`, { headers: { authorization: `Bearer ${env.a.token}` } });
      eq(theirs.status, 401, "someone else's server is not");
    });

    await test('a missing server answers exactly like a forbidden one', async () => {
      const forbidden = await get(env.base, `/s/${env.b.id}`, { headers: { authorization: `Bearer ${env.a.token}` } });
      const absent = await get(env.base, '/s/99999', { headers: { authorization: `Bearer ${env.a.token}` } });
      eq(absent.status, forbidden.status, 'same status');
      eq(await absent.text(), await forbidden.text(), 'and the same body, so ids cannot be enumerated');
    });

    await test('the admin token sees the fleet', async () => {
      const res = await get(env.base, '/', { headers: { authorization: 'Bearer admin-secret' } });
      eq(res.status, 200);
      const html = await res.text();
      contains(html, 'alpha-rp');
      contains(html, 'beta-rp');
    });

    await test('a single-server reader is sent straight to their server', async () => {
      const res = await get(env.base, '/', { headers: { authorization: `Bearer ${env.a.token}` } });
      eq(res.status, 302);
      eq(res.headers.get('location'), `/s/${env.a.id}`, 'no list of one');
    });

    env.stop();
  });

  await suite('access: a token in a link is put away safely', async () => {
    const env = await start();

    await test('a token in the URL becomes an HttpOnly cookie and a clean address', async () => {
      const res = await get(env.base, `/s/${env.a.id}?token=${env.a.token}`);
      eq(res.status, 302, 'redirected');
      eq(res.headers.get('location'), `/s/${env.a.id}`, 'to the address without the secret in it');
      const cookie = res.headers.get('set-cookie') ?? '';
      contains(cookie, 'HttpOnly', 'not readable from script');
      contains(cookie, 'SameSite=Lax', 'not sent from other sites');
      contains(cookie, 'pulse_token=', 'carries the token');
    });

    await test('the cookie then works on its own', async () => {
      const res = await get(env.base, `/s/${env.a.id}`, {
        headers: { cookie: `pulse_token=${encodeURIComponent(env.a.token)}` },
      });
      eq(res.status, 200);
      contains(await res.text(), 'alpha-rp');
    });

    await test('a forged cookie does not', async () => {
      const res = await get(env.base, `/s/${env.a.id}`, { headers: { cookie: 'pulse_token=pls_made_up' } });
      eq(res.status, 401);
    });

    env.stop();
  });

  await suite('access: the JSON API', async () => {
    const env = await start();

    await test('summary and series both require a reader', async () => {
      eq((await get(env.base, `/v1/servers/${env.a.id}/summary`)).status, 401);
      eq((await get(env.base, `/v1/servers/${env.a.id}/series`)).status, 401);
    });

    await test("and refuse another server's token", async () => {
      const res = await get(env.base, `/v1/servers/${env.b.id}/summary`,
        { headers: { authorization: `Bearer ${env.a.token}` } });
      eq(res.status, 401);
    });

    await test('the admin token reads any server', async () => {
      const res = await get(env.base, `/v1/servers/${env.b.id}/summary`,
        { headers: { authorization: 'Bearer admin-secret' } });
      eq(res.status, 200);
      eq((await res.json()).server.name, 'beta-rp');
    });

    env.stop();
  });

  await suite('access: the self-hosted escape hatch', async () => {
    const env = await start({ openDashboard: true });

    await test('an explicit opt-in opens the dashboard, and only then', async () => {
      const res = await get(env.base, '/');
      eq(res.status, 200, 'open when asked for');
      contains(await res.text(), 'alpha-rp');
    });

    await test('ingest still demands a real token even then', async () => {
      const res = await fetch(env.base + '/v1/ingest', {
        method: 'POST', headers: { authorization: 'Bearer nope' }, body: '{}',
      });
      eq(res.status, 401, 'writing is never opened up');
    });

    env.stop();
  });
}
