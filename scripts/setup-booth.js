// Configures Otoroshi through its admin API: the route in front of the road
// and the two badges with their quotas. Idempotent: run it as often as you like.
//
//   CC_OTOROSHI_API_URL=... CC_OTOROSHI_API_CLIENT_ID=... CC_OTOROSHI_API_CLIENT_SECRET=... \
//   ROAD_URL=https://app-xxxx.cleverapps.io ROAD_TOKEN=... npm run setup
//
// The app runs the same code at every boot, so a plain `clever deploy` is enough
// on Clever Cloud. This script is for a first look, or to repair the booth by hand.

import { readConfig, hasOtoroshi } from '../src/config.js';
import { adminClient, ensureBooth, readQuotas, BADGES, FORBIDDEN_PATH } from '../src/booth.js';

const config = readConfig();
if (!hasOtoroshi(config)) {
  console.error('Set CC_OTOROSHI_API_URL, CC_OTOROSHI_API_CLIENT_ID and CC_OTOROSHI_API_CLIENT_SECRET first.');
  process.exit(1);
}

const admin = adminClient(config.otoroshi);
const { route, gatewayUrl } = await ensureBooth({ admin, roadUrl: config.roadUrl, roadToken: config.roadToken });
const quotas = await readQuotas(admin);

console.log(`Route      ${route.id}  ${route.frontend.domains[0]} -> ${route.backend.targets[0].hostname}`);
console.log(`Plugins    ${route.plugins.map((p) => p.plugin.split('.').pop()).join(', ')}`);
console.log(`Path rule  ${FORBIDDEN_PATH} answered 403`);
for (const [lane, badge] of Object.entries(BADGES)) {
  const q = quotas[lane];
  console.log(`Badge      ${badge.clientId}  ${badge.window} calls/min, ${badge.daily}/day  (left today: ${q.dailyLeft})`);
}
console.log(`Try it     curl -i ${gatewayUrl}/road/fortune   # 401: no badge`);
if (!config.roadToken) console.log('Warning    ROAD_TOKEN is empty: the road also answers without the booth.');
