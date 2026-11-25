'use strict';
/**
 * 极简 HTTP 客户端（零依赖）：
 *  - 支持直连 / HTTP 代理（https 目标走 CONNECT 隧道）
 *  - 自动跟随重定向、超时、有限重试
 *  - Windows 下原生 TLS 失败时用 curl.exe 兜底（国内访问 Steam 常见）
 */
const http = require('http');
const https = require('https');
const tls = require('tls');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { URL } = require('url');
const { config } = require('./config');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function parseProxy(raw) {
  if (!raw) return null;
  let v = String(raw).trim();
  if (!v) return null;
  if (!/^\w+:\/\//.test(v)) v = `http://${v}`;
  try {
    const u = new URL(v);
    if (!u.hostname) return null;
    return {
      hostname: u.hostname,
      port: u.port ? parseInt(u.port, 10) : 80,
      auth: u.username
        ? 'Basic ' + Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password || '')}`).toString('base64')
        : '',
      raw: v,
    };
  } catch {
    return null;
  }
}

/** 每次请求时读取当前代理，设置页改完立即生效 */
function currentProxy() {
  return parseProxy(config.PROXY);
}

/**
 * 登录态 cookie（steamLoginSecure 等），由 src/webcookie.js 在拿到 Steam 登录凭据后注入。
 * 有它时 steamcommunity 按「你账号」返回内容；没有就退化成匿名态。
 */
let loginCookie = '';

function setLoginCookie(cookie) {
  loginCookie = String(cookie || '');
}

/** 当前请求是否带上了账号登录态 */
function hasLoginCookie() {
  return !!loginCookie;
}

/**
 * steamcommunity 的偏好 Cookie（避免反复的成人内容年龄确认）
 * @param {{anon?:boolean}} opts anon:true 时故意不带登录态，用于「匿名 vs 账号」对比
 */
function steamCookie(opts = {}) {
  return [
    // 登录态必须放最前：它决定了内容集合，后面的偏好只是补充
    opts.anon ? '' : loginCookie,
    'birthtime=946684801',
    'lastagecheckage=1-January-2000',
    'mature_content=1',
    'wants_mature_content=1',
    'wants_community_generated_adult_content=1',
    `Steam_Language=${config.LANG}`,
    'timezoneOffset=28800,0',
    config.COUNTRY ? `steamCountry=${config.COUNTRY}` : '',
  ].filter(Boolean).join('; ');
}

/** 单次请求，不处理重定向 */
function requestOnce(urlStr, opts, proxy) {
  const u = new URL(urlStr);
  const isHttps = u.protocol === 'https:';
  const timeout = opts.timeout || 20000;
  const headers = Object.assign({
    'User-Agent': UA,
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Accept-Encoding': 'identity',
    Connection: 'close',
  }, opts.headers || {});
  const bodyBuf = opts.body
    ? (Buffer.isBuffer(opts.body) ? opts.body : Buffer.from(String(opts.body)))
    : null;
  if (bodyBuf) headers['Content-Length'] = String(bodyBuf.length);

  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (e) => { if (!settled) { settled = true; reject(e); } };
    const ok = (v) => { if (!settled) { settled = true; resolve(v); } };

    const onResponse = (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), url: urlStr }));
      res.on('error', fail);
    };

    const send = (req) => {
      req.setTimeout(timeout, () => req.destroy(new Error(`Timeout(${timeout}ms) ${urlStr}`)));
      req.on('error', fail);
      if (bodyBuf) req.write(bodyBuf);
      req.end();
    };

    if (!proxy) {
      const mod = isHttps ? https : http;
      send(mod.request({
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: u.pathname + u.search,
        method: opts.method || 'GET',
        headers,
      }, onResponse));
      return;
    }

    if (!isHttps) {
      const h = Object.assign({}, headers);
      if (proxy.auth) h['Proxy-Authorization'] = proxy.auth;
      send(http.request({
        hostname: proxy.hostname,
        port: proxy.port,
        method: opts.method || 'GET',
        path: `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}${u.pathname}${u.search}`,
        headers: h,
      }, onResponse));
      return;
    }

    // https over HTTP proxy: CONNECT 隧道
    const connectHeaders = { Host: `${u.hostname}:${u.port || 443}` };
    if (proxy.auth) connectHeaders['Proxy-Authorization'] = proxy.auth;
    const connectReq = http.request({
      hostname: proxy.hostname,
      port: proxy.port,
      method: 'CONNECT',
      path: `${u.hostname}:${u.port || 443}`,
      headers: connectHeaders,
    });
    connectReq.setTimeout(timeout, () => connectReq.destroy(new Error('Proxy CONNECT timeout')));
    connectReq.on('error', fail);
    connectReq.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        return fail(new Error(`Proxy CONNECT ${res.statusCode}`));
      }
      const secure = tls.connect({ socket, servername: u.hostname }, () => {
        const req = https.request({
          hostname: u.hostname,
          port: u.port || 443,
          path: u.pathname + u.search,
          method: opts.method || 'GET',
          headers,
          agent: false,
          createConnection: () => secure,
        }, onResponse);
        req.setTimeout(timeout, () => req.destroy(new Error(`Timeout(${timeout}ms) ${urlStr}`)));
        req.on('error', fail);
        if (bodyBuf) req.write(bodyBuf);
        req.end();
      });
      secure.on('error', fail);
    });
    connectReq.end();
  });
}

/** curl.exe 兜底：先按配置里的代理走，失败再交给 curl 自己去读系统代理（Windows 注册表） */
function curlOnce(urlStr, opts) {
  const p = currentProxy();
  const tries = p ? [p.raw, null] : [null];
  const base = [];
  for (const [k, v] of Object.entries(opts.headers || {})) {
    if (v === undefined || v === null || v === '') continue;
    base.push('-H', `${k}: ${v}`);
  }
  if (opts.body) base.push('--data-binary', Buffer.isBuffer(opts.body) ? opts.body.toString('utf8') : String(opts.body));

  const attempt = (idx) => new Promise((resolve, reject) => {
    const outFile = path.join(os.tmpdir(), `wempkg-curl-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    const args = [
      '--silent', '--show-error', '--compressed',
      '--max-time', String(Math.max(5, Math.ceil((opts.timeout || 20000) / 1000))),
      '--request', opts.method || 'GET',
      '--url', urlStr,
      '--output', outFile,
      '--write-out', '%{http_code}\n%{redirect_url}',
    ];
    const px = tries[idx];
    if (px) args.unshift('--proxy', px);
    args.push(...base);
    execFile(config.CURL_BIN || 'curl.exe', args, { windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      const cleanup = () => { try { fs.unlinkSync(outFile); } catch { /* ignore */ } };
      if (err) {
        cleanup();
        const msg = (err.message || 'curl failed').trim();
        // 显式代理握手失败时，换「跟随系统代理」再试一次
        if (idx + 1 < tries.length) return attempt(idx + 1).then(resolve, reject);
        return reject(new Error(msg));
      }
      let buf;
      try { buf = fs.readFileSync(outFile); } catch (e) { cleanup(); return reject(e); }
      cleanup();
      const code = parseInt(String(stdout).trim().split(/\r?\n/)[0], 10) || 0;
      const redirectUrl = (String(stdout).trim().split(/\r?\n/)[1] || '').trim();
      if (code < 200 || code >= 400) {
        if (idx + 1 < tries.length) return attempt(idx + 1).then(resolve, reject);
        return reject(new Error(`HTTP ${code}`));
      }
      resolve({ status: code, headers: redirectUrl ? { location: redirectUrl } : {}, body: buf, url: urlStr });
    });
  });
  return attempt(0);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * 发起请求，返回 { status, headers, body(Buffer), url }
 */
