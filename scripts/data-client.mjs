// Runs this app against a sibling data-client checkout (../data-client, or
// DATA_CLIENT_DIR) instead of the published packages.
//
//   link    point node_modules/@data-client/* at the checkout's built packages
//   unlink  restore the published packages
//   setup   clone (if missing), install, and build the checkout, then link;
//           cloud agent environments run this
//
// Unlike `yarn link`, linking leaves package.json and yarn.lock untouched, so
// any `yarn install` undoes it.
import { execSync } from 'node:child_process';
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scope = join(root, 'node_modules/@data-client');
const dataClient = resolve(
  root,
  process.env.DATA_CLIENT_DIR ?? '../data-client',
);
const repo = 'https://github.com/reactive/data-client.git';

const commands = { link, unlink, setup };
const command = commands[process.argv[2]];
if (!command) {
  console.error(`Usage: data-client.mjs <${Object.keys(commands).join('|')}>`);
  process.exit(1);
}
command();

function link() {
  const sources = packageSources();
  for (const dir of readdirSync(scope)) {
    const source = sources.get(`@data-client/${dir}`);
    if (!source) continue;
    if (!existsSync(join(source, 'lib'))) {
      fail(`${source} is not built. Run \`yarn build\` in ${dataClient}.`);
    }
    const target = join(scope, dir);
    rmSync(target, { recursive: true, force: true });
    symlinkSync(relative(scope, source), target);
    console.log(`@data-client/${dir} -> ${source}`);
  }
}

function unlink() {
  rmSync(scope, { recursive: true, force: true });
  yarn(root, 'install');
}

function setup() {
  if (!existsSync(join(dataClient, 'package.json'))) {
    run(root, `git clone --depth 1 ${repo} ${dataClient}`);
  }
  yarn(dataClient, 'install');
  buildIfChanged();
  yarn(root, 'install');
  link();
}

// A full build takes minutes, so skip it when this commit is already built.
function buildIfChanged() {
  const stamp = join(dataClient, 'node_modules/.native-binance-build');
  const head = git('rev-parse HEAD');
  const built = existsSync(stamp) && readFileSync(stamp, 'utf8') === head;
  if (built && !git('status --porcelain -- packages')) return;
  yarn(dataClient, 'build');
  writeFileSync(stamp, head);
}

function packageSources() {
  const packages = join(dataClient, 'packages');
  if (!existsSync(packages))
    fail(`Expected a data-client checkout at ${dataClient}.`);
  const sources = new Map();
  for (const dir of readdirSync(packages)) {
    const manifest = join(packages, dir, 'package.json');
    if (!existsSync(manifest)) continue;
    const { name } = JSON.parse(readFileSync(manifest, 'utf8'));
    if (name?.startsWith('@data-client/'))
      sources.set(name, join(packages, dir));
  }
  return sources;
}

function yarn(cwd, args) {
  run(cwd, `corepack yarn ${args}`);
}

function git(args) {
  return execSync(`git ${args}`, { cwd: dataClient, encoding: 'utf8' }).trim();
}

function run(cwd, cmd) {
  execSync(cmd, { cwd, stdio: 'inherit' });
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
