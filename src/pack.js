'use strict';
/**
 * 打包流水线：创意工坊条目目录 -> .mpkg
 *
 * 步骤：
 *   1. 读 project.json 判断壁纸类型（video / scene / web / application / preset）
 *   2. scene 类：把 scene.pkg 解包成散装资源（手机版不读嵌套 pkg）
 *   3. 音频剥离（默认）→ 生成转换计划 + 断点
 *   4. 纹理按路由转换（DXT/直通图/原始像素 → RGBA8 + LZ4，超预算保留原文件），
 *      .frag/.vert 做 GLSL→GLSL ES 兼容改写（详见 src/tex.js、src/shadercompat.js）
 *   5. 可选：如额外提供同一壁纸的手机版 mpkg（--reference），用其中的 .tex/.frag/.vert 覆盖
 *   6. 以 PKGM0020（视频类可选 PKGM0014）重新封装
 */
const fs = require('fs');
const path = require('path');
const pkgformat = require('./pkgformat');
const tex = require('./tex');
const shadercompat = require('./shadercompat');
const convertplan = require('./convertplan');
const { config, ensureDirs, tempDir } = require('./config');

const VIDEO_EXT = new Set(['.mp4', '.webm', '.avi', '.wmv', '.mkv', '.mov', '.m4v']);
const SCENE_PKG = 'scene.pkg';
const REFERENCE_OVERRIDE_EXT = new Set(['.tex', '.frag', '.vert']);

function safeFileName(s) {
  return String(s || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100) || 'wallpaper';
}

function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (ent.isFile()) out.push(abs);
    }
  };
  walk(dir);
  // 固定顺序：不同文件系统 readdir 顺序不一致，排序后保证同一条目在任意平台产出完全相同的字节
  out.sort((a, b) => {
    const ra = path.relative(dir, a).replace(/\\/g, '/');
    const rb = path.relative(dir, b).replace(/\\/g, '/');
    return ra < rb ? -1 : (ra > rb ? 1 : 0);
  });
  return out;
}

function readProjectJson(dir) {
  const p = path.join(dir, 'project.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    return { __parseError: e.message };
  }
}

/** 判断壁纸类型 */
function detectType(itemDir, project) {
  const p = project || readProjectJson(itemDir);
  const declared = p && typeof p.type === 'string' ? p.type.toLowerCase() : '';
  if (declared) return declared;
  if (fs.existsSync(path.join(itemDir, SCENE_PKG))) return 'scene';
  const files = listFiles(itemDir);
  if (files.some((f) => VIDEO_EXT.has(path.extname(f).toLowerCase()))) return 'video';
  if (files.some((f) => /\.html?$/i.test(f))) return 'web';
  return 'unknown';
}

/**
 * 把下载目录整理成"手机版项目目录"
 * @returns {{projectDir:string, type:string, project:object|null, warnings:string[]}}
 */
function prepareProjectDir(itemDir, opts = {}) {
  const onLog = opts.onLog || (() => {});
  ensureDirs();
  const workDir = opts.workDir || tempDir('pack');
  const projectDir = path.join(workDir, 'project');
  fs.mkdirSync(projectDir, { recursive: true });
  const warnings = [];

  const project = readProjectJson(itemDir);
  if (project && project.__parseError) {
    warnings.push(`project.json 解析失败: ${project.__parseError}`);
  }
  if (!project) warnings.push('下载目录里没有 project.json，打包结果可能无法被手机版识别');

  const type = detectType(itemDir, project);
  const scenePkg = path.join(itemDir, SCENE_PKG);

  if (fs.existsSync(scenePkg)) {
    onLog(`解包 ${SCENE_PKG} ...`);
    const res = pkgformat.extractPkg(scenePkg, projectDir);
    onLog(`  解包出 ${res.files.length} 个文件（${res.magic}）`);
    // 下载目录里的其它散装文件（project.json / preview.jpg 等）也补进去
    copyLooseFiles(itemDir, projectDir, new Set([SCENE_PKG.toLowerCase()]));
  } else {
    copyLooseFiles(itemDir, projectDir);
  }

  // 保证 project.json 存在
  if (!fs.existsSync(path.join(projectDir, 'project.json')) && project) {
    fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify(project, null, 2));
  }

  return { projectDir, type, project, warnings, workDir };
}

