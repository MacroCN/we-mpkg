'use strict';
/**
 * 下载中心（独立进程）
 *
 * 为什么单独一个进程：网页一关、主界面一退，下载/打包不能跟着断。
 *   - 桌面端：由主服务按需 spawn 一个 detached 子进程，拥有自己的 HTTP 端口与页面；
 *   - 安卓端（nodejs-mobile 不能多进程）：同一个模块在主进程内起服务，
 *     页面关掉不影响任务，只有 App 被系统杀掉才会中断。
 *
 * 并发：最多同时跑 3 条任务（其余排队），队列与进度落盘，进程重启后自动接着排队。
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { URL } = require('url');
const { spawn } = require('child_process');

const configMod = require('./config');
const { config, ensureDirs } = configMod;
const guard = require('./guard');

const DEFAULT_PORT = parseInt(String(process.env.WE_MPKG_DLHUB_PORT || '').trim() || '3091', 10);
const MAX_CONCURRENT = 3;

// ---------------- 文件位置 ----------------

function stateFile() {
  return path.join(config.CACHE_DIR, 'dlhub-state.json');
}
function infoFile() {
  return path.join(config.CACHE_DIR, 'dlhub.json');
}

function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

function readJsonSafe(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return v && typeof v === 'object' ? v : null;
  } catch { return null; }
}

// ---------------- 队列 ----------------

const KEEP_HISTORY = 20;
const JOB_PARAMS = ['itemId', 'title', 'raw', 'preset', 'preserveAudio', 'videoMagic', 'reference', 'mode'];

function defaultProgress() {
  return { phase: 'queued', percent: null, detail: '排队中', bytes: 0, total: 0, speed: 0, eta: null };
}

/**
 * 创建队列（不涉及 HTTP，方便单测）。
 * @param {{maxConcurrent?:number, runner?:Function, file?:string, logger?:Function}} opts
 */
