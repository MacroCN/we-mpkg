'use strict';
/**
 * .cache / logs 的体积治理。
 *
 * - `pkg-*` / `webrender` 是打包 / 渲染的临时目录，进程被强杀时来不及删，会一直堆着；
 *   按天数 + 条数双重回收，最近 30 分钟动过的算「正在用」不碰。
 * - `item-<id>` 是着色器 blob 缓存，复用价值高，单独用更宽的天数（30 天 / 留 20 份）。
 * - `pack-plan/<id>` 是续转工作目录（断点，可能上 GB）。策略偏保守：
 *   最新的 8 份一定保留；要删必须「目录超过 30 天没动」且「source-stamp.json 记的时间也超过 30 天」；
 *   超出名额的额外计划也至少 3 天没动才清，避免连打几个包就把昨天的断点删掉。
 * - `logs/*.log` 没有轮转：单文件超限截尾保留最后一段，整目录再压总量上限；
 *   只处理 10 分钟内没写入的文件，避免和正在写的句柄打架（Windows 上尤其）。
 *
 * 全部操作都容错：任何一步失败只打日志，不影响主流程。
 */
const fs = require('fs');
const path = require('path');

const DAY = 24 * 3600 * 1000;

const DEFAULT = {
  // 临时目录（打包 / 渲染中间产物）
  tempPrefixes: ['pkg-', 'pack-', 'webrender'],
  tempMaxAgeMs: 3 * DAY,
  // 下载中心最多同时跑 3 条，每条都可能留下 pkg-<ts>/webrender 临时目录；
  // 再加一条刚建的，保留 4 份才不会被 3 并发的边角情况误删。
  tempKeepNewest: 4,
  tempActiveMs: 30 * 60 * 1000,
  // 着色器 blob 缓存
  itemPrefix: 'item-',
  itemMaxAgeMs: 30 * DAY,
  itemKeepNewest: 20,
  itemActiveMs: 30 * 60 * 1000,
  // 续转工作目录
  planDirMaxAgeMs: 30 * DAY,
  planKeepNewest: 8,
  planEvictMinAgeMs: 3 * DAY,
  planActiveMs: 30 * 60 * 1000,
  // 日志
  logMaxBytes: 8 * 1024 * 1024,
  logTailBytes: 2 * 1024 * 1024,
  logDirMaxBytes: 32 * 1024 * 1024,
  logQuietMs: 10 * 60 * 1000,
};

function rmDir(p) {
  // Windows 上文件被占用时 rmSync 会失败：maxRetries 让它等一会儿再试
  try { fs.rmSync(p, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 }); return true; } catch { return false; }
}

function dirSize(p) {
  let total = 0;
  let entries = [];
  try { entries = fs.readdirSync(p, { withFileTypes: true }); } catch { return 0; }
  for (const ent of entries) {
    const abs = path.join(p, ent.name);
    try {
      if (ent.isDirectory()) total += dirSize(abs);
      else total += fs.statSync(abs).size;
    } catch { /* ignore */ }
  }
  return total;
}

function readNames(dir) {
  try { return fs.readdirSync(dir); } catch { return []; }
}

/** 读续转目录里的 source-stamp.json，失败返回 null */
function readStamp(dir) {
  try {
    const obj = JSON.parse(fs.readFileSync(path.join(dir, 'source-stamp.json'), 'utf8'));
    return obj && typeof obj === 'object' ? obj : null;
  } catch { return null; }
}

