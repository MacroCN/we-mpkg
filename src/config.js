'use strict';
/**
 * 全局配置：常量、目录、代理、账号。
 * 所有可调项都可以用环境变量覆盖，方便在不同网络环境下跑。
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

/** Wallpaper Engine 的 Steam AppID（桌面版）。创意工坊内容都挂在它下面。 */
const APP_ID = 431960;

/** PKG / MPKG 容器魔数 */
const MAGIC_PC = 'PKGV0024';
const MAGIC_MOBILE = 'PKGM0020';

function env(...names) {
  for (const n of names) {
    const v = process.env[n];
    if (v && String(v).trim()) return String(v).trim();
  }
  return '';
}

/** 读取 Windows 系统代理（注册表 ProxyEnable=1 时生效），其它平台返回 null */
function readWindowsSystemProxy() {
  if (process.platform !== 'win32') return null;
  try {
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
    const q = (name) => execFileSync('reg.exe', ['query', key, '/v', name], { encoding: 'utf8', windowsHide: true });
    const enableOut = q('ProxyEnable');
    if (!/\b0x1\b/i.test(enableOut)) return null;
    const serverOut = q('ProxyServer');
    const m = serverOut.match(/ProxyServer\s+REG_\w+\s+([^\r\n]+)/i);
    if (!m) return null;
    // 形如 "127.0.0.1:7890" 或 "http=127.0.0.1:7890;https=..."
    const raw = m[1].trim();
    const seg = raw.split(';').map((s) => s.trim()).filter(Boolean);
    const pick = seg.find((s) => /^https=/i.test(s)) || seg.find((s) => /^http=/i.test(s)) || raw;
    const value = pick.replace(/^(https?)=/i, '');
    return /^\w+:\/\//.test(value) ? value : `http://${value}`;
  } catch {
    return null;
  }
}

const DEFAULT_PROXY = env('WE_MPKG_PROXY', 'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy')
  || readWindowsSystemProxy()
  || '';

/**
 * 安卓端的默认输出目录：内置存储的 Download/mpkg。
 * 没拿到「所有文件访问」权限时写不进去，那就退回应用私有目录（网页里可以再改）。
 */
function androidDefaultOutput() {
  if (process.platform !== 'android') return null;
  const p = '/storage/emulated/0/Download/mpkg';
  try {
    fs.mkdirSync(p, { recursive: true });
    fs.accessSync(p, fs.constants.W_OK);
    return p;
  } catch {
    return null;
  }
}

const DEFAULT_OUTPUT_DIR = androidDefaultOutput() || path.join(ROOT, 'output');

const config = {
  APP_ID,
  MAGIC_PC,
  MAGIC_MOBILE,
  ROOT,
  CACHE_DIR: path.join(ROOT, '.cache'),
  // 下载缓存目录。安卓端由外壳（NodeRunner）在启动前写进 settings.json，
  // 指到外置储存的应用专属目录，避免把几 GB 的原始素材堆在应用私有空间里。
  DOWNLOAD_DIR: env('WE_MPKG_DOWNLOAD_DIR') || path.join(ROOT, 'downloads'),
  OUTPUT_DIR: DEFAULT_OUTPUT_DIR,
  LOG_DIR: path.join(ROOT, 'logs'),
  PUBLIC_DIR: path.join(ROOT, 'public'),
  PROXY: DEFAULT_PROXY,
  PROXY_DEFAULT: DEFAULT_PROXY,
  /** 可选：Steam Web API key，用于 IPublishedFileService/QueryFiles 检索 */
  API_KEY: env('STEAM_API_KEY'),
  /** 语言/地区 Cookie 偏好，影响 steamcommunity 返回的语言 */
  LANG: env('STEAM_LANG') || 'schinese',
  COUNTRY: env('STEAM_COUNTRY') || '',
  PORT: parseInt(env('PORT') || '3090', 10),
  /** 网页服务默认只允许本机访问；需要局域网访问时必须同时设置 WE_MPKG_TOKEN */
  LISTEN_HOST: env('WE_MPKG_HOST') || '127.0.0.1',
  /** 远程访问令牌：非回环地址的请求必须携带，防止局域网裸奔 */
  REMOTE_TOKEN: env('WE_MPKG_TOKEN'),
  /** 国内网络下有时原生 TLS 会握手失败，自动改用 curl.exe 兜底 */
  USE_CURL_FALLBACK: env('WE_MPKG_NO_CURL') !== '1' && process.platform === 'win32' && !!findCurl(),
  /** curl 可执行文件绝对路径（PATH 不可靠时也能用） */
  CURL_BIN: findCurl(),
};

