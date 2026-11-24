/**
 * 自动更新检查：只查 GitHub 最新 Release，不做静默替换。
 *
 * 绿色版正在运行，直接覆盖文件会锁住 exe/dll；安卓覆盖安装还要过系统安装器。
 * 所以这里只负责“告诉你有没有新版本、差在哪、去哪下”，下载与安装交给浏览器/系统。
 */
const net = require('./net');

const OWNER = 'MacroCN';
const REPO = 'we-mpkg';
const API = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;

let cached = null; // { at, data }
const TTL_MS = 6 * 60 * 60 * 1000;

function currentVersion() {
  try {
    return require('../package.json').version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** 只比较 x.y.z；非数字段按 0 处理 */
function compare(a, b) {
  const pa = String(a || '').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

function pickAssets(assets) {
  const list = (assets || []).map((a) => ({
    name: a.name,
    size: a.size,
    url: a.browser_download_url,
  }));
  return {
    all: list,
    portable: list.find((a) => /portable.*\.zip$/i.test(a.name)) || null,
    apk: list.find((a) => /\.apk$/i.test(a.name)) || null,
    src: list.find((a) => /src.*\.zip$/i.test(a.name)) || null,
  };
}

async function check({ force = false } = {}) {
  const current = currentVersion();
  if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.data;

  let release = null;
  let error = null;
  try {
    const body = await net.getText(API, { timeout: 12000 });
    const j = JSON.parse(body);
    release = {
      tag: j.tag_name,
      name: j.name,
      version: String(j.tag_name || '').replace(/^v/i, ''),
      url: j.html_url,
      notes: j.body || '',
      publishedAt: j.published_at,
      assets: pickAssets(j.assets),
    };
  } catch (e) {
    error = require('./errors').humanizeMessage(e);
  }

  const data = {
    current,
    latest: release ? release.version : null,
    hasUpdate: !!(release && compare(release.version, current) > 0),
    release,
    platform: process.platform,
    checkedAt: new Date().toISOString(),
    error,
  };
  cached = { at: Date.now(), data };
  return data;
}

module.exports = { check, currentVersion, compare };
