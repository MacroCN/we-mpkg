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
const crypto = require('crypto');
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
      let dest;
      try {
        dest = pkgformat.safeJoin(projectDir, rel);
      } catch (e) {
        warnings.push(`跳过不安全的参考包条目 ${rel}: ${e.message}`);
        onLog(`  ⚠ 跳过不安全的参考包条目: ${rel}`);
        continue;
      }
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

function readMaybe(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

/**
 * 手机端图层兼容修复（音频频谱层 / 叠加层 / 互动效果）。
 *
 * 三类问题的共同点：图层本身没坏，坏的是「它挂的 effect 在移动端编译不过」。
 * shadercompat 已经把已知的编译杀手都改写掉了（动态数组下标、预处理分号、
 * 频谱数组整拷贝、指针 uniform 重声明……），所以这里的策略从「看到音频层就删」
 * 改成「先保留，只有修不好时才退化」：
 *
 *   1. 音频频谱层：shader 修好 → 保留（配合 stripAudio 的自动保留音频，频谱才有数据）；
 *      改写后仍残留动态数组下标 → 才移除，避免又变回白块。--drop-audio-layers 可强制移除。
 *   2. 叠加层：一律不再当作垃圾删掉；被移除的层如果还挂着子对象（parent 指向它），
 *      把子对象重挂到祖父层，避免文字层/贴图层因为父层消失而整体不见或错位。
 *   3. 叠加/互动属性：alpha 统一成数字（字符串会让移动端按默认值渲染，叠加层整块变实心），
 *      并校验 parent 是否存在（孤儿父级直接断开，否则整层不画）。
 */
function readScene(projectDir) {
  const raw = readMaybe(path.join(projectDir, 'scene.json'));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/** 收集某条 effect 依赖里的若非着色器文本 */
function effectShaderTexts(projectDir, effectFile, cache) {
  const effectRaw = readMaybe(path.join(projectDir, effectFile));
  if (!effectRaw) return [];
  let effect;
  try { effect = JSON.parse(effectRaw); } catch { return []; }
  const deps = Array.isArray(effect.dependencies) ? effect.dependencies : [];
  const out = [];
  for (const dep of deps) {
    if (!/\.(frag|vert)$/i.test(dep)) continue;
    const depPath = path.join(projectDir, dep);
    if (!cache.has(depPath)) cache.set(depPath, readMaybe(depPath) || '');
    const text = cache.get(depPath);
    if (text) out.push({ rel: dep, text });
  }
  return out;
}

/** 场景里是否用到了音频频谱（决定默认是否保留音频） */
function sceneUsesAudioSpectrum(projectDir) {
  const scene = readScene(projectDir);
  if (!scene || !Array.isArray(scene.objects)) return false;
  const cache = new Map();
  for (const obj of scene.objects) {
    const effects = Array.isArray(obj.effects) ? obj.effects : [];
    for (const e of effects) {
      if (!e || typeof e.file !== 'string') continue;
      const texts = effectShaderTexts(projectDir, e.file, cache);
      if (texts.some((t) => /g_AudioSpectrum\d+(?:Left|Right)/.test(t.text))) return true;
    }
  }
  return false;
}

function repairSceneCompat(projectDir, opts = {}) {
  const onLog = opts.onLog || (() => {});
  const scene = readScene(projectDir);
  if (!scene || !Array.isArray(scene.objects)) {
    return { removed: [], kept: [], warnings: [], repaired: [] };
  }

  const warnings = [];
  const repaired = [];
  const removed = [];
  const kept = [];
  const shaderCache = new Map();

  const isAudioReactive = (effectFile) => effectShaderTexts(projectDir, effectFile, shaderCache)
    .some((t) => /g_AudioSpectrum\d+(?:Left|Right)/.test(t.text));

  // ---- 1. 音频频谱层：优先保留（shader 已修可编译），修不好才退化 ----
  const objects = [];
  for (const obj of scene.objects) {
    const image = String(obj.image || '').replace(/\\/g, '/').toLowerCase();
    const effects = Array.isArray(obj.effects) ? obj.effects : [];
    const isSolid = image === 'models/util/solidlayer.json';
    const audioEffects = effects.filter((e) => e && typeof e.file === 'string' && isAudioReactive(e.file));
    if (!audioEffects.length) { objects.push(obj); continue; }

    // 改写后这些 effect 的 shader 是否仍然过不了移动端
    const unportable = audioEffects.some((e) => effectShaderTexts(projectDir, e.file, shaderCache)
      .some((t) => shadercompat.hasResidualDynamicArrayIndex(t.text)));

    if (isSolid && (opts.dropAudioLayers || unportable)) {
      removed.push({ id: obj.id, name: obj.name || '', reason: opts.dropAudioLayers ? '手动指定移除' : 'shader 仍不可移植' });
      const label = obj.name || `id ${obj.id}`;
      onLog(`  [场景] 移除音频频谱层「${label}」（${opts.dropAudioLayers ? '手动指定' : 'shader 改写后仍含移动端不接受的下标写法'}）`);
      continue;
    }
    kept.push({ id: obj.id, name: obj.name || '' });
    if (isSolid) onLog(`  [场景] 保留音频频谱层「${obj.name || obj.id}」（shader 已改写为移动端可编译写法）`);
    objects.push(obj);
  }

  // ---- 2. 移除时给子对象重挂父级，避免整层消失/错位 ----
  if (removed.length) {
    const goneIds = new Set(removed.map((r) => Number(r.id)));
    // 被移除对象本身已经不在 objects 里了，祖父层要从原始场景表里找
    const origById = new Map(scene.objects.map((o) => [Number(o.id), o]));
    for (const obj of objects) {
      if (obj.parent == null || !goneIds.has(Number(obj.parent))) continue;
      const victim = origById.get(Number(obj.parent));
      const grand = victim && victim.parent != null ? victim.parent : null;
      if (grand != null && !goneIds.has(Number(grand))) obj.parent = grand;
      else delete obj.parent;
      repaired.push({ id: obj.id, name: obj.name || '', action: 'parent-remap' });
      onLog(`  [场景] 子层「${obj.name || obj.id}」父级已移除，重挂到 ${grand != null ? grand : '根层'}`);
    }
    warnings.push(`已移除手机端不可兼容的音频频谱层${removed.map((r) => `「${r.name || `id ${r.id}`}」`).join('')}（该层 shader 在移动端编译失败会留下白色实心块）`);
  }

  // ---- 3. 叠加属性归一 + 孤儿父级检查 ----
  const ids = new Set(objects.map((o) => Number(o.id)));
  let changed = false;
  for (const obj of objects) {
    // alpha 是字符串时，移动端解析会走默认值 → 叠加层整块变实心
    if (typeof obj.alpha === 'string') {
      const n = Number(obj.alpha);
      if (Number.isFinite(n)) {
        obj.alpha = n;
        changed = true;
        repaired.push({ id: obj.id, name: obj.name || '', action: 'alpha-numeric' });
        onLog(`  [场景] 叠加层「${obj.name || obj.id}」alpha 已由字符串归一为数字 ${n}`);
      }
    }
    if (obj.parent != null && !ids.has(Number(obj.parent))) {
      delete obj.parent;
      changed = true;
      repaired.push({ id: obj.id, name: obj.name || '', action: 'orphan-parent-dropped' });
      onLog(`  [场景] 叠加层「${obj.name || obj.id}」的父层 ${obj.parent} 不存在，已断开到根层`);
    }
  }

  scene.objects = objects;
  if (removed.length || changed) {
    fs.writeFileSync(path.join(projectDir, 'scene.json'), JSON.stringify(scene, null, '\t'), 'utf8');
  }
  return { removed, kept, warnings, repaired };
}


/**
 * 手机端适配：纹理转换 + 着色器兼容改写
 * @param {{onLog?:Function, preset?:object|string, maxRgbaBytes?:number, checkpoint?:object}} opts
 * @returns {{warnings:string[], tex:object, shader:object, outcomes:Array}}
 */
/**
 * 定稿前的着色器复检：逐个文件比对「磁盘上的」与「按同一套规则改写后的」文本，
 * 不一致就写回。前面的解包/纹理阶段偶尔会把原始 shader 覆盖回来（实测 waterripple），
 * patchDir 已经跑过也没用，所以这里做一次幂等兜底。
 */
function verifyShaders(projectDir) {
  const stats = { fixed: 0, literals: 0, structural: 0 };
  const walk = (d) => {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const ent of ents) {
      const abs = path.join(d, ent.name);
      if (ent.isDirectory()) { walk(abs); continue; }
      if (!shadercompat.isShaderPath(ent.name)) continue;
      let src;
      try { src = fs.readFileSync(abs, 'utf8'); } catch { continue; }
      const rel = path.relative(projectDir, abs).split(path.sep).join('/');
      const r = shadercompat.rewriteAll(src, { relPath: rel });
      if (r.text === src) continue;
      fs.writeFileSync(abs, r.text);
      stats.fixed++;
      stats.literals += r.literalsChanged;
      stats.structural += r.structural;
    }
  };
  walk(projectDir);
  return stats;
}

/**
 * 找出所有 autosize 模型，以及「模型 -> 纹理」的对应关系。
 * 降采样后需要按纹理缩放倍率反向补偿图层的 scale，避免整层缩小、和其他图层错位。
 */
function collectAutosizeInfo(projectDir) {
  const models = new Map();
  const modelsDir = path.join(projectDir, 'models');
  if (!fs.existsSync(modelsDir)) return { models };

  const collectMaterial = (rel) => {
    if (!rel || typeof rel !== 'string') return [];
    const matPath = path.join(projectDir, rel.split('/').join(path.sep));
    let mat;
    try { mat = JSON.parse(fs.readFileSync(matPath, 'utf8')); } catch { return []; }
    const found = [];
    for (const pass of Array.isArray(mat.passes) ? mat.passes : []) {
      for (const t of Array.isArray(pass.textures) ? pass.textures : []) {
        // 一份 pass 里可能是 "texture" 或 "mask effects/xxx" 这种多项写法
        for (const token of String(t).split(/\s+/)) {
          if (!token) continue;
          const base = path.basename(token).replace(/\.tex$/i, '');
          if (!base) continue;
          found.push(`${base}.tex`);
        }
      }
    }
    return found;
  };

  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) { walk(abs); continue; }
      if (!ent.name.endsWith('.json')) continue;
      let model;
      try { model = JSON.parse(fs.readFileSync(abs, 'utf8')); } catch { continue; }
      if (!model || !model.autosize) continue;
      const texs = model.material ? collectMaterial(model.material) : [];
      const rel = path.relative(projectDir, abs).split(path.sep).join('/');
      models.set(rel, texs);
    }
  };
  walk(modelsDir);
  return { models };
}

