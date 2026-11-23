'use strict';
/**
 * 一条下载任务的实际执行：下载 → 手机端适配打包 → 清理缓存。
 * 只做业务，不管队列与状态 —— 队列/并发/持久化在 dlhub.js。
 */
const fs = require('fs');
const path = require('path');
const configMod = require('./config');
const { config } = configMod;
const steamcmd = require('./steamcmd');
const packer = require('./pack');

/** 取消信号：由调用方在阶段边界检查 */
class CancelledError extends Error {
  constructor(msg = '任务已取消') {
    super(msg);
    this.name = 'CancelledError';
    this.cancelled = true;
  }
}

/** 当前平台能用的下载引擎：steamcmd（x86）→ steamjs（纯 JS，需登录凭据） */
function activeEngine() {
  const forced = String(process.env.WE_MPKG_ENGINE || '').toLowerCase();
  const hasToken = () => {
    try {
      const t = require('./steamjs').readToken();
      return !!(t && t.refreshToken);
    } catch { return false; }
  };
  if (forced === 'steamcmd') return steamcmd.platformSupported() ? 'steamcmd' : 'steamjs';
  if (forced === 'steamjs') return 'steamjs';
  if (hasToken()) return 'steamjs';
  if (steamcmd.platformSupported()) return 'steamcmd';
  return 'steamjs';
}

function noLoginMessage() {
  return '还没有登录 Steam：请点右上角 ⚙ 填账号密码登录，或导入 Steam 凭据（get-token.bat 得到的那段 Base64）';
}

/**
 * 整个进程共用一条 Steam 连接。
 * Steam 不允许同一个 refresh token 同时建两条 CM 会话（第二条取 manifest 会 403），
 * 而分块下载本身是并发的，所以多条任务共用一个 client 既安全又不浪费带宽。
 */
let sharedClient = null;
let sharedClientPending = null;

function resetSharedClient() {
  const c = sharedClient;
  sharedClient = null;
  sharedClientPending = null;
  if (c) { try { c.logOff(); } catch { /* ignore */ } }
}

async function getSharedClient(onLog) {
  if (sharedClient) return sharedClient;
  if (!sharedClientPending) {
    const steamjs = require('./steamjs');
    const token = steamjs.readToken();
    if (!token || !token.refreshToken) throw new Error(noLoginMessage());
    sharedClientPending = steamjs.connect(token.refreshToken, { onLog })
      .then((c) => {
        c.on('error', () => { if (sharedClient === c) sharedClient = null; });
        c.on('disconnected', () => { if (sharedClient === c) sharedClient = null; });
        sharedClient = c;
        return c;
      })
      .catch((e) => { sharedClientPending = null; throw e; });
  }
  return sharedClientPending;
}

async function downloadWithEngine(itemId, opts = {}) {
  const onLog = opts.onLog || (() => {});
  const onProgress = opts.onProgress || (() => {});
  const engine = activeEngine();
  if (!engine) throw new Error(noLoginMessage());
  onLog(`[engine] ${engine}`);
  if (engine === 'steamjs') {
    const steamjs = require('./steamjs');
    const token = steamjs.readToken();
    if (!token || !token.refreshToken) throw new Error(noLoginMessage());
    const outDir = path.join(config.DOWNLOAD_DIR, `js-${itemId}`);
    const client = await getSharedClient(onLog);
    try {
      const r = await steamjs.downloadItem({ id: itemId, outDir, refreshToken: token.refreshToken, client, onLog, onProgress });
      return { ok: true, dir: r.dir };
    } catch (e) {
      // 连接被 Steam 踢掉/过期时，下次重试用新连接
      if (/403|HTTP error|Not Logged On|not logged on|disconnected/i.test(e.message || '')) resetSharedClient();
      throw e;
    }
  }
  return steamcmd.downloadWorkshopItem({ id: itemId, onLog });
}

/**
 * 删除下载缓存目录，但只在 config.DOWNLOAD_DIR 之内动手：
 * 传进来的目录若是其它地方（比如 Steam 自己的 steamapps），一律不碰。
 */
function purgeDownloadDir(dir, onLog) {
  if (!dir) return null;
  if (config.KEEP_DOWNLOAD) {
    if (onLog) onLog(`下载缓存保留（WE_MPKG_KEEP_DOWNLOAD=1）: ${dir}`);
    return null;
  }
  try {
    const base = path.resolve(config.DOWNLOAD_DIR);
    const abs = path.resolve(dir);
    const rel = path.relative(base, abs);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
    fs.rmSync(abs, { recursive: true, force: true });
    if (onLog) onLog(`✔ 已清理下载缓存: ${abs}`);
    return abs;
  } catch (e) {
    if (onLog) onLog(`⚠ 清理下载缓存失败: ${e.message}`);
    return null;
  }
}

/**
 * 执行一条任务。
 * @param {{itemId:string,title:string,raw:boolean,reference?:string,preset?:string,
 *          preserveAudio?:boolean,videoMagic?:string}} job
 * @param {{onLog?:Function,onProgress?:Function,isCancelled?:Function}} hooks
 */
async function runJob(job, hooks = {}) {
  const onLog = hooks.onLog || (() => {});
  const onProgress = hooks.onProgress || (() => {});
  const cancelled = () => !!(hooks.isCancelled && hooks.isCancelled());
  const checkpoint = () => { if (cancelled()) throw new CancelledError(); };

  const itemId = String(job.itemId);
  onLog(`开始处理条目 ${itemId}`);

  // 下载阶段：0-100% 由字节数推进（下载器逐文件汇总）
  const dl = await downloadWithEngine(itemId, {
    onLog,
    onProgress: (p) => {
      onProgress({
        phase: 'download',
        percent: p.totalSizeBytes ? Math.min(99, Math.floor((p.bytesDownloaded / p.totalSizeBytes) * 100)) : null,
        bytes: p.bytesDownloaded,
        total: p.totalSizeBytes,
        currentFile: p.currentFile,
        detail: p.currentFile ? `下载 ${p.currentFile}` : '下载中',
      });
    },
  });
  if (!dl.ok) throw new Error(dl.reason || '下载失败（匿名与账号尝试均未产出文件）');
  checkpoint();

  const dlDir = dl.dir || null;

  if (job.raw) {
    let files = [];
    try { files = packer.analyze(dl.dir).files || []; } catch { /* ignore */ }
    onProgress({ phase: 'done', percent: 100, detail: '已下载（未打包）' });
    onLog(`✔ 已下载到: ${dl.dir}（未打包）`);
    return { result: { rawDir: dl.dir, raw: true, files }, dlDir };
  }

  let reference = job.reference || null;
  if (!reference) {
    const refGuess = path.join(config.ROOT, 'refs', `${itemId}.mpkg`);
    if (fs.existsSync(refGuess)) {
      reference = refGuess;
      onLog(`发现参考 mpkg: ${refGuess}`);
    }
  }
  checkpoint();
  const res = await packer.packFromItemDir(dl.dir, {
    id: itemId,
    title: job.title,
    reference,
    preset: job.preset,
    preserveAudio: job.preserveAudio,
    videoMagic: job.videoMagic,
    onLog,
    onProgress: (p) => onProgress(Object.assign({ phase: p.phase }, p)),
  });
  checkpoint();
  onLog('全部完成');
  purgeDownloadDir(dlDir, onLog);
  return { result: res, dlDir: null };
}

module.exports = {
  CancelledError, activeEngine, noLoginMessage, downloadWithEngine, purgeDownloadDir, runJob,
  getSharedClient, resetSharedClient,
};