function copyLooseFiles(srcDir, dstDir, skipNames = new Set()) {
  for (const abs of listFiles(srcDir)) {
    const rel = path.relative(srcDir, abs);
    const base = path.basename(abs).toLowerCase();
    if (skipNames.has(base)) continue;
    if (/\.pkg$/i.test(abs)) continue; // 嵌套 pkg 不带进 mpkg
    const dest = path.join(dstDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(abs, dest);
  }
}

/**
 * 用参考 mpkg 覆盖手机端专用资源。
 *
 * 2.0 起改用流式读取（openPkg）：参考包可能有一两个 GB，整包读进内存
 * 在安卓上会直接把进程拖死。这里只按条目读需要的那几段。
 *
 * @returns {{stats:{tex:number,frag:number,meta:number}, warnings:string[]}}
 */
function applyReference(projectDir, referencePath, onLog = () => {}) {
  const ref = pkgformat.openPkg(referencePath);
  const stats = { tex: 0, frag: 0, meta: 0 };
  const warnings = [];
  try {
    if (!/^PKGM/.test(ref.magic)) {
      warnings.push(`参考文件的 magic 是 ${ref.magic}，不是手机版 MPKG，替换结果可能不符预期`);
    }
    for (let i = 0; i < ref.entries.length; i++) {
      const entry = ref.entries[i];
      const rel = pkgformat.normalizeEntryPath(entry.path);
      const dest = path.join(projectDir, rel);
      const ext = path.extname(rel).toLowerCase();
      const exists = fs.existsSync(dest);
      if (!exists && (rel === 'project.json' || rel === 'preview.gif')) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, ref.readEntry(i));
        stats.meta++;
        onLog(`  [补入] ${rel}（来自参考 mpkg）`);
        continue;
      }
      if (!exists) continue;
      if (REFERENCE_OVERRIDE_EXT.has(ext)) {
        const curSize = fs.statSync(dest).size;
        if (curSize !== entry.length) {
          fs.writeFileSync(dest, ref.readEntry(i));
          if (ext === '.tex') stats.tex++;
          else stats.frag++;
          onLog(`  [替换] ${rel} (${curSize} -> ${entry.length} 字节)`);
        }
      }
    }
  } finally {
    ref.close();
  }
  if (!stats.tex && !stats.frag) {
    warnings.push('参考 mpkg 没有替换到任何纹理/着色器（用了参考包说明原纹理本来就不适合手机，建议检查这份参考包是否对应该壁纸）');
  }
  return { stats, warnings };
}

/** 检查 project.json 与文件是否自洽，给出可读警告 */
function validateProject(projectDir, project, type) {
  const warnings = [];
  if (!project || project.__parseError) return warnings;
  const declared = typeof project.file === 'string' ? project.file.replace(/\\/g, '/') : '';
  if (declared) {
    const p = path.join(projectDir, declared);
    if (!fs.existsSync(p)) warnings.push(`project.json 引用的文件不存在: ${declared}`);
  }
  if (type === 'video') {
    const vids = listFiles(projectDir).filter((f) => VIDEO_EXT.has(path.extname(f).toLowerCase()));
    if (!vids.length) warnings.push('声明为 video 类型，但目录里没有找到视频文件');
  }
  if (type === 'web') return warnings; // web 类由 adaptWebToVideo 处理，不再给"可能无法加载"的含糊警告
  if (type === 'application') warnings.push('application 类型壁纸依赖桌面端运行时，手机端基本不可用');
  return warnings;
}

/**
 * 手机端适配：纹理转换 + 着色器兼容改写
 * @param {{onLog?:Function, preset?:object|string, maxRgbaBytes?:number, checkpoint?:object}} opts
 * @returns {{warnings:string[], tex:object, shader:object, outcomes:Array}}
 */
