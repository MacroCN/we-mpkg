'use strict';
/**
 * SteamCMD 封装：
 *  - 查找 / 自动安装 SteamCMD
 *  - 执行 workshop_download_item（匿名优先，可配置账号）
 *  - 解析 workshop_log.txt 给出可读的失败原因
 *
 * 关键命令（来自 Valve 官方 SteamCMD 文档）：
 *   steamcmd +force_install_dir <dir> +login anonymous \
 *            +workshop_download_item 431960 <publishedFileId> +quit
 * 下载结果落在 <dir>/steamapps/workshop/content/431960/<publishedFileId>/
 */
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { config, ensureDirs, tempDir } = require('./config');
const net = require('./net');

const ZIP_URLS = [
  'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip',
  'https://client-update.steamstatic.com/installer/steamcmd.zip',
];

function isWindows() {
  return process.platform === 'win32';
}

/**
 * SteamCMD 只有 Windows / Linux x86-64 / macOS 版本，没有 ARM 构建。
 * 安卓（nodejs-mobile 里 process.platform 为 'android'）、arm64 Linux、树莓派等都跑不了。
 */
function platformSupported() {
  if (isWindows()) return true;
  return process.platform === 'linux' && process.arch === 'x64';
}

function unsupportedMessage() {
  return [
    `当前平台 ${process.platform}/${process.arch} 无法运行 SteamCMD（官方只提供 Windows 与 Linux x86-64 版本）。`,
    '手机端请在启动页选择“远程模式”，填入电脑地址（电脑上执行 run.bat serve）；',
    '下载与打包都会在电脑完成，手机只负责界面。',
  ].join('\n');
}


/** 在常见位置查找 steamcmd */
function locateSteamCmd() {
  const bin = isWindows() ? 'steamcmd.exe' : 'steamcmd.sh';
  const candidates = [
    process.env.STEAMCMD_PATH || '',
    path.join(config.STEAMCMD_DIR, bin),
    isWindows() ? 'C:\\steamcmd\\steamcmd.exe' : '/usr/bin/steamcmd',
    isWindows() ? 'C:\\Program Files (x86)\\SteamCMD\\steamcmd.exe' : '/usr/games/steamcmd',
    isWindows() ? 'C:\\Program Files\\SteamCMD\\steamcmd.exe' : '/opt/steamcmd/steamcmd.sh',
  ].filter(Boolean);
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch { /* ignore */ }
  }
  try {
    const out = execFileSync(isWindows() ? 'where.exe' : 'which', [isWindows() ? 'steamcmd' : 'steamcmd'], {
      encoding: 'utf8', windowsHide: true,
    });
    const first = String(out).split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    if (first && fs.existsSync(first)) return first;
  } catch { /* ignore */ }
  return null;
}

