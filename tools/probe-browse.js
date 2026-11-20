const net = require('../src/net');
const fs = require('fs');

(async () => {
  const url = 'https://steamcommunity.com/workshop/browse/?appid=431960&browsesort=trend&section=readytouseitems&p=1';
  const html = await net.getText(url, { timeout: 25000, retries: 0 });
  fs.writeFileSync(__dirname + '/../logs/browse.html', html);
  console.log('已存 logs/browse.html', html.length);

  // 所有 script 标签的 id/type
  const tags = [...html.matchAll(/<script[^>]*>/g)].slice(0, 40).map((m) => m[0].slice(0, 120));
  console.log('--- script 标签样本 ---');
  tags.filter((t) => /json|id=/.test(t)).forEach((t) => console.log(t));

  for (const k of ['resolution', 'filters', 'content_descriptor', 'agerating', 'agegate', 'AgeRating']) {
    let i = -1;
    while ((i = html.indexOf(k, i + 1)) >= 0) {
      console.log(`\n[${k}] @${i}:`, html.slice(Math.max(0, i - 60), i + 100).replace(/\s+/g, ' '));
      if (i > 200000) break;
    }
  }
})().catch((e) => console.error('ERR', e.message));