function adaptForMobile(projectDir, opts = {}) {
  const onLog = opts.onLog || (() => {});
  const onProgress = opts.onProgress || (() => {});
  const warnings = [];
  const textureTotal = Math.max(0, Number(opts.textureTotal) || 0);
  let textureDone = 0;
  const preset = typeof opts.preset === 'string' ? tex.presetOf(opts.preset) : (opts.preset || tex.presetOf('high'));
  onLog(`  画质档位: ${preset.label}（reduction=${preset.reduction}, maxDimension=${preset.maxDimension || '不限'}）`);

  onProgress({ phase: 'convert', done: 0, total: textureTotal, detail: '纹理转换' });
  const texRes = tex.convertTexDir(projectDir, {
    onLog,
    preset,
    maxRgbaBytes: opts.maxRgbaBytes,
    checkpoint: opts.checkpoint,
    onResource: () => {
      textureDone++;
      onProgress({ phase: 'convert', done: textureDone, total: textureTotal, detail: '纹理转换' });
    },
  });
  warnings.push(...texRes.warnings);

  onProgress({ phase: 'shader', detail: '着色器兼容改写' });
  const shaderStats = shadercompat.patchDir(projectDir, { onLog, checkpoint: opts.checkpoint });
  if (shaderStats.rewritten) {
    onLog(`  着色器兼容改写: ${shaderStats.rewritten} 个文件 / ${shaderStats.literals} 处补 .0 / ${shaderStats.structural} 处结构性修正`);
  }
  if (shaderStats.failed) warnings.push(`${shaderStats.failed} 个着色器改写失败，已保留原文件`);
  return { warnings, tex: texRes.stats, shader: shaderStats, outcomes: texRes.outcomes };
}

/** 音频文件扩展名（可与 .tex/.frag/.vert 之外的所有资源共存） */
const AUDIO_EXT = new Set(['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.opus']);

/**
 * 剥离壁纸自带的音频文件（默认开启，`preserveAudio` 关掉）。
 *
 * 移动端 Wallpaper Engine 播放音频只有两种来源：视频自带音轨，或者场景里的
 * 音频响应。老壁纸附带的整段 BGM 只会白占体积，官方导出手机版同样不带这些文件。
 * 只删音频目录下的音频文件，不碰其它资源。
 *
 * @returns {{removed:number, bytes:number, files:string[]}}
 */
function stripAudio(projectDir, opts = {}) {
  const onLog = opts.onLog || (() => {});
  const result = { removed: 0, bytes: 0, files: [] };
  if (opts.preserveAudio) return result;
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, ent.name);
      if (ent.isDirectory()) { walk(abs); continue; }
      if (!AUDIO_EXT.has(path.extname(ent.name).toLowerCase())) continue;
      const size = fs.statSync(abs).size;
      fs.rmSync(abs, { force: true });
      result.removed++;
      result.bytes += size;
      result.files.push(path.relative(projectDir, abs).split(path.sep).join('/'));
    }
  };
  walk(projectDir);
  if (result.removed) {
    onLog(`  音频剥离: ${result.removed} 个文件 / ${(result.bytes / 1048576).toFixed(2)} MB`);
  }
  return result;
}

/**
 * 目录 -> mpkg 文件
 */
function writeMpkg(projectDir, outFile, opts = {}) {
  const magic = opts.magic || pkgformat.MAGIC_MOBILE;
  const res = pkgformat.packDirToBuffer(projectDir, magic);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, res.buffer);
  return { outFile, size: res.buffer.length, entries: res.entries, magic };
}

/**
 * web 类壁纸的手机端适配：安卓 WE 只有 scene/video 引擎（无 Web/Chromium），
 * 网页类导入后必然黑屏。这里用桌面浏览器无头渲染成 mp4，再按 video 类型重新打包。
 * @returns {Promise<{projectDir:string, info:object|null, warnings:string[]}>}
 */
