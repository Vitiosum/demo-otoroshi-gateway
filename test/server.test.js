import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { readConfig } from '../src/config.js';

// The app without Otoroshi: the road and the health route still work.
const env = { ROAD_TOKEN: 'booth-secret', APP_ID: 'app_1234', CC_APP_NAME: 'demo', SOME_SECRET: 'nope' };
let base;
let server;

before(async () => {
  ({ server } = createApp(readConfig(env), { env, log: () => {} }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('GET /health answers 200 without touching the add-on', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok' });
});

test('GET /health/deep answers 503 when Otoroshi is not linked', async () => {
  assert.equal((await fetch(`${base}/health/deep`)).status, 503);
});

test('the road refuses direct calls without the booth token', async () => {
  assert.equal((await fetch(`${base}/road/fortune`)).status, 403);
  const res = await fetch(`${base}/road/fortune`, { headers: { 'X-Toll-Booth-Token': 'booth-secret' } });
  assert.equal(res.status, 200);
});

test('POST /api/drive validates its input, then waits for the booth', async () => {
  const bad = await fetch(`${base}/api/drive`, { method: 'POST', body: JSON.stringify({ lane: 'bus', count: 5, exit: 'fortune' }) });
  assert.equal(bad.status, 400);
  const notReady = await fetch(`${base}/api/drive`, { method: 'POST', body: JSON.stringify({ lane: 'vip', count: 1, exit: 'fortune' }) });
  assert.equal(notReady.status, 503);
});

test('the page and its assets are served with a strict CSP', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(await res.text(), /The Toll Booth/);
  assert.equal((await fetch(`${base}/app.js`)).status, 200);
});

test('GET /api/state shows only the allowed platform variables', async () => {
  const state = await (await fetch(`${base}/api/state`)).json();
  assert.deepEqual(Object.keys(state.platform).sort(),
    ['APP_ID', 'CC_APP_NAME', 'CC_COMMIT_ID', 'CC_DEPLOYMENT_ID', 'CC_PRETTY_INSTANCE_NAME', 'INSTANCE_NUMBER', 'INSTANCE_TYPE']);
  assert.ok(!JSON.stringify(state).includes('booth-secret'));
  assert.equal(state.booth.roadUrl, 'https://app-1234.cleverapps.io');
});
