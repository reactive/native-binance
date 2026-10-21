#!/bin/bash
# Installs this app and a sibling data-client checkout (cloning it if
# missing), builds data-client, and links its packages here. Meant for a cloud
# environment's setup script; locally, `yarn link:data-client` is enough.
set -euo pipefail

app="$(cd "$(dirname "$0")/.." && pwd)"
data_client="${DATA_CLIENT_DIR:-$app/../data-client}"

# Some cloud proxies block repo.yarnpkg.com, so corepack fetches Yarn from npm.
export COREPACK_NPM_REGISTRY="${COREPACK_NPM_REGISTRY:-https://registry.npmjs.org}"

if [ ! -f "$data_client/package.json" ]; then
  git clone --depth 1 https://github.com/reactive/data-client.git "$data_client" >&2
fi

(cd "$data_client" && corepack yarn install >&2)
# A full build takes minutes, so skip it when this commit was already built.
stamp="$data_client/node_modules/.native-binance-build"
head="$(git -C "$data_client" rev-parse HEAD)"
if [ "$(cat "$stamp" 2>/dev/null)" != "$head" ] || [ -n "$(git -C "$data_client" status --porcelain -- packages)" ]; then
  (cd "$data_client" && corepack yarn build >&2)
  echo "$head" > "$stamp"
fi

cd "$app"
corepack yarn install >&2
DATA_CLIENT_DIR="$data_client" corepack yarn link:data-client
