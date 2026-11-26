'use strict';
/**
 * 本地服务的入站校验工具。
 *
 * 1) Host 白名单：防 DNS rebinding。Origin==Host 的检查在 rebinding 下是失效的——
 *    攻击者把页面挂在 r.evil.com:3091，让这个域名解到 127.0.0.1，请求的 Host 和 Origin
 *    就完全一致了。但 rebinding 的 Host 永远是攻击者域名，所以只放行
 *    localhost / IP 字面量（127.0.0.1、[::1]、局域网 IP）就能直接杀掉这条路。
 * 2) 条目 id / 任务 id 数字校验：这些值会被拼进下载目录名（js-<id>），
 *    不校验就能用 "../evil" 把下载内容写到下载目录之外。
 * 3) 写请求 Content-Type 校验：text/plain 属于「简单请求」，浏览器不会预检，
 *    配上上面的 Host 检查才算完整。
 */
const net = require('net');

/** 从 Host 头里取出主机名（去掉端口和 IPv6 方括号） */
function hostNameOf(hostHeader) {
  const raw = String(hostHeader || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    return end > 0 ? raw.slice(1, end) : '';
  }
  // 只有「恰好一个冒号」时才是 host:port；裸 IPv6（a:b:c）本身就不是合法 Host
  const first = raw.indexOf(':');
  if (first > 0 && raw.indexOf(':') === first) return raw.slice(0, first);
  return raw;
}

/** 额外的允许主机名（反代/自定义域名的逃生口）：WE_MPKG_ALLOW_HOST=a.example.com,b.example.com */
function extraAllowedHosts() {
  return String(process.env.WE_MPKG_ALLOW_HOST || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Host 头是否可信：只接受 localhost、IPv4/IPv6 字面量，以及显式配置的域名。
 * @returns {{ok:boolean, host:string, reason:string}}
 */
function checkHost(hostHeader) {
  const host = hostNameOf(hostHeader);
  if (!host) return { ok: false, host, reason: '缺少 Host' };
  if (host === 'localhost') return { ok: true, host, reason: '' };
  if (net.isIP(host)) return { ok: true, host, reason: '' };
  if (extraAllowedHosts().includes(host)) return { ok: true, host, reason: '' };
  return { ok: false, host, reason: `不接受的主机名 ${host}（本机服务只允许 localhost / IP 字面量）` };
}

const ITEM_ID_RE = /^\d{1,20}$/;
const JOB_ID_RE = /^d\d{1,12}$/;

function isValidItemId(id) {
  return ITEM_ID_RE.test(String(id == null ? '' : id).trim());
}

/** 校验不通过就抛 400 级错误（server 层会把它变成 { error }） */
function assertItemId(id) {
  const v = String(id == null ? '' : id).trim();
  if (!isValidItemId(v)) {
    const err = new Error('条目 id 必须是纯数字');
    err.statusCode = 400;
    err.code = 'BAD_ITEM_ID';
    throw err;
  }
  return v;
}

function isValidJobId(id) {
  return JOB_ID_RE.test(String(id == null ? '' : id).trim());
}

function assertJobId(id) {
  const v = String(id == null ? '' : id).trim();
  if (!isValidJobId(v)) {
    const err = new Error('任务 id 不合法');
    err.statusCode = 400;
    err.code = 'BAD_JOB_ID';
    throw err;
  }
  return v;
}

/**
 * 写请求必须声明 application/json（空 body 的 POST 例外，比如 pause/resume）。
 * text/plain 这种「简单请求」不带预检，必须在服务端拦掉。
 */
function jsonBodyOk(req) {
  const m = String(req.method || '').toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return true;
  const len = Number(req.headers['content-length'] || 0);
  if (!len && req.headers['transfer-encoding'] !== 'chunked') return true;
  const ct = String(req.headers['content-type'] || '').toLowerCase();
  return ct.includes('application/json');
}

module.exports = {
  hostNameOf, checkHost, extraAllowedHosts,
  isValidItemId, assertItemId, isValidJobId, assertJobId, jsonBodyOk,
};
