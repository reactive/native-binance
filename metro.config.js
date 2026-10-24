const { getDefaultConfig } = require('expo/metro-config');

const path = require('node:path');

const { enhanceMiddleware } = require('./binanceDevProxy');
const { packageDirs, resolveLinked } = require('./scripts/linkedDataClient');

const config = getDefaultConfig(__dirname);

// Dev web still resolves `expo-sqlite/web/worker.ts`, which imports
// `wa-sqlite.wasm`. Production `expo export -p web` succeeds without this,
// because that bundle drops the worker import.
if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}

// `yarn link:data-client` symlinks a sibling checkout; see scripts/linkedDataClient.js.
if (packageDirs.length) {
  config.watchFolders = [...config.watchFolders, ...packageDirs];
  const prior = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    const next = prior ?? context.resolveRequest;
    const fromRoot = {
      ...context,
      originModulePath: path.join(__dirname, 'package.json'),
    };
    return resolveLinked(context.originModulePath, moduleName, useRoot =>
      next(useRoot ? fromRoot : context, moduleName, platform),
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