function createHub(opts = {}) {
  const maxConcurrent = Math.max(1, Math.min(MAX_CONCURRENT, Number(opts.maxConcurrent) || MAX_CONCURRENT));
  const runner = opts.runner || require('./packjob').runJob;
  const file = opts.file || stateFile();
  const logger = opts.logger || (() => {});
  const jobs = new Map();
  let seq = 0;
  let running = 0;
  let persistTimer = null;
  let stopped = false;
  let lastGcAt = 0;

  // ---- 持久化（节流写盘，进程退出前 flush）----
  function serializeJob(j) {
    return {
      id: j.id, itemId: j.itemId, title: j.title,
      raw: !!j.raw, preset: j.preset, preserveAudio: !!j.preserveAudio,
      mode: j.mode || null,
      videoMagic: j.videoMagic, engine: j.engine || null, reference: j.reference || null,
      state: j.state, progress: j.progress, error: j.error,
      result: j.result ? {
        outFile: j.result.outFile, size: j.result.size, type: j.result.type,
        magic: j.result.magic, entryCount: j.result.entryCount,
        preset: j.result.preset, tex: j.result.tex, shader: j.result.shader,
        audio: j.result.audio, warnings: j.result.warnings,
        rawDir: j.result.rawDir, raw: !!j.result.raw,
        files: j.result.raw ? (j.result.files || []).length : undefined,
        webExport: !!j.result.webExport, mode: j.result.mode || null,
        rawExport: !!j.result.rawExport, unpacked: j.result.unpacked,
        entry: j.result.entry, htmlCount: j.result.htmlCount,
      } : null,
      createdAt: j.createdAt, startedAt: j.startedAt, finishedAt: j.finishedAt,
      log: j.log.slice(-400),
    };
  }

  function persistNow() {
    try {
      writeJsonAtomic(file, { version: 2, savedAt: new Date().toISOString(), maxConcurrent, jobs: [...jobs.values()].filter((j) => !j.hidden).map(serializeJob) });
    } catch (e) {
      logger(`⚠ 队列写盘失败: ${e.message}`);
    }
    notifySse();
  }

  // ---- SSE：只有真的有订阅者时才建定时器，没人看就完全不推 ----
  const sseSubs = new Set();
  let sseTimer = null;

  function snapshot() {
    return { maxConcurrent, running, jobs: list().map((j) => view(j, { logs: true })) };
  }

  function sseFlush() {
    if (!sseSubs.size) return;
    let payload;
    try { payload = `data: ${JSON.stringify(snapshot())}\n\n`; } catch { return; }
    for (const res of sseSubs) {
      try {
        // 客户端已经断开（EPIPE）就顺手摘掉，别一直往上写
        if (res.writableEnded || res.destroyed) { sseSubs.delete(res); continue; }
        res.write(payload);
      } catch {
        sseSubs.delete(res);
      }
    }
  }

  /** 节流推送：进度变化很密，400ms 一次足够；有任务在跑就持续推，跑完自然停 */
  function notifySse() {
    if (stopped || !sseSubs.size) return;
    if (sseTimer) return;
    sseTimer = setTimeout(() => {
      sseTimer = null;
      sseFlush();
      if (running && sseSubs.size) notifySse();
    }, 400);
    if (sseTimer.unref) sseTimer.unref();
  }

  function subscribe(res) {
    sseSubs.add(res);
    notifySse();
  }

  function unsubscribe(res) {
    sseSubs.delete(res);
  }

  function persist() {
    if (stopped) return;
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      persistNow();
    }, 600);
    if (persistTimer.unref) persistTimer.unref();
  }

  function load() {
    const st = readJsonSafe(file);
    if (!st || !Array.isArray(st.jobs)) return;
    for (const raw of st.jobs) {
      if (!raw || !raw.id || !raw.itemId) continue;
      const job = {
        id: raw.id, itemId: String(raw.itemId), title: raw.title || `wallpaper_${raw.itemId}`,
        raw: !!raw.raw, preset: raw.preset || 'high', preserveAudio: !!raw.preserveAudio,
        mode: raw.mode || null,
        videoMagic: raw.videoMagic || '0020', engine: raw.engine || null, reference: raw.reference || null,
        state: raw.state === 'downloading' || raw.state === 'packing' ? 'queued' : (raw.state || 'queued'),
        progress: defaultProgress(), error: raw.error || null, result: raw.result || null,
        log: Array.isArray(raw.log) ? raw.log.slice(-400) : [],
        createdAt: raw.createdAt || Date.now(), startedAt: raw.startedAt || null,
        finishedAt: raw.finishedAt || null, cancelRequested: false, paused: false, hidden: false,
      };
      if (raw.state === 'downloading' || raw.state === 'packing') {
        job.log.push('上次进程中断，已重新排队（下载支持按块续传）');
        job.progress = { phase: 'queued', percent: null, detail: '上次中断，重新排队', bytes: 0, total: 0, speed: 0, eta: null };
      }
      if (job.state === 'done' || job.state === 'failed' || job.state === 'cancelled') {
        job.progress = raw.progress || job.progress;
      }
      jobs.set(job.id, job);
      const n = parseInt(String(job.id).replace(/^d/, ''), 10);
      if (Number.isFinite(n) && n > seq) seq = n;
    }
  }

  function pruneHistory() {
    const finished = [...jobs.values()].filter((j) => !j.hidden
      && (j.state === 'done' || j.state === 'failed' || j.state === 'cancelled'));
    if (finished.length <= KEEP_HISTORY) return;
    finished.sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
    for (const j of finished.slice(KEEP_HISTORY)) jobs.delete(j.id);
  }

  function pushLog(job, line) {
    if (!line) return;
    job.log.push(String(line));
    if (job.log.length > 800) job.log.splice(0, job.log.length - 800);
  }

  // ---- 进度：下载按字节算百分比，转换按已完成/总数算，其余阶段为不确定态 ----
  function makeProgressTracker(job) {
    let lastBytes = 0;
    let lastTime = 0;
    let speed = 0;
    let lastPhase = '';
    return (p) => {
      if (!p || typeof p !== 'object') return;
      const now = Date.now();
      const phase = p.phase === 'download' ? 'download' : (p.phase === 'done' ? 'done' : 'packing');
      if (phase !== lastPhase) {
        lastPhase = phase;
        if (phase === 'download') pushLog(job, '开始下载');
        if (phase === 'packing') pushLog(job, '开始打包（纹理 / 着色器适配）');
      }
      const bytes = Number(p.bytes) || 0;
      const total = Number(p.total) || 0;
      if (phase === 'download' && lastTime && bytes >= lastBytes) {
        const dt = (now - lastTime) / 1000;
        if (dt >= 0.4) {
          const inst = (bytes - lastBytes) / dt;
          speed = speed ? speed * 0.6 + inst * 0.4 : inst; // 平滑，避免跳字
        }
      } else if (phase === 'download' && !lastTime) {
        speed = 0;
      }
      lastBytes = bytes;
      lastTime = now;
      let percent = null;
      if (typeof p.percent === 'number' && Number.isFinite(p.percent)) percent = Math.max(0, Math.min(100, Math.round(p.percent)));
      else if (Number(p.total) > 0 && Number(p.done) >= 0) percent = Math.max(0, Math.min(100, Math.round((Number(p.done) / Number(p.total)) * 100)));
      const eta = speed > 1024 && total > bytes ? Math.round((total - bytes) / speed) : null;
      job.progress = {
        phase: p.phase || job.progress.phase,
        percent,
        detail: p.detail || job.progress.detail,
        bytes,
        total,
        speed: Math.round(speed),
        eta,
        updatedAt: now,
      };
      job.progressAt = now;
      notifySse(); // 有 SSE 订阅者时按 400ms 节流推进度，没有订阅者时什么都不做
    };
  }

  function noLoginHint(err) {
    return /还没有登录/.test(err.message || '') ? '（先登录 Steam 再重试）' : '';
  }

  async function run(job) {
    running++;
    job.state = 'downloading';
    job.startedAt = job.startedAt || Date.now();
    job.error = null;
    const onProgress = makeProgressTracker(job);
    try {
      const { result } = await runner(job, {
        onLog: (l) => pushLog(job, l),
        onProgress,
        isCancelled: () => !!job.cancelRequested,
        isPaused: () => !!job.paused,
      });
      job.result = result;
      if (job.cancelRequested) {
        job.state = 'cancelled';
        pushLog(job, '任务在阶段边界被取消（成品若已生成会保留）');
      } else {
        job.state = 'done';
        job.progress = { phase: 'done', percent: 100, detail: '完成', bytes: job.progress.total || 0, total: job.progress.total || 0, speed: 0, eta: 0, updatedAt: Date.now() };
      }
    } catch (e) {
      job.error = e && e.message ? e.message : String(e);
      job.state = e && e.cancelled ? 'cancelled' : 'failed';
      pushLog(job, `✘ ${job.error}${noLoginHint({ message: job.error })}`);
    } finally {
      job.paused = false; // 无论完成/失败/取消都不该再把「已暂停」留在卡片上
      job.finishedAt = Date.now();
      running--;
      // 「移除」运行中任务时记录先隐藏，等这里真的停下来再从队列里彻底删掉，
      // 避免下载器还在写目录、记录却已经没了（同条目立刻重下会互相踩文件）
      if (job.hidden) jobs.delete(job.id);
      pruneHistory();
      persist();
      // 每个任务结束后顺手治理一次缓存/日志，但最多一小时一次（扫描目录别太勤）
      if (Date.now() - lastGcAt > 3600 * 1000) {
        lastGcAt = Date.now();
        setImmediate(() => {
          try { require('./cachegc').run({ cacheDir: config.CACHE_DIR, logDir: config.LOG_DIR, logger }); } catch { /* 治理失败不影响任务 */ }
        });
      }
      setImmediate(tick);
    }
  }

  function tick() {
    if (stopped) return;
    while (running < maxConcurrent) {
      const next = [...jobs.values()]
        .filter((j) => j.state === 'queued' && !j.cancelRequested)
        .sort((a, b) => a.createdAt - b.createdAt)[0];
      if (!next) return;
      next.progress = { phase: 'download', percent: 0, detail: '准备下载', bytes: 0, total: 0, speed: 0, eta: null };
      run(next); // 不 await：并发由 running 计数控制
    }
  }

  function add(req = {}) {
    if (!req.id) throw new Error('缺少 id');
    // 这个值会拼成 downloads/js-<id>，必须纯数字（防 "../evil" 写到下载目录之外）
    const itemId = guard.assertItemId(req.id);
    const job = {
      id: `d${++seq}`,
      itemId,
      title: String(req.title || `wallpaper_${itemId}`),
      raw: !!req.raw,
      mode: req.mode === 'web' ? 'web' : null,
      preset: typeof req.preset === 'string' && req.preset ? req.preset : 'high',
      preserveAudio: !!req.preserveAudio,
      videoMagic: typeof req.videoMagic === 'string' ? req.videoMagic : '0020',
      engine: req.engine || null,
      reference: req.reference || null,
      state: 'queued',
      progress: defaultProgress(),
      error: null,
      result: null,
      log: [`已加入下载中心（并发上限 ${maxConcurrent}）`],
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      cancelRequested: false,
      paused: false,
      hidden: false,
    };
    for (const k of JOB_PARAMS) if (job[k] === undefined) job[k] = req[k];
    // 同一个条目同时只允许一条任务：两条同时写 downloads/js-<id> 会互相截断文件、
    // 互相删目录（尤其是「移除运行中任务后马上重新下载」这种操作）
    const busy = [...jobs.values()].find((j) => j.itemId === itemId
      && (j.hidden || j.state === 'queued' || j.state === 'downloading'));
    if (busy) {
      const err = new Error(`该条目已有任务在跑（${busy.id}，${busy.hidden ? '正在停止' : busy.state}），请等它结束再下`);
      err.code = 'ITEM_BUSY';
      throw err;
    }
    jobs.set(job.id, job);
    persistNow();
    setImmediate(tick);
    return job;
  }

  function get(id) {
    return jobs.get(String(id)) || null;
  }

  function list() {
    // 被「移除」的运行中任务是 hidden：立刻从界面/列表里消失，等它真停下来再从 Map 删
    return [...jobs.values()].filter((j) => !j.hidden).sort((a, b) => b.createdAt - a.createdAt);
  }

  function cancel(id) {
    const job = get(id);
    if (!job) return false;
    if (job.state === 'done' || job.state === 'failed' || job.state === 'cancelled') return false;
    job.cancelRequested = true;
    job.paused = false; // 暂停中的任务也要能被取消（否则分块循环还停在暂停等待里）
    if (job.state === 'queued') {
      job.state = 'cancelled';
      job.finishedAt = Date.now();
      job.progress = { phase: 'cancelled', percent: null, detail: '已取消', bytes: 0, total: 0, speed: 0, eta: null };
      pushLog(job, '已取消（排队中）');
      persistNow();
    } else {
      pushLog(job, '已请求取消，将在当前阶段边界停止');
      persist();
    }
    return true;
  }

  function retry(id) {
    const job = get(id);
    if (!job) return null;
    if (job.state === 'queued' || job.state === 'downloading' || job.state === 'packing') return job;
    job.state = 'queued';
    job.error = null;
    job.result = null;
    job.cancelRequested = false;
    job.paused = false; // 暂停中失败的任务重试时不能带着暂停标记，否则一进下载就卡住等「继续」
    job.startedAt = null;
    job.finishedAt = null;
    job.progress = defaultProgress();
    pushLog(job, `重新排队（第 ${job.attempts = (job.attempts || 0) + 1} 次重试）`);
    persistNow();
    setImmediate(tick);
    return job;
  }

  /** 暂停：只对正在下载的任务有效；已下的分块和断点记录都保留 */
  function pause(id) {
    const job = get(id);
    if (!job) return false;
    if (job.state !== 'downloading' || job.cancelRequested || job.hidden) return false;
    // 暂停只对 steamjs 生效；历史记录里可能还有旧版 steamcmd 引擎的任务，那些不支持暂停
    if (job.engine && job.engine !== 'steamjs') return false;
    // 打包阶段是 CPU 活儿，没有可暂停的下载循环，按钮不该在这个阶段出现
    if (job.progress && job.progress.phase && job.progress.phase !== 'download') return false;
    if (job.paused) return true;
    job.paused = true;
    pushLog(job, '已暂停（已下的分块保留，点「继续」接着下）');
    persistNow();
    return true;
  }

  /** 继续：把暂停中的任务放回下载循环 */
  function resume(id) {
    const job = get(id);
    if (!job || !job.paused) return false;
    job.paused = false;
    pushLog(job, '继续下载');
    persistNow();
    return true;
  }

  /**
   * 从列表移除。
   * 已完成/失败/取消 → 直接删记录；
   * 排队中/下载中/打包中 → 发取消信号 + 标 hidden（立刻从列表消失），
   * 等 runner 真正退出后由 run() 的 finally 删掉记录。
   * 这样「移除」点一下卡片就没了，同时不会出现「记录已删、下载还在写目录」的竞态。
   */
  function forget(id) {
    const job = get(id);
    if (!job) return false;
    const running = job.state === 'downloading' || job.state === 'packing';
    if (!['done', 'failed', 'cancelled'].includes(job.state)) {
      job.cancelRequested = true;
      job.paused = false;
      job.state = 'cancelled';
      job.finishedAt = Date.now();
      if (running) {
        // 只有真正在跑的任务才需要 runner 退出后再删；排队中的没有 runner，直接删
        job.hidden = true;
        job.log.push('已移除：任务正在停止，停止后自动清理记录');
      }
    }
    if (!job.hidden) jobs.delete(job.id);
    persistNow();
    return true;
  }

  function view(j, { logs = false } = {}) {
    const base = {
      id: j.id, itemId: j.itemId, title: j.title, state: j.state,
      raw: j.raw, preset: j.preset, preserveAudio: j.preserveAudio, videoMagic: j.videoMagic,
      progress: j.progress, error: j.error, createdAt: j.createdAt,
      finishedAt: j.finishedAt, hasResult: !!j.result, paused: !!j.paused,
      outFile: j.result && j.result.outFile ? path.basename(j.result.outFile) : null,
      // 绝对路径只给本机网页/安卓外壳用：安卓要靠它拉起壁纸引擎导入，绕开 WebView 下载
      outPath: j.result && j.result.outFile ? j.result.outFile : null,
      size: j.result ? j.result.size : null,
      type: j.result ? j.result.type : null,
      rawDir: j.result && j.result.raw ? j.result.rawDir : null,
      result: j.result ? (j.result.raw ? { raw: true, files: (j.result.files || []).length } : (j.result.rawExport ? {
        type: j.result.type, size: j.result.size, rawExport: true, entries: j.result.entries,
        unpacked: j.result.unpacked, warnings: j.result.warnings,
        outPath: j.result.outFile || null,
        outFile: j.result.outFile ? path.basename(j.result.outFile) : null,
      } : {
        type: j.result.type, size: j.result.size, magic: j.result.magic,
        preset: j.result.preset, tex: j.result.tex, shader: j.result.shader, audio: j.result.audio,
        warnings: j.result.warnings, entryCount: j.result.entryCount,
        // 详情抽屉直接读 result.outPath 决定「保存 .mpkg」还是「导入壁纸引擎」
        outPath: j.result.outFile || null,
        outFile: j.result.outFile ? path.basename(j.result.outFile) : null,
      })) : null,
    };
    if (logs) base.log = j.log.slice(-120);
    return base;
  }

  function stop() {
    stopped = true;
    if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
    persistNow();
  }

  load();
  const restored = [...jobs.values()].filter((j) => j.state === 'queued').length;
  if (restored) setImmediate(tick);

  return {
    maxConcurrent,
    add, get, list, cancel, retry, forget, pause, resume, view, stop, persistNow,
    subscribe, unsubscribe, snapshot,
    stats: () => ({
      total: jobs.size, running,
      queued: [...jobs.values()].filter((j) => j.state === 'queued').length,
      done: [...jobs.values()].filter((j) => j.state === 'done').length,
      failed: [...jobs.values()].filter((j) => j.state === 'failed').length,
      restored,
    }),
    tick,
    _jobs: jobs, // 测试用（只读）
  };
}

