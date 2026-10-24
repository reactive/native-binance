// Jest resolver used only while @data-client is linked. See linkedDataClient.js.
const path = require('node:path');

const { root, resolveLinked } = require('./linkedDataClient');
const preset = require('jest-expo/jest-preset').resolver;
const resolve = preset
  ? require(preset)
  : (request, options) => options.defaultResolver(request, options);

module.exports = (request, options) =>
  resolveLinked(path.join(options.basedir, 'x'), request, fromRoot =>
    resolve(request, fromRoot ? { ...options, basedir: root } : options),
  );
