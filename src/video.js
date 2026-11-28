'use strict';
/**
 * 视频转码工具：画质档位按「最长边」缩放到目标尺寸。
 *
 * 之前视频纹理只有固定 1920 上限，均衡/流畅会把图片缩小，却不会动视频；
 * video 类型里的原始 mp4 更是完全没经过转码。这里把两边统一到同一套
 * 目标尺寸规则，并优先使用 ffmpeg 的 MediaCodec 硬件 H.264 编码器。
 */
const fs = require('fs');
const ffmpegHelp = require('./ffmpeg');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const VIDEO_EXT = new Set(['.mp4', '.webm', '.avi', '.wmv', '.mkv', '.mov', '.m4v']);
const DEFAULT_VIDEO_MAX_WIDTH = 1920;
const PRESETS = {
  high: { id: 'high', reduction: 1, maxDimension: 4096 },
  balanced: { id: 'balanced', reduction: 2, maxDimension: 2048 },
  smooth: { id: 'smooth', reduction: 4, maxDimension: 1024 },
  original: { id: 'original', reduction: 1, maxDimension: 0 },
};

function videoMaxWidth(opts = {}) {
  const raw = opts.videoMaxWidth !== undefined
    ? opts.videoMaxWidth
    : process.env.WE_MPKG_VIDEO_MAX_WIDTH;
  if (raw === undefined || raw === null || raw === '') return DEFAULT_VIDEO_MAX_WIDTH;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_VIDEO_MAX_WIDTH;
}

/** 目标最长边：0 表示原样保留。high 仍受 1920 上限约束，balanced/smooth 再按 1/2、1/4 缩。 */
function targetLongEdge(width, height, preset, opts = {}) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  const long = Math.max(w, h);
  if (typeof preset === 'string') preset = PRESETS[preset] || PRESETS.high;
  if (!preset) preset = PRESETS.high;
  if (long <= 0 || preset.id === 'original') return 0;
  let target = long;
  if (preset.reduction > 1) target = long / preset.reduction;
  if (preset.maxDimension) target = Math.min(target, preset.maxDimension);
  const cap = videoMaxWidth(opts);
  if (cap > 0) target = Math.min(target, cap);
  target = Math.floor(target / 2) * 2;
  return target > 0 && target < long ? target : 0;
}

function isAndroidRuntime(ffmpeg) {
  return process.platform === 'android'
    || process.env.WEM_ANDROID === '1'
    || /libffmpeg\.so$/.test(String(ffmpeg || ''));
}

function nativeLibDirs() {
  const dirs = [];
  for (const d of [process.env.WEM_NATIVE_LIB_DIR, nativeLibDirFromMaps()]) {
    if (d && !dirs.includes(d)) dirs.push(d);
  }
  // Android 的 nativeLibraryDir 有时给的是 .../lib 根目录，真实库在同级 arm64 子目录。
  for (const d of [...dirs]) {
    for (const sub of ['arm64', 'arm64-v8a', 'aarch64']) {
      const p = path.join(d, sub);
      if (!dirs.includes(p)) dirs.push(p);
    }
  }
  return dirs;
}

