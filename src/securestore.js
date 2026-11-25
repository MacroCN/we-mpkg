/**
 * 凭据落盘加密。
 *
 * - Windows：优先走 DPAPI（CurrentUser 范围）→ 换账号/换机器都解不开，也不怕备份被拷走。
 * - 其它平台（含安卓）：AES-256-GCM + 本机随机密钥（密钥文件 0600，存在 App 私有目录里）。
 * - 兼容旧版明文 JSON：读到没有加密头的老文件时照常解析，下次保存自动转成加密格式。
 *
 * 只用来存 refresh token / 登录 cookie 这类小对象，不是通用数据库。
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { config } = require('./config');

const MARK = '__we_mpkg_enc';
const KEY_FILE = path.join(config.CACHE_DIR, '.secret-key');
const PS = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

function canUseDpapi() {
  return process.platform === 'win32' && fs.existsSync(PS);
}

function dpapi(protect, buf) {
  const body = protect
    ? "$p=[System.Security.Cryptography.ProtectedData]::Protect($b,$null,'CurrentUser')"
    : "$p=[System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,'CurrentUser')";
  const script = `$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$b=[Convert]::FromBase64String($env:WEMPKDATA);${body};[Convert]::ToBase64String($p)`;
  const out = execFileSync(PS, ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: Object.assign({}, process.env, { WEMPKDATA: buf.toString('base64') }),
    windowsHide: true,
    timeout: 15000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const txt = String(out).trim();
  if (!txt) throw new Error('DPAPI 没有返回数据');
  return Buffer.from(txt, 'base64');
}

function localKey() {
  let raw = null;
  try {
    raw = fs.readFileSync(KEY_FILE);
  } catch (e) {
    if (e.code !== 'ENOENT') throw new Error(`读取本机密钥失败（${e.message}）`);
  }
  if (raw) {
    if (raw.length === 32) return raw;
    throw new Error(`本机密钥文件已损坏（${KEY_FILE}），为避免历史凭据全部失效，请先备份/删除它再重新登录`);
  }
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  const key = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, key, { mode: 0o600 });
  try { fs.chmodSync(KEY_FILE, 0o600); } catch { /* Windows 上尽力而为 */ }
  return key;
}

function aesSeal(buf) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', localKey(), iv);
  const data = Buffer.concat([cipher.update(buf), cipher.final()]);
  return { v: 1, kind: 'aes', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

function aesOpen(env) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', localKey(), Buffer.from(env.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(env.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(env.data, 'base64')), decipher.final()]);
}

/** 把对象加密写成文件 */
function writeJson(file, obj) {
  const plain = Buffer.from(JSON.stringify(obj), 'utf8');
  let env;
  if (canUseDpapi()) {
    try {
      env = { [MARK]: true, v: 1, kind: 'dpapi', data: dpapi(true, plain).toString('base64') };
    } catch { env = null; }
  }
  if (!env) env = Object.assign({ [MARK]: true }, aesSeal(plain));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(env));
  return true;
}

/** 读回对象；老明文文件也能读；解不开返回 null */
function readJson(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  let parsed;
  try { parsed = JSON.parse(text); } catch { return null; }
  if (!parsed || !parsed[MARK]) return parsed || null; // 旧版明文
  try {
    const buf = parsed.kind === 'dpapi' ? dpapi(false, Buffer.from(parsed.data, 'base64')) : aesOpen(parsed);
    const obj = JSON.parse(buf.toString('utf8'));
    return obj || null;
  } catch {
    return null;
  }
}

module.exports = { writeJson, readJson, canUseDpapi, KEY_FILE };
