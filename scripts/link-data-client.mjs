// Points node_modules/@data-client/* at a sibling data-client checkout, so app
// code runs against its built packages. Build there first (`yarn build`).
// Unlike `yarn link`, this leaves package.json and yarn.lock untouched; any
// `yarn install` restores the npm copies, so rerun this after one.
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scope = join(root, 'node_modules/@data-client');
const dataClient = resolve(
  root,
  process.env.DATA_CLIENT_DIR ?? '../data-client',
);

if (process.argv.includes('--unlink')) {
  rmSync(scope, { recursive: true, force: true });
  execSync('yarn install', { cwd: root, stdio: 'inherit' });
  process.exit(0);
}

const packages = join(dataClient, 'packages');
if (!existsSync(packages)) {
  console.error(`Expected a data-client checkout at ${dataClient}.`);
  process.exit(1);
}

const sources = new Map();
for (const dir of readdirSync(packages)) {
  const manifest = join(packages, dir, 'package.json');
  if (!existsSync(manifest)) continue;
  const { name } = JSON.parse(readFileSync(manifest, 'utf8'));
  if (name?.startsWith('@data-client/')) sources.set(name, join(packages, dir));
}

for (const dir of readdirSync(scope)) {
  const source = sources.get(`@data-client/${dir}`);
  if (!source) continue;
  if (!existsSync(join(source, 'lib'))) {
    console.error(`${source} is not built. Run \`yarn build\` in ${dataClient}.`);
    process.exit(1);
  }
  const target = join(scope, dir);
  rmSync(target, { recursive: true, force: true });
  symlinkSync(relative(scope, source), target);
  console.log(`@data-client/${dir} -> ${source}`);
}