function nativeLibDebug() {
  const all = nativeLibDirs();
  if (!all.length) return 'nativeLibraryDir=未知';
  const dirs = all.filter((d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
  return (dirs.length ? dirs : all).map((dir) => {
    let names = '';
    try { names = fs.readdirSync(dir).filter((f) => f.endsWith('.so')).join(','); } catch { names = '不可读'; }
    return `${dir} [${names || '空'}]`;
  }).join(' | ');
}

function nativeLibDirFromMaps() {
  try {
    // Android 上 libnode.so / libwempkg-node.so 一定被映射进进程，
    // 从 /proc/self/maps 反推 nativeLibraryDir，避免只依赖 JNI 传进来的环境变量。
    const maps = fs.readFileSync('/proc/self/maps', 'utf8');
    const m = maps.match(/(\/[^\s]+)\/lib(?:node|wempkg-node)\.so/);
    return m ? path.dirname(m[1]) : null;
  } catch {
    return null;
  }
}

function ffmpegCandidates(opts = {}) {
  const nativeCandidates = nativeLibDirs().map((dir) => path.join(dir, 'libffmpeg.so'));
  return [
    opts.ffmpeg,
    process.env.WEM_FFMPEG,
    ...nativeCandidates,
    process.env.FFMPEG,
    // 只用新版（用户自带 / 官方 9.x 构建 / 安卓预编译 libffmpeg.so 的那份）。
    // 工坊里的媒体文件不可信：旧版 ffmpeg 会把多年积累的已知容器/解码器漏洞
    // 暴露给用户，所以这里不留任何旧版兜底——
    // 找不到就报错并给出下载地址（见 src/ffmpeg.js）。
    path.join(__dirname, '..', '.cache', 'toolchain', 'ffmpeg', 'bin', 'ffmpeg.exe'),
    path.join(__dirname, '..', 'tools', 'ffmpeg', 'ffmpeg.exe'),
    path.join(__dirname, '..', 'bin', 'ffmpeg.exe'),
    path.join(__dirname, '..', '.cache', 'toolchain', 'ffmpeg', 'bin', 'ffmpeg'),
    path.join(__dirname, '..', 'tools', 'ffmpeg', 'ffmpeg'),
  ];
}

function findFfmpeg(opts = {}) {
  for (const p of ffmpegCandidates(opts)) {
    if (!p) continue;
    try { if (fs.existsSync(p) && fs.statSync(p).isFile()) return p; } catch { /* ignore */ }
  }
  const whereNames = process.platform === 'win32'
    ? ['where.exe', path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'where.exe')]
    : ['which'];
  for (const exe of whereNames) {
    try {
      const out = execFileSync(exe, [process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'], { encoding: 'utf8' });
      const first = out.split(/\r?\n/)[0].trim();
      if (first && fs.existsSync(first)) return first;
    } catch { /* 试下一个 */ }
  }
  return null;
}

/** 从 ffmpeg 的 stderr 里读「Stream #0:0 ... 1920x1080」 */
function parseVideoDims(text) {
  const m = /Video:.*?(\d{2,5})x(\d{2,5})/.exec(String(text || ''));
  if (!m) return null;
  return { width: parseInt(m[1], 10), height: parseInt(m[2], 10) };
}

function probeVideoDims(ffmpeg, file, opts = {}) {
  try {
    const out = execFileSync(ffmpeg, ['-hide_banner', '-i', file], {
      stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 30000, windowsHide: true,
    });
    return parseVideoDims(out);
  } catch (e) {
    // ffmpeg -i 不带输出文件时固定以 1 退出，尺寸信息在 stderr 里
    const text = (e && (e.stderr || e.stdout)) || '';
    const dims = parseVideoDims(text);
    if (!dims && opts.onLog) {
      const first = String(text || e.message || '').split('\n').find((l) => l.trim()) || '无法执行 ffmpeg';
      opts.onLog(`  ffmpeg 探测视频失败: ${first.trim().slice(0, 240)}`);
    }
    return dims;
  }
}

function scaleFilter(width, height, target) {
  // 按最长边锁：横屏锁 width，竖屏锁 height，另一边自动偶数。
  return height > width
    ? `scale=-2:${target}:flags=lanczos`
    : `scale=${target}:-2:flags=lanczos`;
}

function encoderArgs(ffmpeg) {
  if (isAndroidRuntime(ffmpeg)) {
    // Android 预编译 ffmpeg 走 MediaCodec 硬件 H.264 编码，不依赖 libx264/GPL。
    return ['-c:v', 'h264_mediacodec', '-b:v', '4M', '-pix_fmt', 'yuv420p'];
  }
  return ['-c:v', 'libx264', '-profile:v', 'baseline', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '20'];
}

function runTranscode(ffmpeg, src, dst, width, height, target, opts = {}) {
  execFileSync(ffmpeg, [
    '-y', '-loglevel', 'error',
    '-i', src,
    '-an',
    '-vf', scaleFilter(width, height, target),
    ...encoderArgs(ffmpeg),
    '-movflags', '+faststart',
    dst,
  ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, timeout: 10 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 });
  if (!fs.existsSync(dst) || fs.statSync(dst).size < 24) throw new Error('转码产物为空');
  const head = fs.readFileSync(dst).subarray(4, 8).toString('latin1');
  if (head !== 'ftyp') throw new Error('转码产物不是有效的 MP4');
  return probeVideoDims(ffmpeg, dst) || {
    width: height > width ? Math.max(2, Math.round(width * target / height / 2) * 2) : target,
    height: height > width ? target : Math.max(2, Math.round(height * target / width / 2) * 2),
  };
}

/**
 * 可写的临时根目录。
 *
 * 安卓上 os.tmpdir() 在 TMPDIR 没进 node 进程时会退回 /tmp，而 /tmp 在安卓是
 * 只读根目录（应用域写它一律 EACCES），视频转码当场失败。所以这里不相信单个
 * 来源：候选逐个 mkdir + 写权限验证，第一个能用就用。
 *
 * `.cache/pkg-tmp` 落在工程目录里（安卓是 filesDir，必然可写），且名字带 pkg-
 * 前缀，会被 cachegc 当临时目录回收。
 */
function tempRoot() {
  const candidates = [
    process.env.WEM_TMPDIR,
    process.env.TMPDIR,
    path.join(__dirname, '..', '.cache', 'pkg-tmp'),
    os.tmpdir(),
  ];
  for (const dir of candidates) {
    if (!dir) continue;
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      return dir;
    } catch { /* 换下一个候选 */ }
  }
  return os.tmpdir();
}

/**
 * 把内存里的视频载荷缩到目标最长边，输出独立 MP4。
 * @returns {{mp4:Buffer,width:number,height:number}|null}
 */
function transcodeBuffer(buf, { width, height, target, ffmpeg, opts = {} }) {
  if (!buf || !target || target <= 0 || !ffmpeg) return null;
  const tmp = fs.mkdtempSync(path.join(tempRoot(), 'wempkg-video-'));
  try {
    const isWebm = buf.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    const src = path.join(tmp, 'in' + (isWebm ? '.webm' : '.mp4'));
    const dst = path.join(tmp, 'out.mp4');
    fs.writeFileSync(src, buf);
    const dims = runTranscode(ffmpeg, src, dst, width, height, target, opts);
    return { mp4: fs.readFileSync(dst), width: dims.width, height: dims.height };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

/**
 * 转码 video 类型 mpkg 的 project.json 指向的原始视频。
 * 输出沿用原文件名（非 mp4 容器改成同名 .mp4，并同步改 project.json）。
 */
function transcodeProjectVideo(projectDir, preset, opts = {}) {
  const onLog = opts.onLog || (() => {});
  const warnings = [];
  let project;
  try {
    project = JSON.parse(fs.readFileSync(path.join(projectDir, 'project.json'), 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return { changed: false, warnings };
  }
  const rel = typeof project.file === 'string' ? project.file.replace(/\\/g, '/') : '';
  if (!rel || !VIDEO_EXT.has(path.extname(rel).toLowerCase())) return { changed: false, warnings };
  const src = path.resolve(projectDir, rel);
  if (!src.startsWith(path.resolve(projectDir) + path.sep) || !fs.existsSync(src)) {
    warnings.push(`video 类型项目引用的视频不存在: ${rel}`);
    return { changed: false, warnings };
  }

  const ffmpeg = opts.ffmpeg || findFfmpeg(opts);
  if (!ffmpeg) {
    // 桌面端没有内置 ffmpeg：明确告诉用户去哪下、放哪里，不做静默降级
    warnings.push(`video 类型视频需要降分辨率，但本机没找到 ffmpeg，原样保留: ${rel} —— ${ffmpegHelp.missingHelpShort()}`);
    if (opts.onLog) opts.onLog(`  ${ffmpegHelp.missingHelp()}`);
    return { changed: false, warnings };
  }
  const dims = probeVideoDims(ffmpeg, src, opts);
  const target = targetLongEdge(dims && dims.width, dims && dims.height, preset, opts);
  if (!dims) {
    warnings.push(`无法读取视频尺寸，跳过转码: ${rel}`);
    return { changed: false, warnings };
  }
  if (!target) {
    onLog(`  视频 ${rel} ${dims.width}x${dims.height}，当前画质档位无需降分辨率`);
    return { changed: false, warnings };
  }

  const ext = path.extname(rel).toLowerCase();
  const outRel = (ext === '.mp4' || ext === '.m4v') ? rel : rel.replace(/\.(webm|avi|wmv|mkv|mov)$/i, '.mp4');
  const out = path.resolve(projectDir, outRel);
  const tmp = out + '.tmp.mp4';
  try {
    const res = runTranscode(ffmpeg, src, tmp, dims.width, dims.height, target, opts);
    if (outRel === rel) {
      fs.copyFileSync(tmp, src);
    } else {
      fs.renameSync(tmp, out);
      fs.rmSync(src, { force: true });
      project.file = outRel;
      fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify(project, null, 2));
    }
    if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true });
    onLog(`  视频 ${rel} ${dims.width}x${dims.height} -> ${res.width}x${res.height}（${isAndroidRuntime(ffmpeg) ? 'MediaCodec' : 'libx264'}）`);
    return { changed: true, warnings, from: dims, to: res, file: outRel };
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
    const msg = String((e && e.message) || e).split('\n')[0];
    warnings.push(`视频转码失败，原样保留: ${rel}（${msg}）`);
    return { changed: false, warnings };
  }
}

module.exports = {
  VIDEO_EXT,
  videoMaxWidth,
  targetLongEdge,
  findFfmpeg,
  ffmpegCandidates,
  probeVideoDims,
  tempRoot,
  transcodeBuffer,
  transcodeProjectVideo,
  isAndroidRuntime,
};
