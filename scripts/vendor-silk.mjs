import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const silk = resolve(root, '../silk');

if (!existsSync(resolve(silk, 'package.json'))) {
  console.error(
    'Expected a silk checkout at ../silk. @reactive/silk is not published yet.',
  );
  process.exit(1);
}

const yarn = 'corepack yarn';
execSync(`${yarn} workspace @reactive/silk-core build`, {
  cwd: silk,
  stdio: 'inherit',
});
execSync(`${yarn} workspace @reactive/silk-native build`, {
  cwd: silk,
  stdio: 'inherit',
});
execSync(`${yarn} workspace @reactive/silk-core pack --out ${root}/vendor/silk-core.tgz`, {
  cwd: silk,
  stdio: 'inherit',
});
execSync(
  `${yarn} workspace @reactive/silk-native pack --out ${root}/vendor/silk-native.tgz`,
  { cwd: silk, stdio: 'inherit' },
);
