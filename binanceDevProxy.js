const https = require('node:https');

const { DEV_PREFIX, SITE, TOKEN_INFO_PATH } = require('./src/resources/binanceSitePaths');

const SYMBOL = /^[A-Za-z0-9]{1,32}$/;

/**
 * Dev-server proxy for the one public asset read that omits CORS.
 * GET that path only. Anything else under the prefix is a 404, so this is not an open proxy.
 * @returns {URL | null}
 */
function tokenInfoTarget(reqUrl) {
  let url;
  try {
    url = new URL(reqUrl, 'http://localhost');
  } catch {
    return null;
  }
  if (url.pathname !== `${DEV_PREFIX}${TOKEN_INFO_PATH}`) return null;
  const symbol = url.searchParams.get('symbol');
  if (!symbol || !SYMBOL.test(symbol)) return null;
  return new URL(`${SITE}${TOKEN_INFO_PATH}?symbol=${encodeURIComponent(symbol)}`);
}

function proxyTokenInfo(req, res) {
  const target = tokenInfoTarget(req.url || '');
  if (!target || (req.method !== 'GET' && req.method !== 'HEAD')) {
    res.statusCode = target ? 405 : 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(target ? 'Method not allowed' : 'Not found');
    return;
  }

  const upstream = https.request(
    target,
    {
      method: 'GET',
      timeout: 15000,
      headers: { accept: 'application/json' },
    },
    upstreamResponse => {
      const headers = { ...upstreamResponse.headers };
      delete headers.connection;
      delete headers['keep-alive'];
      delete headers['proxy-connection'];
      delete headers['transfer-encoding'];
      delete headers['set-cookie'];
      res.writeHead(upstreamResponse.statusCode || 502, headers);
      if (req.method === 'HEAD') {
        upstreamResponse.resume();
        res.end();
        return;
      }
      upstreamResponse.pipe(res);
    },
  );
  upstream.on('timeout', () => upstream.destroy());
  upstream.on('error', () => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.statusCode = 502;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Bad gateway');
  });
  upstream.end();
}

/** Wrap Metro's dev middleware. Production export does not serve this. */
function enhanceMiddleware(middleware) {
  return (req, res, next) => {
    if ((req.url || '').startsWith(DEV_PREFIX)) {
      proxyTokenInfo(req, res);
      return;
    }
    return middleware(req, res, next);
  };
}

module.exports = { tokenInfoTarget, enhanceMiddleware };