/**
 * 纹理降采样后，把引用它的 autosize 图层的 scale 反向放大，保持场景里的显示大小不变。
 * 只处理普通的 "x y z" scale；带 script 的动态 scale 跳过，避免破坏动画。
 */
function compensateAutosizeScale(projectDir, info, outcomes) {
  if (!info.models.size || !outcomes.length) return 0;
  const factors = new Map();
  for (const o of outcomes) {
    if (!o.downsampled || !o.sourceWidth || !o.width) continue;
    const name = `${path.basename(o.path, '.tex')}.tex`;
    const f = o.sourceWidth / o.width;
    if (f > 1.0001) factors.set(name, f);
  }
  if (!factors.size) return 0;

  const scenePath = path.join(projectDir, 'scene.json');
  let scene;
  try { scene = JSON.parse(fs.readFileSync(scenePath, 'utf8')); } catch { return 0; }
  let adjusted = 0;
  const visit = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    if (typeof obj.image === 'string') {
      const key = obj.image.split('\\').join('/').replace(/^\.\//, '');
      const texs = info.models.get(key);
      if (texs && texs.length) {
        let factor = 1;
        for (const t of texs) factor = Math.max(factor, factors.get(t) || 1);
        if (factor > 1.0001) {
          if (typeof obj.scale === 'string') {
            const nums = obj.scale.trim().split(/\s+/).map(Number);
            if (nums.length >= 3 && nums.every(Number.isFinite)) {
              obj.scale = nums.map((n, i) => (i < 3 ? (n * factor).toFixed(5) : n)).join(' ');
              adjusted++;
            }
          } else if (obj.scale === undefined) {
            obj.scale = `${factor.toFixed(5)} ${factor.toFixed(5)} ${factor.toFixed(5)}`;
            adjusted++;
          }
        }
      }
    }
    for (const arr of ['objects', 'subobjects']) {
      if (Array.isArray(obj[arr])) for (const child of obj[arr]) visit(child);
    }
  };
  visit(scene);
  if (adjusted) fs.writeFileSync(scenePath, JSON.stringify(scene, null, '\t'), 'utf8');
  return adjusted;
}

