const { getDefaultConfig } = require('expo/metro-config');

const { enhanceMiddleware } = require('./binanceDevProxy');

const config = getDefaultConfig(__dirname);

// Dev web still resolves `expo-sqlite/web/worker.ts`, which imports
// `wa-sqlite.wasm`. Production `expo export -p web` succeeds without this,
// because that bundle drops the worker import.
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
