const { getDefaultConfig } = require('expo/metro-config');

const path = require('node:path');

const { enhanceMiddleware } = require('./binanceDevProxy');
const { packageDirs, resolvesFromRoot } = require('./scripts/linkedDataClient');

const config = getDefaultConfig(__dirname);

// The server bundle keeps `require()` calls that the web client bundle deletes.
// `expo-sqlite/localStorage/install` guards on `EXPO_OS`, which is not inlined
// for that bundle, so Metro still resolves the wasm asset. Web never executes it.
if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}

// `yarn link:data-client` symlinks a sibling checkout; see scripts/linkedDataClient.js.
if (packageDirs.length) {
  config.watchFolders = [...config.watchFolders, ...packageDirs];
  const prior = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    const next = prior ?? context.resolveRequest;
    return next(
      resolvesFromRoot(context.originModulePath, moduleName)
        ? { ...context, originModulePath: path.join(__dirname, 'package.json') }
        : context,
      moduleName,
      platform,
    );
  };
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