/** 列出目录下匹配前缀的子目录，按 mtime 降序（新的在前） */
function listDirs(root, pred) {
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const ent of entries) {
    if (!ent.isDirectory() || !pred(ent.name)) continue;
    const abs = path.join(root, ent.name);
    try { out.push({ abs, name: ent.name, mtimeMs: fs.statSync(abs).mtimeMs }); } catch { /* ignore */ }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/**
 * 清理缓存目录里的临时产物与续转计划。
 * @param {string} cacheDir
 * @param {object} [opts] 可覆盖 DEFAULT 里的任意字段
 * @returns {{removed:number, bytes:number, kept:number}}
 */
function pruneCache(cacheDir, opts = {}) {
  const o = Object.assign({}, DEFAULT, opts);
  const result = { removed: 0, bytes: 0, kept: 0 };
  if (!cacheDir) return result;
  const now = Date.now();

  // 通用回收：rank 是「按 mtime 的新旧排名」，越小越新
  const sweep = (list, policy) => {
    list.forEach((d, rank) => {
      const age = now - d.mtimeMs;
      if (age < policy.activeMs) { result.kept++; return; }        // 正在用
      if (rank < policy.keepNewest && age <= policy.maxAgeMs) return; // 名额内且没过期
      const bytes = dirSize(d.abs);
      if (rmDir(d.abs)) { result.removed++; result.bytes += bytes; }
    });
  };

  // 1) 打包 / 渲染临时目录
  // 注意排除 pack-plan：它是续转计划目录，不是 pack-<ts>-xxx 临时目录，不能被当临时残骸清掉
  sweep(listDirs(cacheDir, (n) => n !== 'pack-plan' && o.tempPrefixes.some((p) => n.startsWith(p))), {
    activeMs: o.tempActiveMs,
    maxAgeMs: o.tempMaxAgeMs,
    keepNewest: o.tempKeepNewest,
  });

  // 2) 着色器 blob 缓存（item-<id>），避让 pack-plan，只处理根目录下的
  sweep(listDirs(cacheDir, (n) => n.startsWith(o.itemPrefix)), {
    activeMs: o.itemActiveMs,
    maxAgeMs: o.itemMaxAgeMs,
    keepNewest: o.itemKeepNewest,
  });

  // 3) pack-plan/<id>：最新的保留，删除需要「目录老 + 指纹也老」双条件
  const planRoot = path.join(cacheDir, 'pack-plan');
  const plans = listDirs(planRoot, (n) => !n.startsWith(o.itemPrefix)).map((p) => {
    const stamp = readStamp(p.abs);
    const stampAt = stamp && Number(stamp.at) ? Number(stamp.at) : 0;
    return Object.assign(p, { stampAt });
  });
  plans.forEach((p, rank) => {
    const age = now - p.mtimeMs;
    if (age < o.planActiveMs) { result.kept++; return; }
    const stampAge = p.stampAt ? now - p.stampAt : Infinity;
    // 名额内：只有 30 天没动且指纹也过期才删
    // 名额外的：3 天没动 + 指纹过期就清
    const inQuota = rank < o.planKeepNewest;
    const needDirAge = inQuota ? o.planDirMaxAgeMs : o.planEvictMinAgeMs;
    const needStampAge = inQuota ? o.planDirMaxAgeMs : o.planEvictMinAgeMs;
    if (age < needDirAge) return;
    if (stampAge < needStampAge) return;
    const bytes = dirSize(p.abs);
    if (rmDir(p.abs)) { result.removed++; result.bytes += bytes; }
  });

  // 4) pack-plan 里的 item-<id> 残骸（旧版遗留，跟 blob 缓存同一条天数线）
  for (const name of readNames(planRoot)) {
    if (!name.startsWith(o.itemPrefix)) continue;
    const abs = path.join(planRoot, name);
    try {
      if (now - fs.statSync(abs).mtimeMs > o.itemMaxAgeMs) { if (rmDir(abs)) result.removed++; }
    } catch { /* ignore */ }
  }

  return result;
}

/**
 * 日志治理：单文件超限时截尾保留最后一段，整个目录再压总量。
 * 只处理一段时间内没有写入的文件，避免截断正在写的句柄。
 * @param {string} logDir
 * @param {object} [opts]
 * @returns {{trimmed:number, removed:number, bytes:number, skipped:number}}
 */
function pruneLogs(logDir, opts = {}) {
  const o = Object.assign({}, DEFAULT, opts);
  const result = { trimmed: 0, removed: 0, bytes: 0, skipped: 0 };
  const now = Date.now();
  let files = [];
  try {
    files = fs.readdirSync(logDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.log'))
      .map((e) => {
        const abs = path.join(logDir, e.name);
        let st = null;
        try { st = fs.statSync(abs); } catch { /* ignore */ }
        return st ? { abs, name: e.name, size: st.size, mtimeMs: st.mtimeMs } : null;
      })
      .filter(Boolean);
  } catch { return result; }

  // 单文件截尾
  for (const f of files) {
    if (now - f.mtimeMs < o.logQuietMs) { result.skipped++; continue; }
    if (f.size <= o.logMaxBytes) continue;
    try {
      const keep = Math.min(o.logTailBytes, f.size);
      const fd = fs.openSync(f.abs, 'r');
      const buf = Buffer.alloc(keep);
      const start = Math.max(0, f.size - keep);
      fs.readSync(fd, buf, 0, keep, start);
      fs.closeSync(fd);
      fs.writeFileSync(f.abs, `--- 日志超出 ${(o.logMaxBytes / 1048576).toFixed(0)} MB，已截断，仅保留最后 ${(keep / 1048576).toFixed(1)} MB ---\n${buf.toString('utf8')}`);
      result.trimmed++;
    } catch { /* 正在写的文件可能被占用，下次再来 */ }
  }

  // 总量压缩：按修改时间删最旧的，直到总量达标（最近在写的不删）
  let total = 0;
  for (const f of files) {
    try { total += fs.statSync(f.abs).size; } catch { /* ignore */ }
  }
  if (total > o.logDirMaxBytes) {
    files.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const f of files) {
      if (total <= o.logDirMaxBytes) break;
      if (now - f.mtimeMs < o.logQuietMs) continue;
      let size = 0;
      try { size = fs.statSync(f.abs).size; } catch { size = 0; }
      try {
        fs.unlinkSync(f.abs);
        total -= size;
        result.removed++;
        result.bytes += size;
      } catch { /* ignore */ }
    }
  }
  return result;
}

/**
 * 一次跑完两处治理。失败不影响调用方。
 * @param {{cacheDir?:string, logDir?:string, logger?:Function}} opts
 */
function run(opts = {}) {
  const logger = opts.logger || (() => {});
  let cache = { removed: 0, bytes: 0, kept: 0 };
  let logs = { trimmed: 0, removed: 0, bytes: 0, skipped: 0 };
  try { cache = pruneCache(opts.cacheDir, opts); } catch (e) { logger(`⚠ 缓存治理失败: ${e.message}`); }
  try { logs = pruneLogs(opts.logDir, opts); } catch (e) { logger(`⚠ 日志治理失败: ${e.message}`); }
  const mb = (n) => (n / 1048576).toFixed(1);
  if (cache.removed) logger(`  .cache 回收: ${cache.removed} 项 / ${mb(cache.bytes)} MB` + (cache.kept ? `（${cache.kept} 项正在用，已跳过）` : ''));
  if (logs.trimmed || logs.removed) logger(`  logs 治理: 截断 ${logs.trimmed} 个 / 删除 ${logs.removed} 个`);
  return { cache, logs };
}

module.exports = { pruneCache, pruneLogs, run, DEFAULT };
