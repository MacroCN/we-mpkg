'use strict';
/**
 * CDN 分块下载用的「直连优先」Agent。
 *
 * Steam 的 CDN 请求由 steam-user 内部用 https.request 发出，不经过我们的 net.js；
 * 网络直连 CDN 偶发超时/被断，配置里又可能有系统代理。这里换掉进程的全局
 * http/https Agent：每个新连接先直连目标，DIRECT_TIMEOUT 内连不上（拒绝 / 超时 /
 * TLS 失败）再走 config.PROXY 的 CONNECT 隧道。直连通畅时完全不走代理。
 *
 * 只影响没显式传 agent 的请求（steam-user 的 CDN 下载、少量库内部请求）；
 * steam-session 登录、webcookie 等都自带显式 agent，不受影响。
 */
const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
const { URL } = require('url');
const { config } = require('./config');

const DIRECT_TIMEOUT = Math.max(1000, parseInt(process.env.WE_MPKG_DIRECT_TIMEOUT_MS || '5000', 10));

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

/** 设置页随时可能改代理，所以每个新连接都重新读一次 */
function currentProxy() {
  return parseProxy(config.PROXY);
}

/** 通过 HTTP 代理 CONNECT 出一条到 host:port 的原始 TCP 连接 */
function tunnelViaProxy(host, port, cb) {
  const p = currentProxy();
  if (!p) return cb(new Error('没有配置代理'));
  const headers = { Host: `${host}:${port}` };
  if (p.auth) headers['Proxy-Authorization'] = p.auth;
  const req = http.request({
    hostname: p.hostname,
    port: p.port,
    method: 'CONNECT',
    path: `${host}:${port}`,
    headers,
  });
  req.setTimeout(DIRECT_TIMEOUT, () => req.destroy(new Error('Proxy CONNECT timed out')));
  req.once('error', (e) => cb(e));
  req.once('connect', (res, socket) => {
    if (res.statusCode !== 200) {
      socket.destroy();
      return cb(new Error(`Proxy CONNECT ${res.statusCode}`));
    }
    cb(null, socket);
  });
  req.end();
}

class DirectFirstHttpsAgent extends https.Agent {
  createConnection(options, cb) {
    const host = options.host || options.hostname;
    const port = Number(options.port) || 443;
    let settled = false;
    let timer = null;
    const finish = (err, socket) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      cb(err, socket);
    };
    const direct = tls.connect({ ...options, host, port, servername: options.servername || host });
    const fallback = () => {
      if (settled) return;
      direct.destroy();
      if (!currentProxy()) return finish(new Error(`直连 ${host}:${port} 失败，且未配置代理`));
      tunnelViaProxy(host, port, (err, socket) => {
        if (err) return finish(err);
        const secure = tls.connect({ socket, servername: options.servername || host });
        secure.once('secureConnect', () => finish(null, secure));
        secure.once('error', (e) => { secure.destroy(); finish(e); });
      });
    };
    timer = setTimeout(() => {
      if (settled) return;
      fallback();
    }, DIRECT_TIMEOUT);
    direct.once('secureConnect', () => finish(null, direct));
    direct.once('error', () => fallback());
  }
}

class DirectFirstHttpAgent extends http.Agent {
  createConnection(options, cb) {
    const host = options.host || options.hostname;
    const port = Number(options.port) || 80;
    let settled = false;
    let timer = null;
    const finish = (err, socket) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      cb(err, socket);
    };
    const direct = net.connect({ ...options, host, port });
    const fallback = () => {
      if (settled) return;
      direct.destroy();
      if (!currentProxy()) return finish(new Error(`直连 ${host}:${port} 失败，且未配置代理`));
      tunnelViaProxy(host, port, finish);
    };
    timer = setTimeout(() => {
      if (settled) return;
      fallback();
    }, DIRECT_TIMEOUT);
    direct.once('connect', () => finish(null, direct));
    direct.once('error', () => fallback());
  }
}

let installed = false;

/** 接管全局 Agent：直连优先，连不上再用“当前设置里的代理”（没代理时就只直连） */
function installDirectFirstAgents() {
  if (installed) return false;
  http.globalAgent = new DirectFirstHttpAgent({ keepAlive: true });
  https.globalAgent = new DirectFirstHttpsAgent({ keepAlive: true });
  installed = true;
  return true;
}

module.exports = { installDirectFirstAgents, parseProxy, currentProxy, DIRECT_TIMEOUT };