/**
 * 把场景里「对象形式」的 visible 固化成布尔值。
 * PC 引擎能按 {user, value} 在运行时求值；手机端对对象形式支持不好，常把整个对象当成真，
 * 结果本应隐藏的主题/图层全部叠加显示（例如双主题模式下两套图层同时出现）。
 * 这里按当前属性值求值一次，保证导入后的画面和作者当前预设一致。
 * 带 script 的动态 visible 保持原样。
 */
function flattenSceneVisibility(projectDir, opts = {}) {
  const onLog = opts.onLog || (() => {});
  const scenePath = path.join(projectDir, 'scene.json');
  let scene;
  try { scene = JSON.parse(fs.readFileSync(scenePath, 'utf8')); } catch { return 0; }
  let props = {};
  try {
    const project = JSON.parse(fs.readFileSync(path.join(projectDir, 'project.json'), 'utf8'));
    props = (project.general && project.general.properties) || {};
  } catch { /* 没有 project.json 就只按 value 处理 */ }

  const propValue = (name) => {
    const p = props[name];
    return p && Object.prototype.hasOwnProperty.call(p, 'value') ? p.value : undefined;
  };
  const condMatches = (cond, val) => {
    const c = String(cond).trim();
    if (String(val) === c) return true;
    const m = c.match(/(?:.*\.value)?\s*(==|!=|=)\s*(.+)$/);
    if (m) {
      const rhs = m[2].trim().replace(/^['"]|['"]$/g, '');
      return m[1] === '!=' ? String(val) !== rhs : String(val) === rhs;
    }
    return false;
  };
  const resolve = (v) => {
    if (typeof v === 'boolean') return v;
    if (!v || typeof v !== 'object' || v.script) return undefined;
    if (typeof v.value !== 'boolean') return undefined;
    const user = v.user;
    if (typeof user === 'string') {
      const pv = propValue(user);
      if (pv === undefined) return v.value;
      return v.value && pv !== false && pv !== 'false';
    }
    if (user && typeof user === 'object' && !user.script) {
      const pv = propValue(user.name);
      if (pv === undefined || !user.condition) return v.value;
      return v.value && condMatches(user.condition, pv);
    }
    return v.value;
  };

  let changed = 0;
  let hidden = 0;
  const visit = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    if (Object.prototype.hasOwnProperty.call(obj, 'visible')) {
      const b = resolve(obj.visible);
      if (typeof b === 'boolean') {
        if (!b && obj.visible !== false) hidden++;
        if (b !== obj.visible) { obj.visible = b; changed++; }
      }
    }
    for (const arr of ['objects', 'subobjects']) {
      if (Array.isArray(obj[arr])) for (const child of obj[arr]) visit(child);
    }
  };
  visit(scene);
  if (changed) {
    fs.writeFileSync(scenePath, JSON.stringify(scene, null, '\t'), 'utf8');
    onLog(`  已固化 ${changed} 个图层可见性（其中隐藏 ${hidden} 个，避免双主题图层叠加）`);
  }
  return changed;
}

function adaptForMobile(projectDir, opts = {}) {
  const onLog = opts.onLog || (() => {});
  const onProgress = opts.onProgress || (() => {});
  const warnings = [];
  const textureTotal = Math.max(0, Number(opts.textureTotal) || 0);
  let textureDone = 0;
  const preset = typeof opts.preset === 'string' ? tex.presetOf(opts.preset) : (opts.preset || tex.presetOf('high'));
  onLog(`  画质档位: ${preset.label}（reduction=${preset.reduction}, maxDimension=${preset.maxDimension || '不限'}）`);

  onProgress({ phase: 'convert', done: 0, total: textureTotal, detail: '纹理转换' });
  const autosizeInfo = collectAutosizeInfo(projectDir);
  if (autosizeInfo.models.size) {
    onLog(`  autosize 图层 ${autosizeInfo.models.size} 个：降采样后会按比例补偿图层 scale`);
  }
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

  // 收尾再补一遍：前面解包/纹理阶段可能把原始 shader 又写回来（实测 waterripple 这类
  // 内置效果会被 reset），所以在定稿前按同一套规则重跑并校验，保证打进包里的就是改写后的文本
  const shaderVerify = verifyShaders(projectDir);
  if (shaderVerify.fixed) {
    onLog(`  着色器复检: 补回 ${shaderVerify.fixed} 个文件的改写`);
    shaderStats.rewritten += shaderVerify.fixed;
    shaderStats.literals += shaderVerify.literals;
    shaderStats.structural += shaderVerify.structural;
  }

  const dropped = repairSceneCompat(projectDir, { onLog, dropAudioLayers: opts.dropAudioLayers });
  warnings.push(...dropped.warnings);

  flattenSceneVisibility(projectDir, { onLog });
  const autoAdjusted = compensateAutosizeScale(projectDir, autosizeInfo, texRes.outcomes);
  if (autoAdjusted) onLog(`  已补偿 ${autoAdjusted} 个 autosize 图层的缩放，保持原始布局`);

  return { warnings, tex: texRes.stats, shader: shaderStats, outcomes: texRes.outcomes, droppedLayers: dropped.removed, sceneRepairs: dropped.repaired };
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
  const result = { removed: 0, bytes: 0, files: [], keptForAudioReactive: false };
  if (opts.preserveAudio) return result;
  // 音频频谱可视化层：手机端频谱数据来自音频管线（引擎侧 sendAudioData / g_AudioSpectrum*），
  // 把音频删了监听器就是一条平线、整层什么都画不出来 —— 这类场景默认保留音频。
  if (opts.autoKeepAudioReactive !== false && sceneUsesAudioSpectrum(projectDir)) {
    result.keptForAudioReactive = true;
    onLog('  音频保留：场景里有音频频谱可视化效果，删掉音频后频谱监听器收不到数据');
    return result;
  }
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
  const isTempWork = !opts.workDir && !opts.resume;
  if (opts.resume) {
    const stampFile = path.join(workDir, 'source-stamp.json');
    const stamp = sourceStamp(itemDir);
    let prev = null;
    try { prev = JSON.parse(fs.readFileSync(stampFile, 'utf8')).stamp || null; } catch { /* 首次续转 */ }
    if (!prev || prev !== stamp) {
      // 源条目换过（或旧版本没记录指纹）：清掉旧解包目录，避免陈旧资源混进新包
      onLog('  续转目录的源快照已变化，重新解包');
      try { fs.rmSync(path.join(workDir, 'project'), { recursive: true, force: true }); } catch { /* ignore */ }
    }
    try {
      fs.mkdirSync(workDir, { recursive: true });
      fs.writeFileSync(stampFile, JSON.stringify({ stamp, at: Date.now() }));
    } catch { /* 指纹写不了不影响主流程 */ }
  }
  let prepared;
  try {
  prepared = prepareProjectDir(itemDir, { workDir, onLog });
  for (const w of prepared.warnings) onLog(`  ⚠ ${w}`);
  onLog(`壁纸类型: ${prepared.type}`);

  const warnings = [...prepared.warnings, ...validateProject(prepared.projectDir, prepared.project, prepared.type)];

  // 打包前兼容性报告：先告诉用户会不会黑屏、显存大概多少，再去动纹理
  let compat = null;
  try {
    compat = require('./compat').inspect(prepared.projectDir, { type: prepared.type, preset });
    onLog(`兼容性 ${compat.level.toUpperCase()}: ${compat.summary}`);
    for (const w of compat.warnings) onLog(`  ⚠ ${w}`);
    for (const n of compat.notes) onLog(`  · ${n}`);
    onProgress({ phase: 'inspect', compat });
  } catch (e) {
    onLog(`  ⚠ 兼容性预检失败: ${e.message}`);
  }

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
  checkpoint.bind(`${preset.id}|v3|audio=${opts.preserveAudio ? 1 : 0}`);
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
    dropAudioLayers: !!opts.dropAudioLayers,
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
    compat,
    plan: summarizePlan(plan),
    planFile: keepWorkDir ? planFile : null,
    checkpointFile: keepWorkDir ? checkpointFile : null,
    workDir: keepWorkDir ? prepared.workDir : null,
    outcomes: adapted.outcomes,
  };
  } catch (e) {
    if (isTempWork) {
      try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    throw e;
  }
}

/** 续转用的稳定工作目录（按条目 id 区分，失败后可原地重跑） */
function stableWorkDir(id) {
  const dir = path.join(config.CACHE_DIR, 'pack-plan', safeFileName(id));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 源目录指纹：路径 + 大小 + mtime，源条目更新后不能复用旧的解包目录 */
function sourceStamp(dir) {
  const h = crypto.createHash('sha1');
  for (const f of listFiles(dir)) {
    try {
      const st = fs.statSync(f);
      h.update(path.relative(dir, f).split(path.sep).join('/'));
      h.update(`${st.size}:${st.mtimeMs}\n`);
    } catch { /* 读取中消失就算了 */ }
  }
  return h.digest('hex');
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
  checkpoint.bind(`${preset.id}|v3|audio=${opts.preserveAudio ? 1 : 0}`);
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
  stripAudio, pickMagic, stableWorkDir, repairSceneCompat, sceneUsesAudioSpectrum,
};

