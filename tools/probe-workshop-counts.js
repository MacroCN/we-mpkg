'use strict';
/**
 * 探针：对比创意工坊网页在不同参数下返回的条目总量，
 * 用于分析「网页抓取比客户端少」的原因。
 *   node tools\probe-workshop-counts.js
 */
const net = require('../src/net');
const { parseBrowseHtml } = require('../src/workshop');

const APP = 431960;

function url(params) {
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return `https://steamcommunity.com/workshop/browse/?${qs}`;
}

function summarize(label, html) {
  const parsed = parseBrowseHtml(html);
  const showing = html.match(/Showing\s+[\d,]+-[\d,]+\s+of\s+([\d,]+)/i);
  const noResults = /no items|There were no items|没有找到/i.test(html);
  console.log(
    `${label.padEnd(46)} items=${String(parsed.items.length).padStart(3)} total=${String(parsed.total).padStart(7)} ${showing ? `"of ${showing[1]}"` : ''}${noResults ? ' [无结果文案]' : ''}`
  );
  return { parsed, html };
}

async function main() {
  const cases = [
    ['默认（trend，无 days，perPage 30）', { appid: APP, browsesort: 'trend', section: 'readytouseitems', actualsort: 'trend', p: 1, numperpage: 30 }],
    ['trend + days=7', { appid: APP, browsesort: 'trend', section: 'readytouseitems', actualsort: 'trend', days: 7, p: 1, numperpage: 30 }],
    ['trend + days=30', { appid: APP, browsesort: 'trend', section: 'readytouseitems', actualsort: 'trend', days: 30, p: 1, numperpage: 30 }],
    ['trend + days=90', { appid: APP, browsesort: 'trend', section: 'readytouseitems', actualsort: 'trend', days: 90, p: 1, numperpage: 30 }],
    ['mostrecent', { appid: APP, browsesort: 'mostrecent', section: 'readytouseitems', actualsort: 'mostrecent', p: 1, numperpage: 30 }],
    ['lastupdated', { appid: APP, browsesort: 'lastupdated', section: 'readytouseitems', actualsort: 'lastupdated', p: 1, numperpage: 30 }],
    ['totaluniquesubscribers', { appid: APP, browsesort: 'totaluniquesubscribers', section: 'readytouseitems', actualsort: 'totaluniquesubscribers', p: 1, numperpage: 30 }],
    ['trend + numperpage=100', { appid: APP, browsesort: 'trend', section: 'readytouseitems', actualsort: 'trend', p: 1, numperpage: 100 }],
    ['trend 不带 section', { appid: APP, browsesort: 'trend', actualsort: 'trend', p: 1, numperpage: 30 }],
    ['trend p=10', { appid: APP, browsesort: 'trend', section: 'readytouseitems', actualsort: 'trend', p: 10, numperpage: 30 }],
    ['trend p=100', { appid: APP, browsesort: 'trend', section: 'readytouseitems', actualsort: 'trend', p: 100, numperpage: 30 }],
  ];

  const cookie = net.steamCookie();
  for (const [label, params] of cases) {
    try {
      const html = await net.getText(url(params), {
        timeout: 20000,
        retries: 0,
        headers: { Cookie: cookie, 'Accept-Language': 'en-US,en;q=0.9' },
      });
      summarize(label, html);
    } catch (e) {
      console.log(`${label.padEnd(46)} 失败: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
