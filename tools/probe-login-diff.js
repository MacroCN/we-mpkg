'use strict';
/**
 * 对比「匿名态」与「登录态」抓到的创意工坊数量差
 * 同一批 URL 各抓两次（带 / 不带 steamLoginSecure），比较总数与首页条目集合。
 * 用法： node tools\probe-login-diff.js      （桌面需要代理：WE_MPKG_PROXY=http://127.0.0.1:7890）
 */
const fs = require('fs');
const path = require('path');
const net = require('../src/net');
const workshop = require('../src/workshop');

const COOKIE_FILE = path.join(__dirname, '..', '.cache', 'webcookies.json');

function loginCookie() {
  try {
    const j = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
    return j && j.cookie ? j.cookie : '';
  } catch { return ''; }
}

const CASES = [
  { name: 'trend 默认(7天)', sort: 'trend', days: 7 },
  { name: 'trend 30天', sort: 'trend', days: 30 },
  { name: 'toprated 最高评分', sort: 'toprated' },
  { name: 'mostrecent 最新', sort: 'mostrecent' },
  { name: 'search=anime', search: 'anime' },
  { name: 'tag=Audio Visualizer', tags: ['Audio Visualizer'] },
];

async function fetchOne(opts) {
  const out = await workshop.browseHtml({ search: opts.search || '', sort: opts.sort, tags: opts.tags || [], page: 1, perPage: 30, pages: 1, days: opts.days || 0, lang: 'en' });
  return { total: out.total, ids: (out.items || []).map((i) => i.id), warning: out.warning || '' };
}

(async () => {
  const cookie = loginCookie();
  const rows = [];
  for (const c of CASES) {
    const anon = await fetchOne(c);
    await net.sleep(500);
    net.setLoginCookie(cookie);
    const logged = await fetchOne(c);
    net.setLoginCookie(''); // 恢复匿名
    await net.sleep(500);
    const onlyLogin = logged.ids.filter((id) => !anon.ids.includes(id));
    rows.push({
      场景: c.name,
      匿名总数: anon.total,
      登录总数: logged.total,
      差值: logged.total - anon.total,
      '页面返回(匿名/登录)': `${anon.ids.length}/${logged.ids.length}`,
      仅登录可见: onlyLogin.length,
      err: anon.warning || logged.warning,
    });
  }
  console.table(rows);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
