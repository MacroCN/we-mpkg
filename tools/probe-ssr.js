const net = require('../src/net');
const fs = require('fs');

(async () => {
  const url = 'https://steamcommunity.com/workshop/browse/?appid=431960&browsesort=trend&section=readytouseitems&actualsort=trend&p=1&numperpage=30';
  const html = await net.getText(url, { timeout: 25000, retries: 0 });
  console.log('页面长度', html.length);
  const m = html.match(/<script type="application\/json" id="([^"]+)">([\s\S]*?)<\/script>/);
  console.log('内嵌 JSON id:', m && m[1], '长度', m && m[2] && m[2].length);
  if (m) {
    fs.writeFileSync(__dirname + '/../../logs/ssr.json', m[2]);
    console.log('已存 logs/ssr.json');
  }
  for (const k of ['resolution', 'agerating', 'age_rating', 'mature', '1920x1080', 'requiredtags', 'filters', 'content_descriptor']) {
    const i = html.indexOf(k);
    console.log(k, i >= 0 ? '@' + i : '无');
  }
})().catch((e) => console.error('ERR', e.message));
