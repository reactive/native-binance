// Finds @data-client packages that `yarn link:data-client` symlinked to a
// sibling checkout. Their bare imports must resolve from this project, or the
// checkout's own node_modules supplies a second React and hooks break.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const scope = path.join(root, 'node_modules/@data-client');

const packageDirs = (fs.existsSync(scope) ? fs.readdirSync(scope) : [])
  .map(name => path.join(scope, name))
  .filter(dir => fs.lstatSync(dir).isSymbolicLink())
  .map(dir => fs.realpathSync(dir));

function isBare(request) {
  return !request.startsWith('.') && !path.isAbsolute(request);
}

// True when `request`, imported from `fromPath`, should resolve from `root`.
function resolvesFromRoot(fromPath, request) {
  return (
    isBare(request) &&
    packageDirs.some(dir => fromPath.startsWith(dir + path.sep))
  );
}

module.exports = { root, packageDirs, resolvesFromRoot };