/** 下载并解压 SteamCMD 到 ./steamcmd */
async function installSteamCmd(onLog = () => {}) {
  if (!platformSupported()) throw new Error(unsupportedMessage());
  ensureDirs();
  const dir = config.STEAMCMD_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const zipPath = path.join(dir, 'steamcmd.zip');
  let lastErr;
  let downloaded = false;
  for (const url of ZIP_URLS) {
    try {
      onLog(`下载 SteamCMD: ${url}`);
      const buf = await net.getBuffer(url, { timeout: 120000, retries: 1 });
      if (buf.length < 100 * 1024) throw new Error(`下载内容过小（${buf.length} 字节），可能是错误页`);
      fs.writeFileSync(zipPath, buf);
      downloaded = true;
      break;
    } catch (e) {
      lastErr = e;
      onLog(`  失败: ${e.message}`);
    }
  }
  if (!downloaded) throw new Error(`SteamCMD 下载失败: ${lastErr ? lastErr.message : '未知错误'}`);

  if (isWindows()) {
    // Windows 10+ 自带 tar.exe(bsdtar) 支持 zip；先试 PowerShell Expand-Archive
    try {
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${dir.replace(/'/g, "''")}' -Force`],
        { windowsHide: true, stdio: 'ignore' });
    } catch {
      execFileSync('tar.exe', ['-xf', zipPath, '-C', dir], { windowsHide: true, stdio: 'ignore' });
    }
  } else {
    execFileSync('tar', ['-zxf', zipPath, '-C', dir], { stdio: 'ignore' });
  }
  try { fs.unlinkSync(zipPath); } catch { /* ignore */ }

  const found = locateSteamCmd();
  if (!found) throw new Error('SteamCMD 解压后仍未找到可执行文件，请手动安装并设置 STEAMCMD_PATH');
  return found;
}

async function ensureSteamCmd(onLog = () => {}) {
  const found = locateSteamCmd();
  if (found) return found;
  onLog('未找到 SteamCMD，尝试自动下载安装...');
  return installSteamCmd(onLog);
}

/** 运行 steamcmd，逐行回传日志；interactive=true 时把终端交给 SteamCMD（可手输密码/Steam Guard） */
function runSteamCmd(bin, args, { timeoutMs = config.STEAMCMD_TIMEOUT_MS, onLog = () => {}, interactive = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd: path.dirname(bin),
      windowsHide: false,
      stdio: interactive ? 'inherit' : 'pipe',
      env: Object.assign({}, process.env, { SteamAppId: String(config.APP_ID) }),
    });
    let log = '';
    let killedByTimeout = false;
    const timer = setTimeout(() => {
      killedByTimeout = true;
      try { child.kill(); } catch { /* ignore */ }
    }, timeoutMs);

    const feed = (chunk) => {
      const text = chunk.toString();
      log += text;
      for (const line of text.split(/\r?\n/)) {
        const t = line.trim();
        if (t) onLog(t);
      }
    };
    if (!interactive) {
      child.stdout.on('data', feed);
      child.stderr.on('data', feed);
    }
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, log, error: e.message, killedByTimeout, interactive }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, log, killedByTimeout, interactive }); });
  });
}

/** 在 root 下递归查找 workshop 条目目录 */
function findItemDir(root, appId, id) {
  const expected = path.join(root, 'steamapps', 'workshop', 'content', String(appId), String(id));
  if (fs.existsSync(expected) && fs.statSync(expected).isDirectory()) return expected;
  const target = String(id);
  const queue = [root];
  while (queue.length) {
    const dir = queue.shift();
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      if (!e.isDirectory()) continue;
      const abs = path.join(dir, e.name);
      if (e.name === target) return abs;
      queue.push(abs);
    }
  }
  return null;
}

/** 从 workshop_log.txt 抽取本次下载的失败原因 */
function describeFailure(bin, appId, id) {
  const logFile = path.join(path.dirname(bin), 'logs', 'workshop_log.txt');
  if (!fs.existsSync(logFile)) return '';
  let text = '';
  try { text = fs.readFileSync(logFile, 'utf8'); } catch { return ''; }
  const rows = text.split(/\r?\n/);
  const from = rows.findLastIndex ? rows.findLastIndex((l) => l.includes(`Download item ${id} requested by app`))
    : (() => { for (let i = rows.length - 1; i >= 0; i--) if (rows[i].includes(`Download item ${id} requested by app`)) return i; return -1; })();
  if (from < 0) return '';
  const win = rows.slice(from, Math.min(rows.length, from + 40)).join('\n');
  if (/Missing decryption key/i.test(win)) {
    return '缺少 depot 解密密钥：当前账号（含匿名）没有该 App 的授权，需要登录一个拥有 Wallpaper Engine 的账号';
  }
  if (/No workshop depot defined/i.test(win)) {
    return '该 App 没有公开的工坊 depot，必须用拥有 Wallpaper Engine 的账号登录后下载';
  }
  if (/No subscription/i.test(win)) return '当前登录账号（含匿名）没有该 App 的订阅，需登录拥有 Wallpaper Engine 的账号';
  if (/Access Denied/i.test(win)) return 'Steam 返回 Access Denied（该条目限制下载 / 需要拥有者）';
  if (/No Connection/i.test(win)) return 'Steam CDN 连接失败（网络问题，可能需要代理）';
  if (/Timeout/i.test(win)) return '下载超时';
  if (/File Not Found/i.test(win)) return '条目文件不存在（可能已被作者删除/隐藏）';
  return '';
}

function fileCount(dir) {
  try { return fs.readdirSync(dir).length; } catch { return 0; }
}

/**
 * 下载单个创意工坊条目
 * @param {{id:string|number, appId?:number, account?:{user:string,pass:string}|null, onLog?:Function, timeoutMs?:number, keep?:boolean}} opts
 * @returns {Promise<{ok:boolean, dir?:string, root?:string, log:string, reason?:string, attempts:Array}>}
 */
async function downloadWorkshopItem(opts) {
  if (!platformSupported()) throw new Error(unsupportedMessage());
  const id = String(opts.id);
  const appId = opts.appId || config.APP_ID;
  const onLog = opts.onLog || (() => {});
  const account = opts.account && opts.account.user
    ? opts.account
    : (config.ACCOUNT_USER ? { user: config.ACCOUNT_USER, pass: config.ACCOUNT_PASS } : null);
  const bin = await ensureSteamCmd(onLog);
  const root = tempDir(`item-${id}`);
  if (/\s/.test(root)) {
    onLog(`⚠ 临时目录包含空格，旧版 SteamCMD 对含空格路径支持不佳：${root}`);
    onLog('  建议把整个项目放到无空格的路径（如 D:\\SteamCMD\\we-mpkg）。');
  }
  const attempts = [];
  let reason = '';

  // 交互登录：把终端交给 SteamCMD，手输密码 / Steam Guard 验证码
  if (opts.interactive) {
    if (!account) throw new Error('交互登录需要先给账号：--user <账号名>（密码可直接在 SteamCMD 窗口里输入）');
    onLog(`\n>>> 交互登录 ${account.user}：请在弹出的 SteamCMD 窗口里输入密码 / Steam Guard 验证码`);
    const args = [
      '+@ShutdownOnFailedCommand', '0',
      '+force_install_dir', root,
      '+login', account.user,
      ...(account.pass ? [account.pass] : []),
      '+workshop_download_item', String(appId), id,
      '+quit',
    ];
    const res = await runSteamCmd(bin, args, { timeoutMs: opts.timeoutMs, onLog, interactive: true });
    const dir = findItemDir(root, appId, id);
    const ok = !!(dir && fileCount(dir) > 0);
    attempts.push({ login: `交互 ${account.user}`, variant: 'normal', ok, code: res.code, killedByTimeout: res.killedByTimeout });
    if (ok) {
      onLog(`\n✔ 下载完成: ${dir}`);
      return { ok: true, dir, root, log: '', attempts, reason: '' };
    }
    return { ok: false, root, attempts, reason: describeFailure(bin, appId, id) || '交互下载未产出文件', log: '' };
  }

  const loginVariants = [];
  if (account && account.pass) loginVariants.push({ name: `账号 ${account.user}`, args: ['+login', account.user, account.pass] });
  loginVariants.push({ name: '匿名 anonymous', args: ['+login', 'anonymous'] });

  const itemVariants = [
    { name: '常规', extra: [] },
    { name: 'validate', extra: ['validate'] },
  ];

  for (const login of loginVariants) {
    for (const variant of itemVariants) {
      onLog(`\n>>> 尝试 ${login.name} / ${variant.name} 下载条目 ${id}`);
      const args = [
        '+@ShutdownOnFailedCommand', '1',
        '+@NoPromptForPassword', '1',
        '+force_install_dir', root,
        ...login.args,
        '+workshop_download_item', String(appId), id, ...variant.extra,
        '+quit',
      ];
      const res = await runSteamCmd(bin, args, { timeoutMs: opts.timeoutMs || config.STEAMCMD_TIMEOUT_MS, onLog });
      if (res.killedByTimeout) onLog('  SteamCMD 超时被终止');
      const dir = findItemDir(root, appId, id);
      const ok = !!(dir && fileCount(dir) > 0);
      attempts.push({ login: login.name, variant: variant.name, ok, code: res.code, elapsedTimeout: res.killedByTimeout });
      if (ok) {
        onLog(`\n✔ 下载完成: ${dir}`);
        return { ok: true, dir, root, log: res.log, attempts, reason: '' };
      }
      reason = describeFailure(bin, appId, id) || reason;
      onLog(`  ✘ 未产出文件${reason ? `（${reason}）` : ''}`);
    }
  }
  return { ok: false, root, attempts, reason, log: '' };
}
/** 清理下载临时根目录（打包完成后调用） */
function cleanupRoot(root) {
  if (!root) return;
  try {
    if (path.resolve(root).startsWith(path.resolve(config.CACHE_DIR))) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  } catch { /* ignore */ }
}

module.exports = { locateSteamCmd, installSteamCmd, ensureSteamCmd, runSteamCmd, downloadWorkshopItem, cleanupRoot, findItemDir, platformSupported };
