// Jest resolver used only while @data-client is linked. See linkedDataClient.js.
const path = require('node:path');

const { root, resolvesFromRoot } = require('./linkedDataClient');
const preset = require('jest-expo/jest-preset').resolver;
const resolve = preset
  ? require(preset)
  : (request, options) => options.defaultResolver(request, options);

module.exports = (request, options) =>
  resolve(
    request,
    resolvesFromRoot(path.join(options.basedir, 'x'), request)
      ? { ...options, basedir: root }
      : options,
  );
