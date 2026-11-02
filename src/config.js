// Everything the app reads from its environment, in one place.
//
// Otoroshi variables are injected by Clever Cloud when the add-on is linked
// to the app (clever service link-addon). They are read here, never copied.

export function readConfig(env = process.env) {
  return {
    port: Number(env.PORT) || 8080,

    otoroshi: {
      url: trimSlash(env.CC_OTOROSHI_API_URL),
      clientId: env.CC_OTOROSHI_API_CLIENT_ID || '',
      clientSecret: env.CC_OTOROSHI_API_CLIENT_SECRET || '',
    },

    // Shared secret the booth adds to every request it lets through.
    // The road refuses any request that does not carry it.
    roadToken: env.ROAD_TOKEN || '',

    // Public URL of this app (the road), used as the gateway's backend.
    // On Clever Cloud it defaults to the app's own cleverapps.io domain.
    roadUrl: trimSlash(env.ROAD_URL) || defaultRoadUrl(env.APP_ID),

    // Optional: the gateway's public URL. By default it is read from
    // Otoroshi itself (the routes domain of the add-on).
    gatewayUrl: trimSlash(env.GATEWAY_URL),
  };
}

export function hasOtoroshi(config) {
  const { url, clientId, clientSecret } = config.otoroshi;
  return Boolean(url && clientId && clientSecret);
}

// The platform variables shown in the "Running on Clever Cloud" panel.
// Nothing else from the environment ever reaches the browser.
export function platformInfo(env = process.env) {
  const commit = env.CC_COMMIT_ID || env.COMMIT_ID || '';
  return {
    CC_APP_NAME: env.CC_APP_NAME || '',
    APP_ID: env.APP_ID || '',
    INSTANCE_NUMBER: env.INSTANCE_NUMBER || '',
    INSTANCE_TYPE: env.INSTANCE_TYPE || '',
    CC_PRETTY_INSTANCE_NAME: env.CC_PRETTY_INSTANCE_NAME || '',
    CC_COMMIT_ID: commit.slice(0, 7),
    CC_DEPLOYMENT_ID: env.CC_DEPLOYMENT_ID || env.DEPLOYMENT_ID || '',
  };
}

// app_<uuid> is served by default at https://app-<uuid>.cleverapps.io
function defaultRoadUrl(appId) {
  if (!appId || !appId.startsWith('app_')) return '';
  return `https://${appId.replace('app_', 'app-')}.cleverapps.io`;
}

function trimSlash(value) {
  return (value || '').trim().replace(/\/+$/, '');
}