async function request(urlStr, opts = {}) {
  const retries = opts.retries === undefined ? 1 : opts.retries;
  const proxy = currentProxy();
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res;
    try {
      res = await requestOnce(urlStr, opts, proxy);
    } catch (e) {
      lastErr = e;
      if (config.USE_CURL_FALLBACK) {
        try {
          res = await curlOnce(urlStr, opts);
        } catch (e2) {
          lastErr = e2;
          await sleep(500 * (attempt + 1));
          continue;
        }
      } else {
        await sleep(500 * (attempt + 1));
        continue;
      }
    }
    // 手动跟随重定向（curl 兜底也关闭自动跟随，统一在这里处理）
    let cur = res;
    let redirects = 0;
    while (cur.status >= 300 && cur.status < 400 && cur.headers && cur.headers.location && redirects < 5) {
      const loc = cur.headers.location;
      const fromUrl = cur.url || urlStr;
      const next = new URL(loc, fromUrl).toString();
      const method = cur.status === 303 ? 'GET' : (opts.method || 'GET');
      const headers = Object.assign({}, opts.headers || {});
      // 跨域重定向时不能把 Steam 登录态/授权头带到第三方站点
      if (new URL(fromUrl).origin !== new URL(next).origin) {
        for (const k of Object.keys(headers)) {
          if (/^(cookie|authorization)$/i.test(k)) delete headers[k];
        }
      }
      cur = await requestOnce(next, { ...opts, headers, method, body: method === 'GET' ? null : opts.body }, proxy);
      redirects++;
    }
    if (cur.status >= 200 && cur.status < 300) return cur;
    lastErr = new Error(`HTTP ${cur.status} ${urlStr}`);
    if (cur.status >= 400 && cur.status < 500) break;
  }
  throw lastErr || new Error(`request failed: ${urlStr}`);
}

async function getText(url, opts = {}) {
  // 登录 Cookie 只发给明确要求的请求；默认不带，避免误发给 GitHub 等第三方
  const headers = Object.assign({}, opts.headers || {});
  if (opts.cookie === true && !headers.Cookie) headers.Cookie = steamCookie();
  const res = await request(url, { ...opts, headers });
  return res.body.toString('utf8');
}

async function getBuffer(url, opts = {}) {
  const res = await request(url, opts);
  return res.body;
}

function formEncode(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

async function postForm(url, fields, opts = {}) {
  const body = Array.isArray(fields) ? fields.join('&') : formEncode(fields);
  const res = await request(url, {
    ...opts,
    method: 'POST',
    headers: Object.assign({
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json, text/plain, */*',
    }, opts.headers || {}),
    body,
  });
  return res.body.toString('utf8');
}

/** 只走指定代理做一次连通性测试（不自动回退直连） */
async function testProxy(raw, url = 'https://api.steampowered.com/ISteamWebAPIUtil/GetServerInfo/v1/', timeout = 10000) {
  const p = parseProxy(raw);
  if (!p) throw new Error('代理地址为空或格式不对，示例：http://127.0.0.1:7890');
  const t0 = Date.now();
  try {
    const res = await requestOnce(url, { timeout }, p);
    return { status: res.status, ms: Date.now() - t0 };
  } catch (e) {
    throw new Error(`代理不通或不是 HTTP 代理（${e.message}）：确认端口是 HTTP 代理，而不是 SOCKS`);
  }
}

module.exports = { request, getText, getBuffer, postForm, formEncode, parseProxy, testProxy, currentProxy, steamCookie, setLoginCookie, hasLoginCookie, UA, sleep };
