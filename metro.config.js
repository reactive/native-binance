const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The server bundle keeps `require()` calls that the web client bundle deletes.
// `expo-sqlite/localStorage/install` guards on `EXPO_OS`, which is not inlined
// for that bundle, so Metro still resolves the wasm asset. Web never executes it.
if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}

module.exports = config;