// ---------------- HTTP ----------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

/** 下载中心的写接口只接受同源请求，避免任意网页跨站操控本机队列 */
function sameOriginRequest(req) {
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) return false;
    } catch {
      return false;
    }
  }
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  return true;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 2 * 1024 * 1024) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function serveStatic(res, pathname) {
  const rel = pathname === '/' || pathname === '' ? '/downloads.html' : pathname;
  const safe = path.normalize(path.join(config.PUBLIC_DIR, decodeURIComponent(rel)));
  const publicRoot = path.resolve(config.PUBLIC_DIR);
  if (safe !== publicRoot && !safe.startsWith(publicRoot + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(safe, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not Found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(safe).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(safe).pipe(res);
  });
}

function sendFile(res, file) {
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end('Not Found'); }
  const st = fs.statSync(file);
  const name = encodeURIComponent(path.basename(file));
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(st.size),
    'Content-Disposition': `attachment; filename="${name}"; filename*=UTF-8''${name}`,
  });
  fs.createReadStream(file).pipe(res);
}

/**
 * 给 hub 配一个 HTTP 服务。
 * @param {{hub:object, port?:number, host?:string, onShutdown?:Function}} opts
 */
function createServer({ hub, port = DEFAULT_PORT, host = '127.0.0.1', onShutdown } = {}) {
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://localhost');
    const pn = u.pathname;
    try {
      // Host 白名单：下载中心只监听回环，rebinding 过来的请求 Host 是攻击者域名，这里直接拒
      const hc = guard.checkHost(req.headers.host);
      if (!hc.ok) return json(res, 403, { error: `拒绝请求：${hc.reason}` });
      // 写请求必须是 application/json：text/plain 之类是「简单请求」，浏览器不预检
      if (!guard.jsonBodyOk(req)) return json(res, 415, { error: '写请求必须使用 application/json' });
      if (pn.startsWith('/api/') && !sameOriginRequest(req)) {
        return json(res, 403, { error: '拒绝跨站请求' });
      }
      if (pn === '/api/hub/ping') {
        return json(res, 200, { ok: true, pid: process.pid, version: '2.0.1', maxConcurrent: hub.maxConcurrent, ...hub.stats() });
      }
      if (pn === '/api/hub/jobs' && req.method === 'GET') {
        return json(res, 200, {
          maxConcurrent: hub.maxConcurrent, running: hub.stats().running,
          jobs: hub.list().map((j) => hub.view(j, { logs: true })),
        });
      }
      if (pn === '/api/hub/events' && req.method === 'GET') {
        // SSE：任务列表/进度变化主动推给页面，代替 1s 轮询
        req.socket.setTimeout(0);
        if (req.socket.setNoDelay) req.socket.setNoDelay(true);
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.write('retry: 2000\n\n');
        hub.subscribe(res);
        const hb = setInterval(() => {
          try { if (!res.writableEnded) res.write(': ping\n\n'); } catch { /* 连接已断，close 回调会清理 */ }
        }, 15000);
        if (hb.unref) hb.unref();
        const cleanup = () => {
          clearInterval(hb);
          hub.unsubscribe(res);
        };
        req.on('close', cleanup);
        res.on('close', cleanup);
        return;
      }
      if (pn === '/api/hub/jobs' && req.method === 'POST') {
        let body;
        try { body = JSON.parse((await readBody(req)) || '{}'); } catch (e) {
          return json(res, 400, { error: `请求体不是合法 JSON：${e.message}` });
        }
        try {
          const job = hub.add(body);
          return json(res, 200, { jobId: job.id });
        } catch (e) {
          return json(res, e && e.code === 'ITEM_BUSY' ? 409 : 400, { error: e.message });
        }
      }
      if (pn.startsWith('/api/hub/jobs/')) {
        const parts = pn.split('/').filter(Boolean); // api hub jobs <id> [action]
        const id = parts[3];
        const action = parts[4];
        if (!guard.isValidJobId(id)) return json(res, 400, { error: '任务 id 不合法' });
        if (action && !guard.isValidJobAction(action)) return json(res, 400, { error: '不支持的任务动作' });
        if (action === 'cancel' && req.method === 'POST') {
          const ok = hub.cancel(id);
          return json(res, ok ? 200 : 404, ok ? { ok: true } : { error: '任务不存在或已结束' });
        }
        if (action === 'retry' && req.method === 'POST') {
          const job = hub.retry(id);
          return json(res, job ? 200 : 404, job ? { ok: true, jobId: job.id } : { error: '任务不存在' });
        }
        if (action === 'pause' && req.method === 'POST') {
          const ok = hub.pause(id);
          return json(res, ok ? 200 : 409, ok ? { ok: true } : { error: '只有正在下载的任务可以暂停' });
        }
        if (action === 'resume' && req.method === 'POST') {
          const ok = hub.resume(id);
          return json(res, ok ? 200 : 409, ok ? { ok: true } : { error: '任务不在暂停状态' });
        }
        if (action === 'forget' && req.method === 'POST') {
          const ok = hub.forget(id);
          return json(res, ok ? 200 : 404, ok ? { ok: true } : { error: '任务不存在（可能已被清除）' });
        }
        const job = hub.get(id);
        if (!job) return json(res, 404, { error: '任务不存在' });
        return json(res, 200, hub.view(job, { logs: true }));
      }
      if (pn.startsWith('/api/hub/file/')) {
        const id = pn.split('/')[4];
        if (!guard.isValidJobId(id)) { res.writeHead(400); return res.end('Bad job id'); }
        const job = hub.get(id);
        if (!job || !job.result || !job.result.outFile) { res.writeHead(404); return res.end('Not Found'); }
        return sendFile(res, job.result.outFile);
      }
      if (pn === '/api/hub/cdn' && req.method === 'GET') {
        const cdn = require('./cdn');
        const cached = cdn.loadCached();
        return json(res, 200, {
          ok: true,
          testedAt: cached ? cached.testedAt : 0,
          geo: cached ? cached.geo : null,
          servers: cached ? cached.servers : [],
        });
      }
      // 复用下载中心这条 CM 连接测速，避免同一 refresh token 同时开两条会话
      if (pn === '/api/hub/cdn/test' && req.method === 'POST') {
        const cdn = require('./cdn');
        const packjob = require('./packjob');
        const client = await packjob.getSharedClient(() => {});
        try {
          const data = await cdn.testRanking(client, { onLog: () => {} });
          return json(res, 200, { ok: true, testedAt: data.testedAt, geo: data.geo, servers: data.servers });
        } finally {
          cdn.releaseIdleSockets();
        }
      }
      if (pn === '/api/hub/outputs') {
        ensureDirs();
        const files = fs.readdirSync(config.OUTPUT_DIR)
          .filter((f) => f.toLowerCase().endsWith('.mpkg'))
          .map((f) => {
            const fp = path.join(config.OUTPUT_DIR, f);
            const st = fs.statSync(fp);
            return { name: f, size: st.size, mtime: st.mtimeMs };
          })
          .sort((a, b) => b.mtime - a.mtime);
        return json(res, 200, { dir: config.OUTPUT_DIR, files });
      }
      if (pn === '/api/hub/shutdown' && req.method === 'POST') {
        json(res, 200, { ok: true });
        setTimeout(() => { try { hub.stop(); } catch { /* ignore */ } if (onShutdown) onShutdown(); }, 50);
        return;
      }
      if (pn.startsWith('/api/')) return json(res, 404, { error: 'Not Found' });
      return serveStatic(res, pn);
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  });
  server.listen(port, host);
  return server;
}

