const { packageDirs } = require('./scripts/linkedDataClient');

module.exports = {
  preset: 'jest-expo',
  ...(packageDirs.length && {
    resolver: '<rootDir>/scripts/jestLinkedResolver.js',
  }),
};
