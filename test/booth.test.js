import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoute, buildApikey, ensureBooth, publicRoute, BADGES, ROUTE_ID, TOKEN_HEADER, FORBIDDEN_PATH } from '../src/booth.js';

const routeTemplate = {
  id: 'route_generated',
  frontend: { domains: ['app-gateway.cleverapps.io'], strip_path: true, exact: false },
  backend: { root: '/', targets: [{ id: 'target_1', hostname: 'request.otoroshi.io', port: 443, tls: true }] },
  plugins: [],
};
const keyTemplate = { clientId: 'generated', clientSecret: 'generated-secret', authorizedGroup: 'default', authorizedEntities: ['group_default'] };

test('the route sends /road on the gateway domain to the road, with the five plugins', () => {
  const route = buildRoute({ template: routeTemplate, roadUrl: 'https://app-road.cleverapps.io', roadToken: 't0k3n' });
  assert.equal(route.id, ROUTE_ID);
  assert.deepEqual(route.frontend.domains, ['app-gateway.cleverapps.io/road']);
  assert.equal(route.frontend.strip_path, false);
  assert.deepEqual(route.backend.targets.map((t) => [t.hostname, t.port, t.tls]), [['app-road.cleverapps.io', 443, true]]);
  assert.deepEqual(route.plugins.map((p) => p.plugin.split('.').pop()),
    ['OverrideHost', 'ApikeyCalls', 'RoutingRestrictions', 'AdditionalHeadersIn', 'SendOtoroshiHeadersBack']);
  const restrictions = route.plugins[2].config;
  assert.deepEqual(restrictions.forbidden, [{ method: '*', path: FORBIDDEN_PATH }]);
  assert.equal(route.plugins[3].config.headers[TOKEN_HEADER], 't0k3n');
});

test('a badge is limited to the route, with its minute window and daily quota', () => {
  const key = buildApikey({ template: keyTemplate, existing: null, badge: BADGES.standard });
  assert.equal(key.clientId, 'toll-booth-standard');
  assert.equal(key.authorizedGroup, null);
  assert.deepEqual(key.authorizedEntities, [`route_${ROUTE_ID}`]);
  assert.equal(key.throttlingStrategy.id, 'FixedWindowStrategyConfig');
  assert.equal(key.throttlingStrategy.windowDurationMs, 60_000);
  assert.equal(key.throttlingStrategy.quota.window, 20);
  assert.equal(key.dailyQuota, 500);
});

test('an existing badge keeps its secret', () => {
  const key = buildApikey({ template: keyTemplate, existing: { clientSecret: 'kept' }, badge: BADGES.vip });
  assert.equal(key.clientSecret, 'kept');
});

test('the public route hides the booth token', () => {
  const route = buildRoute({ template: routeTemplate, roadUrl: 'https://app-road.cleverapps.io', roadToken: 't0k3n' });
  const shown = JSON.stringify(publicRoute(route));
  assert.ok(!shown.includes('t0k3n'));
  assert.ok(shown.includes('********'));
});

// A fake Otoroshi admin API, in memory.
function fakeAdmin() {
  const store = new Map();
  const calls = [];
  return {
    calls,
    async get(path) {
      if (path === '/api/routes/_template') return structuredClone(routeTemplate);
      if (path === '/api/apikeys/_template') return structuredClone(keyTemplate);
      return structuredClone(store.get(path));
    },
    async find(path) { return store.has(path) ? structuredClone(store.get(path)) : null; },
    async post(path, body) {
      calls.push(`POST ${path}`);
      const id = path === '/api/routes' ? `/api/routes/${body.id}` : `/api/apikeys/${body.clientId}`;
      store.set(id, body);
      return body;
    },
    async put(path, body) { calls.push(`PUT ${path}`); store.set(path, body); return body; },
  };
}

test('ensureBooth creates the booth once, then only updates it', async () => {
  const admin = fakeAdmin();
  const first = await ensureBooth({ admin, roadUrl: 'https://app-road.cleverapps.io', roadToken: 't' });
  assert.equal(first.gatewayUrl, 'https://app-gateway.cleverapps.io');
  assert.deepEqual(admin.calls, ['POST /api/routes', 'POST /api/apikeys', 'POST /api/apikeys']);
  assert.equal(first.credentials.vip.clientId, 'toll-booth-gold');
  assert.equal(first.credentials.vip.clientSecret, 'generated-secret');

  admin.calls.length = 0;
  await ensureBooth({ admin, roadUrl: 'https://app-road.cleverapps.io', roadToken: 't' });
  assert.deepEqual(admin.calls, [`PUT /api/routes/${ROUTE_ID}`, 'PUT /api/apikeys/toll-booth-gold', 'PUT /api/apikeys/toll-booth-standard']);
});
