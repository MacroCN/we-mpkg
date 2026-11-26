'use strict';
/**
 * .cache / logs 的体积治理。
 *
 * - `pkg-*` / `item-*` 是打包时用的临时目录，进程被强杀时来不及删，会一直堆着；按天数 + 条数双重回收。
 * - `pack-plan/<id>` 是续转工作目录（断点），一个条目一份，旧的一直留着会无限增长：只保留最近 N 份。
 * - `webrender/<ts>` 是网页渲染的中间目录，超过若干天直接删。
 * - `logs/*.log` 没有轮转：超过单文件上限就截尾保留最后一段，整目录再压一个总量上限。
 *
 * 全部操作都容错：任何一步失败只打日志，不影响主流程。
 */
const fs = require('fs');
const path = require('path');

const DEFAULT = {
  tempPrefixes: ['pkg-', 'item-', 'webrender'],
  tempMaxAgeMs: 3 * 24 * 3600 * 1000,
  tempKeepNewest: 2,
  planDirMaxAgeMs: 30 * 24 * 3600 * 1000,
  planKeepNewest: 8,
  logMaxBytes: 8 * 1024 * 1024,
  logTailBytes: 2 * 1024 * 1024,
  logDirMaxBytes: 32 * 1024 * 1024,
};

function rmDir(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); return true; } catch { return false; }
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

/**
 * 清理缓存目录里的临时产物与续转计划。
 * @param {string} cacheDir
 * @param {object} [opts]
 * @returns {{removed:number, bytes:number}}
 */
function pruneCache(cacheDir, opts = {}) {
  const o = Object.assign({}, DEFAULT, opts);
  const result = { removed: 0, bytes: 0 };
  if (!cacheDir) return result;
  const now = Date.now();

  let entries = [];
  try { entries = fs.readdirSync(cacheDir, { withFileTypes: true }); } catch { return result; }

  // 1) 临时目录：按前缀挑出来，先按时间回收，再保底留最新几条
  const tempDirs = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const name = ent.name;
    if (!o.tempPrefixes.some((p) => name.startsWith(p))) continue;
    const abs = path.join(cacheDir, name);
    try {
      const st = fs.statSync(abs);
      tempDirs.push({ abs, mtimeMs: st.mtimeMs, bytes: dirSize(abs) });
    } catch { /* ignore */ }
  }
  tempDirs.sort((a, b) => b.mtimeMs - a.mtimeMs); // 新的在前
  tempDirs.forEach((d, idx) => {
    const tooOld = now - d.mtimeMs > o.tempMaxAgeMs;
    const tooMany = idx >= o.tempKeepNewest;
    if (!tooOld && !tooMany) return;
    if (rmDir(d.abs)) { result.removed++; result.bytes += d.bytes; }
  });

  // 2) pack-plan/<id>：保留最近 N 份，其余删除（也顺手删过期很旧的）
  const planRoot = path.join(cacheDir, 'pack-plan');
  let plans = [];
  try { plans = fs.readdirSync(planRoot, { withFileTypes: true }); } catch { plans = []; }
  plans = plans.filter((e) => e.isDirectory()).map((e) => {
    const abs = path.join(planRoot, e.name);
    let mtimeMs = 0;
    try { mtimeMs = fs.statSync(abs).mtimeMs; } catch { /* ignore */ }
    return { abs, name: e.name, mtimeMs };
  }).sort((a, b) => b.mtimeMs - a.mtimeMs);
  plans.forEach((p, idx) => {
    if (idx < o.planKeepNewest && now - p.mtimeMs <= o.planDirMaxAgeMs) return;
    if (rmDir(p.abs)) result.removed++;
  });

  // 3) pack-plan 里的 item-<id> 残骸（旧版遗留）随临时目录规则一起清
  let items = [];
  try { items = fs.readdirSync(path.join(cacheDir, 'pack-plan')); } catch { items = []; }
  for (const name of items) {
    if (!name.startsWith('item-')) continue;
    const abs = path.join(cacheDir, 'pack-plan', name);
    try {
      if (now - fs.statSync(abs).mtimeMs > o.tempMaxAgeMs) { if (rmDir(abs)) result.removed++; }
    } catch { /* ignore */ }
  }

  return result;
}

/**
 * 日志治理：单文件超限时截尾保留最后一段，整个目录再压总量。
 * @param {string} logDir
 * @param {object} [opts]
 * @returns {{trimmed:number, removed:number, bytes:number}}
 */
function pruneLogs(logDir, opts = {}) {
  const o = Object.assign({}, DEFAULT, opts);
  const result = { trimmed: 0, removed: 0, bytes: 0 };
  let files = [];
  try {
    files = fs.readdirSync(logDir, { withFileTypes: true })
      .filter((e) => e.isFile())
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

  // 总量压缩：按修改时间删最旧的，直到总量达标
  let total = 0;
  for (const f of files) {
    try { total += fs.statSync(f.abs).size; } catch { /* ignore */ }
  }
  if (total > o.logDirMaxBytes) {
    files.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const f of files) {
      if (total <= o.logDirMaxBytes) break;
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
  let cache = { removed: 0, bytes: 0 };
  let logs = { trimmed: 0, removed: 0, bytes: 0 };
  try { cache = pruneCache(opts.cacheDir, opts); } catch (e) { logger(`⚠ 缓存治理失败: ${e.message}`); }
  try { logs = pruneLogs(opts.logDir, opts); } catch (e) { logger(`⚠ 日志治理失败: ${e.message}`); }
  const mb = (n) => (n / 1048576).toFixed(1);
  if (cache.removed) logger(`  .cache 回收: ${cache.removed} 项 / ${mb(cache.bytes)} MB`);
  if (logs.trimmed || logs.removed) logger(`  logs 治理: 截断 ${logs.trimmed} 个 / 删除 ${logs.removed} 个`);
  return { cache, logs };
}

module.exports = { pruneCache, pruneLogs, run, DEFAULT };