async function adaptWebToVideo(projectDir, opts = {}, onLog = () => {}) {
  const warnings = [];
  try {
    const webrender = require('./webrender');
    const hasBrowser = !!webrender.findBrowser();
    const hasFfmpeg = !!webrender.findFfmpeg();
    if (!hasBrowser || !hasFfmpeg) {
      const miss = [!hasBrowser && 'Edge/Chrome', !hasFfmpeg && 'ffmpeg'].filter(Boolean).join('、');
      warnings.push(`web 类壁纸需要把这网页渲染成视频才能在手机上看，但本机缺少 ${miss}，只能按原样打包（手机端会黑屏）`);
      onLog(`  ⚠ 缺少 ${miss}，web 类未转换`);
      return { projectDir, info: null, warnings };
    }
    onLog('web 类壁纸在手机端无法渲染，正在转成视频（保留动画，丢失交互/音频反应）...');
    const dst = path.join(path.dirname(projectDir), 'webvideo');
    const info = await webrender.convertWebProject(projectDir, dst, {
      seconds: opts.seconds,
      fps: opts.fps,
      width: opts.width,
      height: opts.height,
      onLog,
    });
    warnings.push(`web 类壁纸已转成视频（${((info.size || 0) / 1024 / 1024).toFixed(2)} MB，${info.frames} 帧）：手机端不支持网页渲染，视频是唯一能正常显示的形式`);
    return { projectDir: dst, info, warnings };
  } catch (e) {
    warnings.push(`web 类转视频失败（${e.message}），按原样打包，手机端会黑屏`);
    onLog(`  ⚠ web 转视频失败: ${e.message}`);
    return { projectDir, info: null, warnings };
  }
}

/**
 * 完整流程：创意工坊条目目录 -> mpkg
 * @param {string} itemDir
 * @param {{title?:string, id?:string, outDir?:string, reference?:string, onLog?:Function,
 *          keepWorkDir?:boolean, resume?:boolean, preset?:string|object, preserveAudio?:boolean,
 *          videoMagic?:string, maxRgbaBytes?:number,
 *          webSeconds?:number, webFps?:number, webWidth?:number, webHeight?:number}} opts
 */
