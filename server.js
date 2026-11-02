// The Toll Booth: one small Node.js app that is both
//   - "the road", a tiny API (GET /road/*), and
//   - the dashboard that drives cars through Otoroshi, server-side.
// No framework, no dependency: node:http and fetch.

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readConfig, hasOtoroshi, platformInfo } from './src/config.js';
import { handleRoad } from './src/road.js';
import { adminClient, ensureBooth, readBooth, readQuotas, resetQuotas, ROUTE_ID, BADGES } from './src/booth.js';
import { throughBooth, direct, median, LANES, EXITS, CONVOY_SIZES } from './src/drive.js';
import { createWindows } from './src/windows.js';

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/cc-brand.css': ['cc-brand.css', 'text/css; charset=utf-8'],
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

const MAX_TRIPS = 24; // receipts kept in memory for the first screen
const MAX_DRIVES_IN_FLIGHT = 6; // convoys driven at the same time, all visitors together

export function createApp(config = readConfig(), { env = process.env, log = console.log } = {}) {
  const publicDir = fileURLToPath(new URL('./public/', import.meta.url));
  const files = Object.fromEntries(Object.entries(STATIC).map(([route, [file, type]]) =>
    [route, { body: readFileSync(publicDir + file), type }]));

  const admin = hasOtoroshi(config) ? adminClient(config.otoroshi) : null;
  const booth = { ready: false, error: null, gatewayUrl: '', credentials: {} };
  const trips = [];
  let tripCount = 0;
  let noBadgeCount = 0;
  let drivesInFlight = 0;
  let lastLatency = null;
  const windows = createWindows(BADGES);

  // Creates or updates the route and the badges in Otoroshi, then sends one
  // car per lane so the first screen already shows receipts.
  async function openBooth() {
    if (!admin) {
      booth.error = 'The Otoroshi add-on is not linked: CC_OTOROSHI_API_* variables are missing.';
      log(`[booth] ${booth.error}`);
      return;
    }
    try {
      const { gatewayUrl, credentials } = await ensureBooth({
        admin, roadUrl: config.roadUrl, roadToken: config.roadToken,
      });
      Object.assign(booth, {
        ready: true, error: null, credentials, gatewayUrl: config.gatewayUrl || gatewayUrl,
      });
      log(`[booth] route ${ROUTE_ID} and ${Object.keys(credentials).length} badges ready, gateway ${booth.gatewayUrl}`);
      // Seed: one car per lane, the Gold one last so the first receipt shows a paid trip.
      for (const lane of ['none', 'standard', 'vip']) await driveOne(lane, 'fortune');
    } catch (error) {
      booth.error = `The booth could not be configured: ${error.message}`;
      log(`[booth] ${booth.error}. Retrying in 15 s.`);
      setTimeout(openBooth, 15_000).unref();
    }
  }

  // Lane "none": every other car shows nothing, the others a forged Gold badge.
  function badgeFor(lane) {
    if (lane !== 'none') return { shown: lane, badge: booth.credentials[lane] };
    noBadgeCount++;
    if (noBadgeCount % 2) return { shown: 'none', badge: null };
    return { shown: 'forged', badge: { clientId: BADGES.vip.clientId, clientSecret: 'forged-at-the-rest-area' } };
  }

  async function driveOne(lane, exit) {
    const { shown, badge } = badgeFor(lane);
    const result = await throughBooth({ gatewayUrl: booth.gatewayUrl, exit, badge });
    const trip = {
      n: ++tripCount,
      at: new Date().toISOString(),
      lane,
      badge: shown,
      method: 'GET',
      path: EXITS[exit],
      status: result.status,
      verdict: result.verdict,
      ms: result.ms,
      headers: result.headers,
      road: result.status === 200 ? result.body : null,
      error: result.status === 200 ? null : errorText(result.body),
      window: lane === 'none' ? null : windows.track(lane, result.verdict),
    };
    trips.unshift(trip);
    trips.length = Math.min(trips.length, MAX_TRIPS);
    return trip;
  }

  async function handleDrive(req, res) {
    const input = await readJson(req);
    const lane = input && input.lane;
    const exit = input && input.exit;
    const count = input && Number(input.count);
    if (!LANES.includes(lane) || !(exit in EXITS) || !CONVOY_SIZES.includes(count)) {
      return json(res, 400, { error: `Send {"lane": ${JSON.stringify(LANES)}, "exit": ${JSON.stringify(Object.keys(EXITS))}, "count": ${JSON.stringify(CONVOY_SIZES)}}.` });
    }
    if (!booth.ready) return json(res, 503, { error: booth.error || 'The booth is still opening. Try again in a few seconds.' });
    if (drivesInFlight >= MAX_DRIVES_IN_FLIGHT) return json(res, 429, { error: 'The plaza is full. Try again in a second.' });

    drivesInFlight++;
    try {
      // One JSON line per car, as soon as the booth answers.
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
      const convoy = [];
      for (let i = 0; i < count; i++) {
        const trip = await driveOne(lane, exit);
        convoy.push(trip);
        res.write(JSON.stringify({ type: 'trip', ...trip }) + '\n');
      }
      // Latency is compared on the cars that reached the road. Then three cars
      // take the service lane, straight to the road, for the comparison.
      const paid = convoy.filter((t) => t.verdict === 'paid');
      const refused = convoy.filter((t) => t.verdict !== 'paid');
      if (paid.length) {
        const directMs = [];
        for (let i = 0; i < 3; i++) directMs.push((await direct(config)).ms);
        lastLatency = {
          gateway: median(paid.map((t) => t.ms)),
          proxy: median(paid.map((t) => Number(t.headers['otoroshi-proxy-latency']))),
          direct: median(directMs),
          samples: paid.length,
        };
      }
      res.end(JSON.stringify({
        type: 'summary',
        latency: lastLatency,
        refused: refused.length ? median(refused.map((t) => t.ms)) : null,
      }) + '\n');
    } finally {
      drivesInFlight--;
    }
  }

  // Calls left today (from Otoroshi) and this minute (followed by the app).
  function quotasView(daily) {
    const view = {};
    for (const lane of Object.keys(BADGES)) {
      const w = windows.view(lane);
      view[lane] = { ...daily[lane], windowLeft: w.left, windowAllowed: w.allowed, windowResetsInMs: w.resetsInMs };
    }
    return view;
  }

  async function handleState(res) {
    const state = {
      booth: { ready: booth.ready, error: booth.error, gatewayUrl: booth.gatewayUrl, roadUrl: config.roadUrl },
      lanes: Object.fromEntries(Object.entries(BADGES).map(([lane, b]) =>
        [lane, { clientId: b.clientId, name: b.clientName, window: b.window, windowMs: b.windowMs, daily: b.daily }])),
      trips,
      lastLatency,
      platform: platformInfo(env),
      live: null,
      quotas: null,
    };
    if (admin && booth.ready) {
      try {
        state.live = await readBooth(admin);
        state.quotas = quotasView(await readQuotas(admin));
      } catch (error) {
        state.booth.error = `Could not read the booth: ${error.message}`;
      }
    }
    json(res, 200, state);
  }

  async function handleDeepHealth(res) {
    if (!admin) return json(res, 503, { status: 'down', otoroshi: 'not linked' });
    const started = performance.now();
    try {
      await admin.get(`/api/routes/${ROUTE_ID}`);
      for (const badge of Object.values(BADGES)) await admin.get(`/api/apikeys/${badge.clientId}`);
      const ms = Math.round(performance.now() - started);
      json(res, 200, { status: 'ok', otoroshi: 'reachable', route: ROUTE_ID, badges: Object.keys(BADGES).length, ms });
    } catch (error) {
      json(res, 503, { status: 'down', otoroshi: error.status ? `answered ${error.status}` : 'unreachable' });
    }
  }

  async function handle(req, res) {
    const { pathname } = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && pathname === '/health') return json(res, 200, { status: 'ok' });
    if (req.method === 'GET' && pathname === '/health/deep') return handleDeepHealth(res);

    if (req.method === 'GET' && pathname.startsWith('/road/')) {
      const [status, body] = handleRoad(pathname, req.headers, config.roadToken);
      return json(res, status, body);
    }

    if (req.method === 'GET' && pathname === '/api/state') return handleState(res);
    if (req.method === 'GET' && pathname === '/api/quotas') {
      if (!admin || !booth.ready) return json(res, 503, { error: booth.error || 'The booth is still opening.' });
      return json(res, 200, quotasView(await readQuotas(admin)));
    }
    if (req.method === 'POST' && pathname === '/api/drive') return handleDrive(req, res);
    if (req.method === 'POST' && pathname === '/api/reset') {
      if (!admin || !booth.ready) return json(res, 503, { error: booth.error || 'The booth is still opening.' });
      // Resets the daily counters. Otoroshi keeps the minute window running.
      return json(res, 200, quotasView(await resetQuotas(admin)));
    }

    const file = req.method === 'GET' && files[pathname];
    if (file) {
      res.writeHead(200, { 'Content-Type': file.type, 'Cache-Control': 'no-cache', ...SECURITY_HEADERS });
      return res.end(file.body);
    }
    json(res, 404, { error: 'Not found' });
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      log(`[http] ${req.method} ${req.url}: ${error.message}`);
      if (!res.headersSent) json(res, 502, { error: 'The booth could not answer. Check the logs.' });
      else res.end();
    });
  });

  return { server, openBooth, booth };
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
  res.end(JSON.stringify(body));
}

async function readJson(req, limit = 2048) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) return null;
  }
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return null;
  }
}

function errorText(body) {
  if (!body) return null;
  return body['Otoroshi-Error'] || body.error || body.message || body.text || null;
}

// Start the server when run directly (npm start), not when imported by tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = readConfig();
  const { server, openBooth } = createApp(config);
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`[http] The Toll Booth listens on 0.0.0.0:${config.port}`);
    openBooth();
  });
  // Graceful stop on redeploy: finish the requests in flight, but do not let the
  // load balancer's keep-alive connections hold the old instance open.
  process.on('SIGTERM', () => {
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}
