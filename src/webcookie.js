'use strict';
/**
 * 社区站登录态（steamLoginSecure）
 *
 * 为什么需要：
 *  steamcommunity.com 的创意工坊页面在**匿名**状态下按「未登录用户」的范围做内容过滤
 *  （成人内容、部分地区受限条目直接被裁掉），而桌面客户端用的是你账号的登录态，
 *  所以网页抓出来的条目总比客户端少一截。
 *
 * 怎么拿：
 *  复用已保存的 refresh token 连一次 Steam（steam-user），调 `webLogOn()` 走 CM 通道换
 *  `steamLoginSecure=<steamID64>%7C%7C<accessToken>`。这就是 Steam 客户端/手机端那套 web 会话，
 *  steamcommunity.com 认它，内容范围就变成「你的账号」。
 *
 * 注意两点：
 *  1) 这不是「伪装成客户端」——HTTP 头改成什么样都不会改变服务端返回的物品集合，
 *     真正起作用的是**登录态**。伪造 UA / 客户端标识只会增加风控概率，所以这里不做。
 *  2) 换 cookie 只需要一次 CM 连接，拿到后缓存 12 小时（access token 本身能活很久），
 *     避免在下载任务进行中反复建连、和下载用的连接互相打扰。
 */
const fs = require('fs');
const path = require('path');
const { config } = require('./config');

const COOKIE_FILE = path.join(config.CACHE_DIR, 'webcookies.json');
const TOKEN_FILE = path.join(config.CACHE_DIR, 'steam-token.json');
const TTL_MS = Number(process.env.WE_MPKG_WEBSESSION_TTL_MS || 12 * 60 * 60 * 1000);

function proxyOptions() {
  const raw = config.PROXY;
  if (!raw) return {};
  try {
    const u = new URL(/^\w+:\/\//.test(raw) ? raw : `http://${raw}`);
    const opt = { proxy: `${u.protocol}//${u.host}` };
    if (u.username) {
      opt.proxyUsername = decodeURIComponent(u.username);
      opt.proxyPassword = decodeURIComponent(u.password || '');
    }
    return opt;
  } catch {
    return {};
  }
}

function readToken() {
  try {
    const j = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    return j && j.refreshToken ? j : null;
  } catch {
    return null;
  }
}

function readCache() {
  try {
    const j = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
    if (!j || !j.cookie || !j.at) return null;
    return j;
  } catch {
    return null;
  }
}

function freshCache() {
  const j = readCache();
  if (!j) return null;
  if (Date.now() - j.at > TTL_MS) return null;
  return j;
}

function writeCache(data) {
  try {
    fs.mkdirSync(path.dirname(COOKIE_FILE), { recursive: true });
    fs.writeFileSync(COOKIE_FILE, JSON.stringify(data, null, 2));
    try { fs.chmodSync(COOKIE_FILE, 0o600); } catch { /* Windows 忽略 */ }
  } catch { /* 缓存写不进去不影响功能 */ }
}

function clear() {
  try { fs.unlinkSync(COOKIE_FILE); } catch { /* ignore */ }
}

/** 建一条临时 CM 连接，只为了换 web cookie，拿到就断开 */
function fetchCookies(refreshToken) {
  const SteamUser = require('steam-user');
  return new Promise((resolve, reject) => {
    let settled = false;
    const client = new SteamUser(Object.assign({
      autoRelogin: false,
      renewRefreshTokens: false, // 不要轮换 refresh token，免得把下载用的凭据换掉
    }, proxyOptions()));

    const finish = (err, data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { client.logOff(); } catch { /* ignore */ }
      if (err) reject(err); else resolve(data);
    };
    const timer = setTimeout(() => finish(new Error('等待 webSession 超时（请检查加速器/代理）')), 30000);

    client.on('loggedOn', () => {
      try { client.webLogOn(); } catch (e) { finish(e); }
    });
    client.on('webSession', (sessionId, cookies) => {
      const cookie = (cookies || []).join('; ');
      const steamId = client.steamID ? client.steamID.getSteamID64() : '';
      if (!cookie.includes('steamLoginSecure=')) { finish(new Error('没有拿到 steamLoginSecure')); return; }
      finish(null, { cookie, steamId, sessionId });
    });
    client.on('error', (e) => finish(e));
    client.logOn({ refreshToken });
  });
}

let inflight = null;

/**
 * 取社区站登录 cookie（带缓存）。
 * @returns {Promise<{cookie:string, steamId:string, accountName?:string, at:number}|null>}
 *          没登录凭据 / 取不到时返回 null，调用方按匿名态继续
 */
async function getLoginCookie({ force = false, onLog = () => {}, allowFetch = true } = {}) {
  const cached = freshCache();
  if (cached && !force) return cached;

  const token = readToken();
  if (!token) return null;
  if (!allowFetch) return cached; // 例如下载任务进行中：先用旧 cookie，不去建新连接

  if (inflight) return inflight;

  inflight = (async () => {
    const r = await fetchCookies(token.refreshToken);
    const data = { cookie: r.cookie, steamId: r.steamId, accountName: token.accountName || null, at: Date.now() };
    writeCache(data);
    onLog(`✔ 已启用社区站登录态（${data.accountName || data.steamId}），内容范围跟随账号`);
    return data;
  })()
    .catch((e) => {
      onLog(`⚠ 取社区站登录态失败（${e.message}），本次按匿名态抓取`);
      return cached || null;
    })
    .finally(() => { inflight = null; });

  return inflight;
}

/** 只读缓存，不发起网络请求（给 /api/config、状态显示用） */
function cachedStatus() {
  const j = readCache();
  if (!j) return { loggedIn: false, fresh: false };
  return {
    loggedIn: true,
    fresh: Date.now() - j.at <= TTL_MS,
    accountName: j.accountName || '',
    steamId: j.steamId || '',
    at: j.at,
  };
}

/** 供测试用：直接解析一段 cookie 字符串里的 steamID64 */
function steamIdFromCookie(cookie) {
  const m = String(cookie || '').match(/steamLoginSecure=(\d{17})/);
  return m ? m[1] : '';
}

module.exports = { getLoginCookie, cachedStatus, clear, steamIdFromCookie, COOKIE_FILE, TTL_MS };
