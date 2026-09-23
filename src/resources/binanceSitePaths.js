/** Shared by the dev server and the web URL helper. No Node builtins, so the client can import it. */
module.exports = {
  /** Metro dev server only. Not part of a production web or native build. */
  DEV_PREFIX: '/__binance',
  SITE: 'https://www.binance.com',
  /** The asset read that sends no Access-Control-Allow-Origin. */
  TOKEN_INFO_PATH: '/bapi/apex/v1/friendly/apex/marketing/web/token-info',
};
