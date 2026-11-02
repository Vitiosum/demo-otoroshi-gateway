// Sends vehicles (HTTP requests) to the road, through the booth or directly.
// Runs server-side only: the badges' secrets never reach the browser.

import { TOKEN_HEADER } from './booth.js';

export const LANES = ['vip', 'standard', 'none'];
export const EXITS = { fortune: '/road/fortune', depot: '/road/depot' };
export const CONVOY_SIZES = [1, 10, 30];

// What the booth's answer means for the driver.
export function verdict(status) {
  if (status >= 200 && status < 300) return 'paid';
  if (status === 400) return 'no-badge'; // Otoroshi: "no apikey"
  if (status === 401) return 'bad-badge'; // Otoroshi: "bad apikey"
  if (status === 403) return 'forbidden';
  if (status === 429) return 'slow-down';
  return 'closed';
}

// The response headers worth showing: the ones Otoroshi adds.
export function gatewayHeaders(headers) {
  const picked = {};
  for (const [name, value] of headers) {
    const lower = name.toLowerCase();
    if (!lower.startsWith('otoroshi-')) continue;
    if (/secret|token|authorization|cookie/.test(lower)) continue;
    picked[lower] = value;
  }
  return picked;
}

// One car through the booth. `badge` is { clientId, clientSecret } or null.
export async function throughBooth({ gatewayUrl, exit, badge }) {
  const headers = { Accept: 'application/json' };
  if (badge) {
    headers['Otoroshi-Client-Id'] = badge.clientId;
    headers['Otoroshi-Client-Secret'] = badge.clientSecret;
  }
  return timedCall(gatewayUrl + EXITS[exit], headers);
}

// One car straight to the road, skipping the booth (the service lane).
// Used to compare latencies: same road, same network, no gateway.
export async function direct({ roadUrl, roadToken }) {
  const headers = { Accept: 'application/json' };
  if (roadToken) headers[TOKEN_HEADER] = roadToken;
  return timedCall(roadUrl + EXITS.fortune, headers);
}

async function timedCall(url, headers) {
  const started = performance.now();
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8_000) });
    const text = await res.text();
    const ms = performance.now() - started;
    return {
      status: res.status,
      verdict: verdict(res.status),
      ms: Math.round(ms * 10) / 10,
      headers: gatewayHeaders(res.headers),
      body: parseBody(text),
    };
  } catch (error) {
    return {
      status: 0,
      verdict: 'closed',
      ms: Math.round((performance.now() - started) * 10) / 10,
      headers: {},
      body: { error: error.name === 'TimeoutError' ? 'The road did not answer in 8 s.' : 'The road is unreachable.' },
    };
  }
}

function parseBody(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { text: text.slice(0, 200) };
  }
}

export function median(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
