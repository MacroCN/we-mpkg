/**
 * 打包前兼容性报告：在真正转换纹理之前，先告诉用户“这条壁纸手机会不会出问题、慢在哪”。
 *
 * 只读扫描项目目录（.tex / 视频 / 音频 / project.json），不做任何转换，几秒钟就能出结果。
 * 结论分三档：ok（可直接用）/ warn（能用但有取舍）/ bad（大概率黑屏，别白花时间）。
 */
const fs = require('fs');
const path = require('path');

const tex = require('./tex');

const VIDEO_EXT = new Set(['.mp4', '.webm', '.avi', '.wmv', '.mkv', '.mov', '.m4v']);

function walk(dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.isFile()) out.push(p);
  }
  return out;
}

function readProject(dir) {
  try {
    const raw = fs.readFileSync(path.join(dir, 'project.json'), 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function fmtMB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 估算转成 RGBA8 后占多少显存（只算主 mip，不含视频纹理） */
function rgbaBytes(texInfo, preset) {
  const w = texInfo.header.imageWidth || texInfo.header.textureWidth;
  const h = texInfo.header.imageHeight || texInfo.header.textureHeight;
  const reduction = preset && preset.reduction ? preset.reduction : 1;
  const cap = preset && preset.maxDimension ? preset.maxDimension : 0;
  let tw = Math.max(1, Math.floor(w / reduction));
  let th = Math.max(1, Math.floor(h / reduction));
  if (cap && (tw > cap || th > cap)) {
    const k = cap / Math.max(tw, th);
    tw = Math.max(1, Math.floor(tw * k));
    th = Math.max(1, Math.floor(th * k));
  }
  return tw * th * 4;
}

/**
 * @param {string} projectDir 已解包的项目目录（scene 类要先把 scene.pkg 解开）
 * @param {{type?:string, preset?:object|string, platform?:string}} opts
 * @returns {{level:'ok'|'warn'|'bad', type:string, platform:string, summary:string,
 *           warnings:string[], notes:string[], textures:object, audio:object, video:object}}
 */
function inspect(projectDir, opts = {}) {
  const preset = typeof opts.preset === 'string' ? tex.presetOf(opts.preset) : (opts.preset || tex.presetOf('high'));
  const platform = opts.platform || process.platform;
  const project = readProject(projectDir);
  const declared = project && typeof project.type === 'string' ? project.type.toLowerCase() : '';
  const type = opts.type || declared || 'unknown';
  const warnings = [];
  const notes = [];

  const files = walk(projectDir, []);
  let totalBytes = 0;
  const videoFiles = [];
  const audioFiles = [];
  const texFiles = [];
  const htmlFiles = [];
  for (const f of files) {
    let st;
    try { st = fs.statSync(f); } catch { continue; }
    totalBytes += st.size;
    const ext = path.extname(f).toLowerCase();
    if (VIDEO_EXT.has(ext)) videoFiles.push({ path: f, size: st.size });
    else if (/\.(mp3|ogg|wav|flac|m4a)$/.test(ext)) audioFiles.push({ path: f, size: st.size });
    else if (ext === '.tex') texFiles.push(f);
    else if (/\.html?$/i.test(ext)) htmlFiles.push(f);
  }

  let texCount = 0;
  let videoTex = 0;
  let decodeTex = 0;
  let brokenTex = 0;
  let maxW = 0;
  let maxH = 0;
  let estimateRgba = 0;
  for (const f of texFiles) {
    let t;
    try {
      t = tex.parseTex(fs.readFileSync(f));
    } catch {
      brokenTex++;
      continue;
    }
    texCount++;
    const kind = tex.classify(t);
    maxW = Math.max(maxW, t.header.imageWidth || t.header.textureWidth);
    maxH = Math.max(maxH, t.header.imageHeight || t.header.textureHeight);
    if (kind === 'video') {
      videoTex++;
      continue;
    }
    if (kind !== 'mobile' && kind !== 'passthrough') decodeTex++;
    estimateRgba += rgbaBytes(t, preset);
  }

  if (brokenTex) warnings.push(`${brokenTex} 个 .tex 解析失败，可能已经损坏或是特殊格式`);

  const webrender = require('./webrender');
  const videoUtil = require('./video');
  const hasFfmpeg = !!videoUtil.findFfmpeg();
  const hasBrowser = !!webrender.findBrowser();

  if (type === 'application') {
    warnings.push('application 类型依赖桌面端运行时，手机版 Wallpaper Engine 打不开');
  }
  if (type === 'web') {
    if (hasBrowser && hasFfmpeg) {
      notes.push('网页类会在打包时用本机浏览器渲染成视频（交互会丢，只保留画面）');
    } else {
      const miss = [!hasBrowser && '浏览器', !hasFfmpeg && 'ffmpeg'].filter(Boolean).join('、');
      warnings.push(`网页类需要 ${miss} 才能转成视频；本机缺这些，直接打包手机端会黑屏`);
    }
  }
  if (type === 'preset') notes.push('预设类没有实际内容，打包后通常不能单独使用');

  if (videoTex > 0) {
    const target = videoUtil.targetLongEdge(maxW, maxH, preset);
    if (!hasFfmpeg && target > 0) {
      warnings.push(`含 ${videoTex} 个视频纹理，当前画质需要缩到 ${target}px，但本机没有 ffmpeg，只能原样保留`);
    } else if (target > 0) {
      notes.push(`视频纹理最大 ${maxW}×${maxH}，当前画质会缩到最长边 ${target}px`);
    } else {
      notes.push(`含 ${videoTex} 个视频纹理（${maxW}×${maxH}），当前画质可原样复用`);
    }
  }

  if (!texFiles.length && (type === 'scene' || type === 'video')) {
    warnings.push('没有找到任何 .tex 纹理：可能这个条目用了非常规结构，或下载不完整');
  }

  const rgbaMB = estimateRgba / 1024 / 1024;
  if (rgbaMB > 320) {
    warnings.push(`按当前画质预计显存约 ${rgbaMB.toFixed(0)} MB，低内存手机可能被杀进程；建议改「均衡」或「流畅」`);
  } else if (rgbaMB > 160) {
    notes.push(`预计显存约 ${rgbaMB.toFixed(0)} MB，6 GB 以下内存建议选「均衡」`);
  }

  if (audioFiles.length) {
    notes.push(`含 ${audioFiles.length} 个音频文件，默认会被剥离（可勾「保留音频」）`);
  }
  if (videoFiles.length && type !== 'video') {
    notes.push(`含 ${videoFiles.length} 个视频文件，按视频播放处理`);
  }

  const level = (type === 'application' || (type === 'web' && !(hasBrowser && hasFfmpeg))) ? 'bad'
    : (warnings.length ? 'warn' : 'ok');

  const summary = level === 'bad'
    ? '不兼容：这条大概率在手机上黑屏'
    : (level === 'warn' ? '需注意：能打包，但有上面列出的取舍' : '兼容性良好，可直接打包');

  return {
    level,
    type,
    platform,
    summary,
    warnings,
    notes,
    preset: { id: preset.id, label: preset.label, reduction: preset.reduction, maxDimension: preset.maxDimension },
    textures: {
      files: texFiles.length, parsed: texCount, video: videoTex, needsDecode: decodeTex,
      broken: brokenTex, maxWidth: maxW, maxHeight: maxH, estimatedRgbaMB: Math.round(rgbaMB),
    },
    video: { files: videoFiles.length, bytes: videoFiles.reduce((n, v) => n + v.size, 0) },
    audio: { files: audioFiles.length, bytes: audioFiles.reduce((n, v) => n + v.size, 0) },
    html: { files: htmlFiles.length },
    totalBytes,
    totalText: fmtMB(totalBytes),
    tools: { ffmpeg: hasFfmpeg, browser: hasBrowser },
  };
}

module.exports = { inspect };
