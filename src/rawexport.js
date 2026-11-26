'use strict';
/**
 * 「下载原始资源」：不产出 mpkg，而是把条目的原始资源打成 zip。
 *
 * 各类型的口径：
 * - video / application / 其它：工程目录原样打包（mp4、project.json、preview 全留着）
 * - scene：把 project.json 指向的 scene.pkg 解包，再把解包出来的原始文件打包
 * - web：走 webexport 的离线网页包（补 viewport / 触屏适配 / PWA），仍然是一个 zip
 *
 * 说明：这里刻意不做任何手机端适配（不转 RGBA8、不缩视频），因为用途是「拿去别处处理」。
 */
const fs = require('fs');
const path = require('path');
const zip = require('./zip');
const pkgformat = require('./pkgformat');

function safeName(s) {
  return String(s || '').replace(/[\\/:*?"<>|\r\n\t]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'raw';
}

function readProject(dir) {
  const file = path.join(dir, 'project.json');
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function findAny(dir, re, depth = 3) {
  const hit = (sub, d) => {
    let entries = [];
    try { entries = fs.readdirSync(sub, { withFileTypes: true }); } catch { return null; }
    for (const e of entries) {
      if (e.isFile() && re.test(e.name)) return path.join(sub, e.name);
      if (e.isDirectory() && d > 0) {
        const r = hit(path.join(sub, e.name), d - 1);
        if (r) return r;
      }
    }
    return null;
  };
  return hit(dir, depth);
}

/** 判定条目类型（和 pack.detectType 的口径保持一致，但这里只读不转换） */
function detectKind(dir, project) {
  const t = project && project.type ? String(project.type).toLowerCase() : '';
  if (t === 'web' || t === 'video' || t === 'scene') return t;
  if (findAny(dir, /\.html?$/i, 2)) return 'web';
  if (fs.existsSync(path.join(dir, 'scene.pkg'))) return 'scene';
  if (findAny(dir, /\.(mp4|webm|mkv)$/i, 2)) return 'video';
  return t || 'other';
}

/**
 * 导出原始资源 zip。
 * @param {string} itemDir 下载下来的条目目录
 * @param {{id:string,title:string,outDir:string,onLog?:Function,onProgress?:Function}} opts
 */
function exportRaw(itemDir, opts = {}) {
  const onLog = opts.onLog || (() => {});
  const onProgress = opts.onProgress || (() => {});
  const id = String(opts.id || path.basename(itemDir));
  const title = opts.title || `wallpaper_${id}`;
  const outDir = opts.outDir || path.dirname(itemDir);
  const project = readProject(itemDir);
  const kind = detectKind(itemDir, project);

  onProgress({ phase: 'rawexport', percent: null, detail: `打包原始资源（${kind}）` });
  onLog(`  原始资源模式：类型 ${kind}`);

  // web：保留交互，走离线网页包（viewport + 触屏适配 + PWA），命名统一成 _raw.zip
  if (kind === 'web') {
    const webexport = require('./webexport');
    const r = webexport.exportWebProject(itemDir, {
      id, title, outDir, onLog, onProgress, nameSuffix: 'raw',
    });
    return Object.assign({}, r, { rawExport: true, mode: 'raw' });
  }

  const workRoot = path.join(path.dirname(itemDir), 'rawexport');
  fs.rmSync(workRoot, { recursive: true, force: true });

  let zipFrom = itemDir;
  let extra = 0;
  const warnings = [];

  if (kind === 'scene') {
    // project.json 的 file 并不总是 .pkg：有些条目写的是 scene.json（例如 workshop 原包），
    // 但实际载荷仍然是 scene.pkg，这里按目录里真实存在的包名兜底，避免误报"缺少 scene.json"。
    let pkgName = (project && typeof project.file === 'string' && project.file) || 'scene.pkg';
    if (!/\.pkg$/i.test(pkgName) && fs.existsSync(path.resolve(itemDir, 'scene.pkg'))) pkgName = 'scene.pkg';
    const pkgPath = path.resolve(itemDir, pkgName);
    // 已经是解包形态（例如 .mpkg 或已展开的工程目录）：没有 .pkg 但有 scene.json，直接原样打包
    const sceneJsonPath = path.resolve(itemDir, 'scene.json');
    if (!fs.existsSync(pkgPath) && fs.existsSync(sceneJsonPath)) {
      onLog('  已是解包形态（有 scene.json、无 .pkg），原样打包工程目录');
      warnings.push('工程目录已是解包形态，未做二次解包');
    } else if (!fs.existsSync(pkgPath)) {
      throw new Error(`场景壁纸缺少 ${pkgName}（也没有 scene.json），无法导出原始资源`);
    }
    if (fs.existsSync(pkgPath)) {
    onLog(`  解包 ${path.basename(pkgPath)} ...`);
    onProgress({ phase: 'rawexport', percent: null, detail: '解包 scene.pkg' });
    try {
      const out = path.join(workRoot, 'scene');
      const res = pkgformat.extractPkg(pkgPath, out);
      zipFrom = out;
      extra = res.entryCount;
      onLog(`  已解包 ${res.entryCount} 个文件`);
      warnings.push('scene.pkg 已解包为原始文件（未做 RGBA8 转换，着色器也保持原样）');
    } catch (e) {
      // 解包不了就退回原样打包，至少不丢东西
      onLog(`  ⚠ 解包失败（${e.message}），改为原样打包工程目录`);
      zipFrom = itemDir;
      warnings.push(`scene.pkg 解包失败（${e.message}），已改为原样打包`);
    }
    }
  }

  const outFile = path.join(outDir, `${safeName(title)}_${id}_raw.zip`);
  fs.rmSync(outFile, { force: true });
  onProgress({ phase: 'rawexport', percent: null, detail: '压缩成 zip' });
  const zipped = zip.zipDirToFile(zipFrom, outFile);
  const rawBytes = zip.listFiles(zipFrom).reduce((n, f) => n + fs.statSync(f.abs).size, 0);
  try { fs.rmSync(workRoot, { recursive: true, force: true }); } catch { /* ignore */ }

  onLog(`✔ 原始资源包: ${outFile} (${(zipped.size / 1048576).toFixed(2)} MB, ${zipped.entries} 个文件)`);
  return {
    outFile,
    size: zipped.size,
    entries: zipped.entries,
    type: kind,
    mode: 'raw',
    rawExport: true,
    rawBytes,
    unpacked: extra || undefined,
    warnings,
  };
}

module.exports = { exportRaw, detectKind, readProject };
