const { config } = require('../src/config');
const net = require('../src/net');

console.log('PROXY=', config.PROXY, 'USE_CURL_FALLBACK=', config.USE_CURL_FALLBACK, 'LANG=', config.LANG);

(async () => {
  for (const url of ['https://example.com/', 'https://steamcommunity.com/workshop/browse/?appid=431960']) {
    try {
      const r = await net.request(url, { timeout: 12000, retries: 0 });
      console.log(url, '→', r.status, 'len', r.body.length);
    } catch (e) {
      console.log(url, '→ ERR', e && (e.code || ''), '|', e && e.message);
    }
  }
})();
