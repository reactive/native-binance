const { getDefaultConfig } = require('expo/metro-config');

const { enhanceMiddleware } = require('./binanceDevProxy');

const config = getDefaultConfig(__dirname);

// The server bundle keeps `require()` calls that the web client bundle deletes.
// `expo-sqlite/localStorage/install` guards on `EXPO_OS`, which is not inlined
// for that bundle, so Metro still resolves the wasm asset. Web never executes it.
if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}

// Dev server only. `expo export` does not serve this, and native builds never call it.
// `yarn web` fetches token-info through this prefix because that response has no CORS header.
if (process.env.NODE_ENV !== 'production') {
  const prior = config.server.enhanceMiddleware;
  config.server.enhanceMiddleware = (middleware, server) => {
    const next = prior ? prior(middleware, server) : middleware;
    return enhanceMiddleware(next);
  };
}

module.exports = config;