/** 找出可用的 curl 可执行文件（PATH 里没有时退到 System32） */
function findCurl() {
  const sys = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  const candidates = [
    'curl.exe',
    path.join(sys, 'System32', 'curl.exe'),
    path.join(sys, 'Sysnative', 'curl.exe'),
  ];
  for (const c of candidates) {
    try {
      execFileSync(c, ['--version'], { stdio: 'ignore', windowsHide: true });
      return c;
    } catch { /* 试下一个 */ }
  }
  return null;
}

const CURL_BIN = findCurl();

// ---------------- 用户设置（下载/输出目录） ----------------
const SETTINGS_FILE = path.join(config.CACHE_DIR, 'settings.json');

function readSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) || {}; } catch { return {}; }
}

function writeSettings(patch) {
  try {
    fs.mkdirSync(config.CACHE_DIR, { recursive: true });
    const next = Object.assign(readSettings(), patch);
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2));
    return next;
  } catch {
    return null;
  }
}

/** 校验并切换输出目录（必须是可写目录），返回绝对路径 */
function setOutputDir(dir) {
  const raw = String(dir || '').trim();
  if (!raw) throw new Error('目录不能为空');
  const abs = path.resolve(raw);
  fs.mkdirSync(abs, { recursive: true });
  fs.accessSync(abs, fs.constants.W_OK); // 不可写会抛错
  config.OUTPUT_DIR = abs;
  writeSettings({ outputDir: abs });
  return abs;
}

/** 规范化代理字符串；空串表示“跟随系统/环境变量”，非法抛错 */
function normalizeProxy(raw) {
  const v = String(raw || '').trim();
  if (!v) return '';
  const withScheme = /^\w+:\/\//.test(v) ? v : `http://${v}`;
  let u;
  try { u = new URL(withScheme); } catch { throw new Error('代理格式不对，示例：http://127.0.0.1:7890'); }
  if (!u.hostname) throw new Error('代理格式不对，示例：http://127.0.0.1:7890');
  if (!/^http:\/\//i.test(withScheme)) throw new Error('只支持 http:// 代理，例如 http://127.0.0.1:7890');
  return withScheme;
}

/** 保存并立即生效；传空串则回退到系统/环境变量里的代理 */
function setProxy(raw) {
  const v = normalizeProxy(raw);
  config.PROXY = v || config.PROXY_DEFAULT;
  writeSettings({ proxy: v });
  return config.PROXY;
}

/** 启动时应用已保存的目录与代理（失效就忽略，回退默认） */
try {
  const saved = readSettings();
  if (saved.outputDir) {
    const abs = path.resolve(saved.outputDir);
    fs.accessSync(abs, fs.constants.W_OK);
    config.OUTPUT_DIR = abs;
  }
  if (saved.proxy) config.PROXY = normalizeProxy(saved.proxy);
} catch { /* 目录已不存在/不可写、代理失效 → 用默认 */ }

// 下载缓存目录同样可以由 settings.json 指定（安卓外壳用它把缓存放到外置储存）
if (!env('WE_MPKG_DOWNLOAD_DIR')) {
  try {
    const savedDown = readSettings();
    if (savedDown.downloadDir) {
      const abs = path.resolve(savedDown.downloadDir);
      fs.mkdirSync(abs, { recursive: true });
      fs.accessSync(abs, fs.constants.W_OK);
      config.DOWNLOAD_DIR = abs;
    }
  } catch { /* 外置储存没挂载/不可写 → 用默认 */ }
}

/** 下载任务结束后是否保留原始缓存（调试用 WE_MPKG_KEEP_DOWNLOAD=1） */
config.KEEP_DOWNLOAD = env('WE_MPKG_KEEP_DOWNLOAD') === '1';

/** 确保运行期目录存在 */
function ensureDirs() {
  for (const d of [config.CACHE_DIR, config.DOWNLOAD_DIR, config.OUTPUT_DIR, config.LOG_DIR]) {
    try { fs.mkdirSync(d, { recursive: true }); } catch { /* ignore */ }
  }
}

/** 生成一个本次运行专用的临时目录 */
function tempDir(prefix = 'run') {
  ensureDirs();
  const dir = path.join(config.CACHE_DIR, `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = { config, ensureDirs, tempDir, env, os, setOutputDir, setProxy, normalizeProxy, readSettings, writeSettings, SETTINGS_FILE, DEFAULT_OUTPUT_DIR, DEFAULT_PROXY };
