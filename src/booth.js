// "The booth": what we ask Otoroshi to do, through its admin API.
//
// One route in front of the road, and two API keys ("badges") with their
// own quotas. ensureBooth() creates or updates them, so it is safe to run
// at every boot and from scripts/setup-booth.js.

export const ROUTE_ID = 'toll-booth-road';

// The two badges. "window" calls per "windowMs" is the rate limit,
// "daily" is the quota of calls per day.
export const BADGES = {
  vip: {
    clientId: 'toll-booth-gold',
    clientName: 'Gold badge',
    lane: 'gold',
    window: 600,
    windowMs: 60_000,
    daily: 10_000,
  },
  standard: {
    clientId: 'toll-booth-standard',
    clientName: 'Standard badge',
    lane: 'standard',
    window: 20,
    windowMs: 60_000,
    daily: 500,
  },
};

// Paths nobody may take, whatever their badge (a regex on the path).
export const FORBIDDEN_PATH = '/road/depot.*';

// Header the booth adds to every request it lets through. The road checks it.
export const TOKEN_HEADER = 'X-Toll-Booth-Token';

// A tiny client for the Otoroshi admin API (Basic auth with the linked credentials).
export function adminClient({ url, clientId, clientSecret }) {
  const auth = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  async function call(method, path, body) {
    const res = await fetch(url + path, {
      method,
      headers: {
        Authorization: auth,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    if (!res.ok) {
      const error = new Error(`Otoroshi ${method} ${path} answered ${res.status}`);
      error.status = res.status;
      throw error;
    }
    return text ? JSON.parse(text) : null;
  }

  return {
    get: (path) => call('GET', path),
    post: (path, body) => call('POST', path, body),
    put: (path, body) => call('PUT', path, body),
    del: (path) => call('DELETE', path),
    // GET that answers null on 404 instead of throwing.
    async find(path) {
      try {
        return await call('GET', path);
      } catch (error) {
        if (error.status === 404) return null;
        throw error;
      }
    },
  };
}

// The route definition, built from Otoroshi's own template.
export function buildRoute({ template, roadUrl, roadToken }) {
  const routesDomain = template.frontend.domains[0].split('/')[0];
  const road = new URL(roadUrl);
  const plugin = (name, config = {}) => ({
    enabled: true,
    debug: false,
    plugin: `cp:otoroshi.next.plugins.${name}`,
    include: [],
    exclude: [],
    config,
  });

  return {
    ...template,
    id: ROUTE_ID,
    name: 'The Toll Booth',
    description: 'Badges, quotas, rate limiting and a stamp in front of the road API (demo-otoroshi-gateway).',
    tags: ['demo-otoroshi-gateway'],
    frontend: {
      ...template.frontend,
      domains: [`${routesDomain}/road`],
      strip_path: false,
    },
    backend: {
      ...template.backend,
      root: '/',
      targets: [{
        ...template.backend.targets[0],
        id: 'the-road',
        hostname: road.hostname,
        port: road.protocol === 'https:' ? 443 : Number(road.port) || 80,
        tls: road.protocol === 'https:',
      }],
    },
    plugins: [
      // 1. Send the request to the road with the road's own Host header.
      plugin('OverrideHost'),
      // 2. No badge, no entry. Counts each call against the badge's quotas.
      plugin('ApikeyCalls', {
        extractors: {
          basic: { enabled: true },
          custom_headers: { enabled: true },
          client_id: { enabled: false },
          jwt: { enabled: false },
          oto_bearer: { enabled: false },
        },
        routing: { enabled: false },
        validate: true,
        mandatory: true,
        pass_with_user: false,
        wipe_backend_request: true,
        update_quotas: true,
      }),
      // 3. The staff-only exit is closed to everyone.
      plugin('RoutingRestrictions', {
        allow_last: true,
        allowed: [],
        forbidden: [{ method: '*', path: FORBIDDEN_PATH }],
        not_found: [],
      }),
      // 4. Stamp the request: the secret token and the badge it paid with.
      plugin('AdditionalHeadersIn', {
        headers: {
          [TOKEN_HEADER]: roadToken,
          'X-Toll-Badge': '${apikey.name}',
          'X-Toll-Lane': '${apikey.metadata.lane}',
        },
      }),
      // 5. Print the receipt: request id, latencies and calls left, as response headers.
      plugin('SendOtoroshiHeadersBack'),
    ],
  };
}

// One badge (API key), built from Otoroshi's own template.
// An existing key keeps its secret.
export function buildApikey({ template, existing, badge }) {
  const base = existing || template;
  return {
    ...base,
    clientId: badge.clientId,
    clientName: badge.clientName,
    description: `${badge.window} calls per minute, ${badge.daily} per day (demo-otoroshi-gateway)`,
    // Valid on the toll booth route only (not on the whole "default" group).
    authorizedGroup: null,
    authorizedEntities: [`route_${ROUTE_ID}`],
    authorizations: [{ kind: 'route', id: ROUTE_ID }],
    enabled: true,
    throttlingQuota: badge.window,
    dailyQuota: badge.daily,
    monthlyQuota: badge.daily * 31,
    throttlingStrategy: {
      id: 'FixedWindowStrategyConfig',
      windowDurationMs: badge.windowMs,
      quota: { window: badge.window, daily: badge.daily, monthly: badge.daily * 31 },
      bucketKey: null,
    },
    tags: ['demo-otoroshi-gateway'],
    metadata: { lane: badge.lane },
  };
}

// Creates or updates the route and the two badges. Returns what the
// dashboard needs: the gateway URL and the badges' credentials (kept in memory).
export async function ensureBooth({ admin, roadUrl, roadToken }) {
  if (!roadUrl) throw new Error('ROAD_URL is not set and cannot be derived from APP_ID');

  const routeTemplate = await admin.get('/api/routes/_template');
  const route = buildRoute({ template: routeTemplate, roadUrl, roadToken });
  const existingRoute = await admin.find(`/api/routes/${ROUTE_ID}`);
  if (existingRoute) await admin.put(`/api/routes/${ROUTE_ID}`, route);
  else await admin.post('/api/routes', route);

  const keyTemplate = await admin.get('/api/apikeys/_template');
  const credentials = {};
  for (const [lane, badge] of Object.entries(BADGES)) {
    const existing = await admin.find(`/api/apikeys/${badge.clientId}`);
    const key = buildApikey({ template: keyTemplate, existing, badge });
    const saved = existing
      ? await admin.put(`/api/apikeys/${badge.clientId}`, key)
      : await admin.post('/api/apikeys', key);
    credentials[lane] = {
      clientId: badge.clientId,
      clientSecret: (saved && saved.clientSecret) || key.clientSecret,
    };
  }

  const routesDomain = route.frontend.domains[0].split('/')[0];
  return { route, gatewayUrl: `https://${routesDomain}`, credentials };
}

// Reads the quotas Otoroshi counted for each badge.
export async function readQuotas(admin) {
  const quotas = {};
  for (const [lane, badge] of Object.entries(BADGES)) {
    quotas[lane] = summarizeQuotas(await admin.get(`/api/apikeys/${badge.clientId}/quotas`));
  }
  return quotas;
}

// Puts the calls counted for both badges back to zero.
export async function resetQuotas(admin) {
  for (const badge of Object.values(BADGES)) {
    await admin.del(`/api/apikeys/${badge.clientId}/quotas`);
  }
  return readQuotas(admin);
}

// The calls left today, as Otoroshi counts them. (Its window counter is not
// used: see src/windows.js.)
export function summarizeQuotas(q) {
  return {
    dailyAllowed: q.authorizedCallsPerDay,
    dailyLeft: q.remainingCallsPerDay,
  };
}

// The route as shown on the dashboard: the parts that matter, token hidden.
export function publicRoute(route) {
  return {
    id: route.id,
    name: route.name,
    frontend: { domains: route.frontend.domains, strip_path: route.frontend.strip_path },
    backend: {
      targets: route.backend.targets.map(({ hostname, port, tls }) => ({ hostname, port, tls })),
    },
    plugins: route.plugins.map(({ plugin, config }) => ({
      plugin: plugin.replace('cp:otoroshi.next.plugins.', ''),
      config: redact(config),
    })),
  };
}

// A badge as shown on the dashboard: an allow-list of fields, never the secret.
export function publicKey(key) {
  return {
    clientId: key.clientId,
    clientName: key.clientName,
    clientSecret: '********',
    enabled: key.enabled,
    authorizedEntities: key.authorizedEntities,
    throttlingStrategy: key.throttlingStrategy,
    metadata: key.metadata,
  };
}

// The live configuration, read back from Otoroshi: what it really applies.
export async function readBooth(admin) {
  const route = await admin.get(`/api/routes/${ROUTE_ID}`);
  const keys = {};
  for (const [lane, badge] of Object.entries(BADGES)) {
    keys[lane] = publicKey(await admin.get(`/api/apikeys/${badge.clientId}`));
  }
  return { route: publicRoute(route), keys };
}

function redact(config) {
  if (!config || !config.headers || !config.headers[TOKEN_HEADER]) return config;
  return { ...config, headers: { ...config.headers, [TOKEN_HEADER]: '********' } };
}