async function packFromItemDir(itemDir, opts = {}) {
  const onLog = opts.onLog || (() => {});
  const onProgress = opts.onProgress || (() => {});
  const id = String(opts.id || path.basename(itemDir));
  const title = opts.title || `wallpaper_${id}`;
  const preset = typeof opts.preset === 'string' ? tex.presetOf(opts.preset) : (opts.preset || tex.presetOf('high'));

  onProgress({ phase: 'prepare', detail: '解包与检查' });
  onLog(`\n=== 打包 ${title} (${id}) ===`);
  // 续转需要一个稳定的工作目录：临时目录一删，断点就没了
  const workDir = opts.workDir || (opts.resume ? stableWorkDir(id) : tempDir('pack'));
  const prepared = prepareProjectDir(itemDir, { workDir, onLog });
  for (const w of prepared.warnings) onLog(`  ⚠ ${w}`);
  onLog(`壁纸类型: ${prepared.type}`);

  const warnings = [...prepared.warnings, ...validateProject(prepared.projectDir, prepared.project, prepared.type)];

  let mobileDir = prepared.projectDir;
  let webInfo = null;
  if (prepared.type === 'web') {
    const web = await adaptWebToVideo(prepared.projectDir, {
      seconds: opts.webSeconds,
      fps: opts.webFps,
      width: opts.webWidth,
      height: opts.webHeight,
      layout: opts.webLayout,
    }, onLog);
    mobileDir = web.projectDir;
    webInfo = web.info;
    warnings.push(...web.warnings);
  }

  // 音频：默认剥离（官方导出手机版也不带），--keep-audio 可保留
  const audio = stripAudio(mobileDir, { preserveAudio: opts.preserveAudio, onLog });

  // 转换计划 + 断点：先把清单写下来，中断后再跑能接上
  const planFile = path.join(prepared.workDir, 'convert-plan.json');
  const checkpointFile = path.join(prepared.workDir, 'convert-checkpoint.json');
  const plan = convertplan.buildPlan({
    dir: mobileDir,
    preset,
    preserveAudio: !!opts.preserveAudio,
    maxFileBytes: opts.maxFileBytes,
  });
  convertplan.writePlan(planFile, plan);
  const checkpoint = new convertplan.Checkpoint(checkpointFile);
  checkpoint.bind(`${preset.id}|v2|audio=${opts.preserveAudio ? 1 : 0}`);
  if (checkpoint.loadedFromDisk && checkpoint.resolvedCount) {
    onLog(`  发现上次的转换断点：已有 ${checkpoint.resolvedCount} 个资源完成，继续转换`);
  }

  onLog('纹理/着色器适配（手机端）...');
  const textureTotal = plan.resources.filter((r) => r.kind === 'texture').length;
  const adapted = adaptForMobile(mobileDir, {
    onLog,
    preset,
    maxRgbaBytes: opts.maxRgbaBytes,
    checkpoint,
    textureTotal,
    onProgress,
  });
  warnings.push(...adapted.warnings);
  if (!checkpoint.flush()) warnings.push('转换断点写入失败，本次结果不能续转（不影响打包）');

  if (opts.reference) {
    onProgress({ phase: 'reference', detail: '替换参考包资源' });
    onLog(`应用参考 mpkg: ${path.basename(opts.reference)}`);
    const r = applyReference(mobileDir, opts.reference, onLog);
    warnings.push(...r.warnings);
  }

  const outDir = opts.outDir || config.OUTPUT_DIR;
  const outFile = path.join(outDir, `${safeFileName(title)}_${id}.mpkg`);
  const magic = pickMagic(prepared.type, opts.videoMagic);
  onProgress({ phase: 'write', detail: '写入 mpkg' });
  const built = writeMpkg(mobileDir, outFile, { magic });
  onLog(`✔ 输出: ${outFile} (${(built.size / 1024 / 1024).toFixed(2)} MB, ${built.entries.length} 个文件, ${magic})`);
  onProgress({ phase: 'done', percent: 100, detail: '完成' });

  const keepWorkDir = !!(opts.keepWorkDir || opts.resume);
  if (!keepWorkDir && prepared.workDir) {
    try { fs.rmSync(prepared.workDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  return {
    outFile,
    size: built.size,
    entryCount: built.entries.length,
    type: prepared.type,
    magic,
    preset: { id: preset.id, label: preset.label, reduction: preset.reduction, maxDimension: preset.maxDimension },
    warnings,
    entries: built.entries,
    tex: adapted.tex,
    shader: adapted.shader,
    audio,
    web: webInfo,
    plan: summarizePlan(plan),
    planFile: keepWorkDir ? planFile : null,
    checkpointFile: keepWorkDir ? checkpointFile : null,
    workDir: keepWorkDir ? prepared.workDir : null,
    outcomes: adapted.outcomes,
  };
}

/** 续转用的稳定工作目录（按条目 id 区分，失败后可原地重跑） */
function stableWorkDir(id) {
  const dir = path.join(config.CACHE_DIR, 'pack-plan', safeFileName(id));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 计划文件的精简摘要（不把整份资源清单塞进任务结果） */
function summarizePlan(plan) {
  if (!plan) return null;
  return {
    version: plan.version, policy: plan.policy, preset: plan.preset,
    resourceCount: plan.resourceCount, totalBytes: plan.totalBytes,
  };
}

/** 按壁纸类型选容器魔数：视频类允许单独指定（PKGM0014 / PKGM0020） */
function pickMagic(type, videoMagic) {
  if (type === 'video' && String(videoMagic || '').toLowerCase() === '0014') return pkgformat.MAGIC_MOBILE_VIDEO;
  return pkgformat.MAGIC_MOBILE;
}

/**
 * 本地文件打包：支持 .pkg / 目录 / 已有 .mpkg（仅换 magic）
 */
async function packFromPath(inputPath, opts = {}) {
  const onLog = opts.onLog || (() => {});
  const stat = fs.statSync(inputPath);
  if (stat.isDirectory()) {
    return packFromItemDir(inputPath, opts);
  }
  const ext = path.extname(inputPath).toLowerCase();
  if (ext !== '.pkg' && ext !== '.mpkg') {
    throw new Error(`不支持的输入类型: ${ext}（请给目录、.pkg 或 .mpkg）`);
  }
  if (ext === '.mpkg' && !opts.reference) {
    // 已经是手机版容器，只是换个名字输出
    const outDir = opts.outDir || config.OUTPUT_DIR;
    const name = safeFileName(opts.title || path.basename(inputPath, ext));
    const outFile = path.join(outDir, `${name}.mpkg`);
    fs.mkdirSync(outDir, { recursive: true });
    fs.copyFileSync(inputPath, outFile);
    onLog(`✔ 直接复制: ${outFile}`);
    return { outFile, size: stat.size, entryCount: 0, type: 'mpkg', warnings: [] };
  }
  // .pkg：解包后按目录流程处理
  const workDir = tempDir('pkg');
  const projectDir = path.join(workDir, 'project');
  const res = pkgformat.extractPkg(inputPath, projectDir);
  onLog(`解包 ${path.basename(inputPath)}: ${res.files.length} 个文件 (${res.magic})`);
  const warnings = [];
  const preset = typeof opts.preset === 'string' ? tex.presetOf(opts.preset) : (opts.preset || tex.presetOf('high'));
  const audio = stripAudio(projectDir, { preserveAudio: opts.preserveAudio, onLog });
  const planFile = path.join(workDir, 'convert-plan.json');
  const checkpointFile = path.join(workDir, 'convert-checkpoint.json');
  const plan = convertplan.buildPlan({
    dir: projectDir, preset, preserveAudio: !!opts.preserveAudio, maxFileBytes: opts.maxFileBytes,
  });
  convertplan.writePlan(planFile, plan);
  const checkpoint = new convertplan.Checkpoint(checkpointFile);
  checkpoint.bind(`${preset.id}|v2|audio=${opts.preserveAudio ? 1 : 0}`);
  onLog('纹理/着色器适配（手机端）...');
  const adapted = adaptForMobile(projectDir, { onLog, preset, maxRgbaBytes: opts.maxRgbaBytes, checkpoint });
  warnings.push(...adapted.warnings);
  checkpoint.flush();
  if (opts.reference) {
    const r = applyReference(projectDir, opts.reference, onLog);
    warnings.push(...r.warnings);
  }
  const outDir = opts.outDir || config.OUTPUT_DIR;
  const title = opts.title || path.basename(inputPath, ext);
  const outFile = path.join(outDir, `${safeFileName(title)}.mpkg`);
  const built = writeMpkg(projectDir, outFile, { magic: pkgformat.MAGIC_MOBILE });
  onLog(`✔ 输出: ${outFile} (${(built.size / 1024 / 1024).toFixed(2)} MB, ${built.entries.length} 个文件)`);
  const keepWorkDir = !!opts.keepWorkDir;
  if (!keepWorkDir) {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  return {
    outFile, size: built.size, entryCount: built.entries.length, type: 'pkg',
    warnings, entries: built.entries, audio,
    preset: { id: preset.id, label: preset.label, reduction: preset.reduction, maxDimension: preset.maxDimension },
    tex: adapted.tex, shader: adapted.shader, outcomes: adapted.outcomes,
    plan: summarizePlan(plan),
    planFile: keepWorkDir ? planFile : null,
    checkpointFile: keepWorkDir ? checkpointFile : null,
    workDir: keepWorkDir ? workDir : null,
  };
}

/** 分析目录或容器，供 CLI/界面展示（容器用流式读取，不整包进内存） */
function analyze(inputPath) {
  const out = { input: inputPath };
  if (fs.statSync(inputPath).isDirectory()) {
    out.kind = 'dir';
    out.project = readProjectJson(inputPath);
    out.files = listFiles(inputPath).map((f) => ({
      path: path.relative(inputPath, f).split(path.sep).join('/'),
      size: fs.statSync(f).size,
    }));
    out.type = detectType(inputPath, out.project);
    return out;
  }
  const pkg = pkgformat.openPkg(inputPath);
  try {
    out.kind = 'container';
    out.magic = pkg.magic;
    out.entryCount = pkg.entryCount;
    out.files = pkg.entries.map((e) => ({ path: e.path, size: e.length }));
    const idx = pkg.entries.findIndex((e) => pkgformat.normalizeEntryPath(e.path) === 'project.json');
    if (idx >= 0) {
      try {
        out.project = JSON.parse(pkg.readEntry(idx).toString('utf8').replace(/^\uFEFF/, ''));
      } catch { /* ignore */ }
    }
  } finally {
    pkg.close();
  }
  return out;
}

module.exports = {
  packFromItemDir, packFromPath, analyze, prepareProjectDir, applyReference, writeMpkg,
  detectType, validateProject, safeFileName, listFiles, adaptForMobile, adaptWebToVideo,
  stripAudio, pickMagic, stableWorkDir,
};