// ---------------- 主服务侧：按需拉起 ----------------

function portOf(port) {
  return Number(port) || DEFAULT_PORT;
}

function hubUrl(port) {
  return `http://127.0.0.1:${portOf(port)}`;
}

/** 问一次 hub 是否活着（同步 HTTP，3 秒超时） */
function pingHub(port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: portOf(port), path: '/api/hub/ping', timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          resolve(res.statusCode === 200 && j && j.ok ? j : null);
        } catch { resolve(null); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

/** 转发一个 JSON 请求到 hub，返回 {status, body} */
function hubJson(port, method, pathname, body, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      host: '127.0.0.1', port: portOf(port), path: pathname, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {},
      timeout: timeoutMs,
    }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(text) }); }
        catch { resolve({ status: res.statusCode, body: { error: text.slice(0, 200) } }); }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('下载中心响应超时')); });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 确保 hub 在跑：桌面端 spawn 独立进程，安卓端在主进程内起服务。
 * 并发首请求必须共享同一次拉起流程，否则会同时 spawn 两个进程抢同一端口。
 * @returns {Promise<{port:number,url:string,embedded:boolean}>}
 */
let hubEnsure = null;

async function ensureHub({ port = DEFAULT_PORT, embedded = false, logger = () => {} } = {}) {
  const p = portOf(port);
  const key = String(p);
  if (hubEnsure && hubEnsure.key === key) return hubEnsure.promise;
  const promise = (async () => {
  const alive = await pingHub(p);
  if (alive) return { port: p, url: hubUrl(p), embedded: !!alive.embedded };

  if (embedded || process.platform === 'android') {
    const hub = createHub({ logger });
    createServer({ hub, port: p, onShutdown: () => process.exit(0) });
    logger(`下载中心已在应用进程内启动: ${hubUrl(p)}`);
    return { port: p, url: hubUrl(p), embedded: true };
  }

  const entry = path.join(__dirname, '..', 'bin', 'dlhub.js');
  const child = spawn(process.execPath, [entry, '--port', String(p)], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: Object.assign({}, process.env, { WE_MPKG_DLHUB_EMBEDDED: '0' }),
  });
  child.unref();
  logger(`已拉起下载中心进程 pid=${child.pid}，端口 ${p}`);

  for (let i = 0; i < 40; i++) {
    await sleep(250);
    const info = await pingHub(p, 1000);
    if (info) return { port: p, url: hubUrl(p), embedded: !!info.embedded };
  }
  throw new Error('下载中心启动超时（可查看 .cache/dlhub.log，或用 run.bat dlhub 手动启动）');
  })();
  hubEnsure = { key, promise };
  try {
    return await promise;
  } finally {
    if (hubEnsure && hubEnsure.promise === promise) hubEnsure = null;
  }
}

module.exports = {
  DEFAULT_PORT, MAX_CONCURRENT,
  createHub, createServer, ensureHub, pingHub, hubJson, hubUrl,
  stateFile, infoFile,
};
