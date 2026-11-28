/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 MacroCN
 */
'use strict';
/**
 * rust-tex CLI 桥（阶段 1：DXT 解码 + LZ4 块编解码）。
 *
 * 调用方式完全对齐 ffmpeg：execFileSync + 参数数组，输入输出走临时文件，
 * 结果从 stdout 的 JSON 读。找不到可执行文件、版本不对、或执行失败时，
 * 调用方一律回落到纯 JS 实现，属于零风险灰度。
 *
 * 探测顺序（第一个能跑通的胜出）：
 *   1. 环境变量 WE_RUST_TEX（显式指定）
 *   2. 仓库 bin/rust-tex[.exe]（打包时随应用附带）
 *   3. rust/target/release/rust-tex[.exe]（本地 cargo build 产物）
 *   4. .cache/toolchain/bin/rust-tex[.exe]
 *   5. PATH 里的 rust-tex
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const EXE = process.platform === 'win32' ? 'rust-tex.exe' : 'rust-tex';
const MIN_VERSION = 3;

let probe; // undefined = 未探测；null = 没有；string = 路径
/** 本次运行实际走 Rust 的次数（给「纹理加速引擎」状态显示用） */
const stats = { dxt: 0, lz4: 0, tex: 0, png: 0, jpeg: 0 };
let binVersion = null;
let lastError = null;
let attempts = [];

/**
 * 安卓的原生库目录：优先用 JNI 传的 WEM_NATIVE_LIB_DIR，没有就从 /proc/self/maps 里
 * 反查 libnode.so 的加载路径（预编译的 libwempkg-node.so 可能没设置这个环境变量）。
 */
function androidNativeDirs() {
  const dirs = [];
  const add = (d) => { if (d && dirs.indexOf(d) === -1) dirs.push(d); };
  if (process.env.WEM_NATIVE_LIB_DIR) add(process.env.WEM_NATIVE_LIB_DIR);
  if (process.platform === 'android') {
    try {
      const maps = fs.readFileSync('/proc/self/maps', 'utf8');
      for (const line of maps.split('\n')) {
        const m = line.match(/(\/\S*\/lib\/[^/]+\/libnode\.so)/);
        if (m) add(path.dirname(m[1]));
      }
    } catch { /* ignore */ }
  }
  for (const d of String(process.env.LD_LIBRARY_PATH || '').split(':')) add(d);
  return dirs;
}

function candidates() {
  const out = [];
  // 安卓：nativeLibraryDir 里的 .so 是安装时解出来的可执行文件，先试这里
  for (const dir of androidNativeDirs()) {
    out.push(path.join(dir, 'librusttex.so'));
    out.push(path.join(dir, EXE));
  }
  const env = process.env.WE_RUST_TEX;
  if (env) out.push(env);
  out.push(path.join(__dirname, '..', 'bin', EXE));
  out.push(path.join(__dirname, '..', 'rust', 'tex-cli', 'target', 'release', EXE));
  out.push(path.join(__dirname, '..', '.cache', 'toolchain', 'bin', EXE));
  if (process.env.PATH) {
    const sep = process.platform === 'win32' ? ';' : ':';
    for (const dir of process.env.PATH.split(sep)) {
      if (dir) out.push(path.join(dir, EXE));
    }
  }
  // 安卓：应用数据目录禁止 exec（targetSdk 36），nativeLibraryDir 是唯一合法位置，
  // 这里保留 LD_LIBRARY_PATH 作为兜底。
  if (process.platform === 'android' || process.env.LD_LIBRARY_PATH) {
    for (const dir of String(process.env.LD_LIBRARY_PATH || '').split(':')) {
      if (!dir) continue;
      out.push(path.join(dir, 'librusttex.so'));
      out.push(path.join(dir, EXE));
    }
  }
  return out;
}

function usable(file) {
  const rec = { path: file, ok: false, error: null };
  attempts.push(rec);
  try {
    if (!fs.statSync(file).isFile()) return false;
    // 安卓解包出来的文件没有执行位，补一下（失败就算了，exec 会报错回落 JS）
    if (process.platform !== 'win32') { try { fs.chmodSync(file, 0o755); } catch { /* ignore */ } }
    const out = execFileSync(file, ['version'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
    const info = JSON.parse(out.trim().split('\n').pop());
    const ok = info && info.ok === true && Number(info.version.split('.')[0]) >= MIN_VERSION;
    if (ok) { binVersion = info.version; rec.ok = true; }
    else rec.error = '版本不符或输出异常';
    return ok;
  } catch (e) {
    rec.error = (e && e.message) || String(e);
    if (!lastError) lastError = `${file}: ${rec.error}`;
    return false;
  }
}

/** 返回可用的 rust-tex 路径，没有就 null（结果缓存） */
function locate() {
  if (probe !== undefined) return probe;
  probe = null;
  attempts = [];
  if (process.env.WE_TEX_RUST === 'off') return probe;
  for (const file of candidates()) {
    if (usable(file)) { probe = file; break; }
  }
  return probe;
}

function available() {
  return locate() !== null;
}

/** 显式开关：WE_TEX_RUST=off 只给回归测试对照 JS 实现用，生产路径不该走它 */
function enabled() {
  return locate() !== null;
}

/** 取可执行文件；没有就直接报错，不再静默回落 JS */
function requireEngine() {
  const bin = locate();
  if (!bin) {
    throw new Error('未找到可用的 rust-tex（Rust 纹理引擎是必需组件）：'
      + '请先 cargo build --release --manifest-path rust/tex-cli/Cargo.toml，'
      + '或用 WE_RUST_TEX 指定可执行文件路径' + (lastError ? `；上次探测: ${lastError}` : ''));
  }
  return bin;
}

/** 把 rust-tex 的失败包成明确错误（不再返回 null 让调用方悄悄退回 JS） */
function engineError(cmd, e) {
  const msg = (e && e.message) || String(e);
  return new Error(`rust-tex ${cmd} 失败: ${msg}`);
}

/** 引擎状态：给界面/日志显示「纹理加速引擎: Rust/JS」 */
function info() {
  const bin = locate();
  return {
    enabled: !!bin,
    engine: bin ? 'Rust' : 'JS',
    path: bin || null,
    version: bin ? binVersion : null,
    error: bin ? null : lastError,
    attempts: attempts.slice(0, 6),
    stats: { ...stats },
    minPixels: 4096,
  };
}

let tmpRoot = null;
function tmpDir() {
  if (tmpRoot) return tmpRoot;
  // 安卓规范：临时文件放应用私有 cacheDir（context.getCacheDir()）。
  // 环境变量可能因为旧 JNI 没设上，这里按「JNI 约定变量 → 从项目路径反推应用 cacheDir
  // → 项目 .cache → 系统临时目录」的顺序找，都失败就放弃（回落 JS），绝不往 /tmp 写。
  const projectRoot = path.resolve(__dirname, '..');            // <files>/nodejs-project
  const filesDir = path.resolve(projectRoot, '..');             // <files>
  const appRoot = path.resolve(filesDir, '..');                 // /data/data/<pkg>
  const bases = [
    process.env.WEM_CACHE_DIR,
    process.env.TMPDIR, process.env.TEMP, process.env.TMP,
    path.join(appRoot, 'cache'),                                // 安卓标准的应用 cache 目录
    path.join(projectRoot, '.cache'),
    process.cwd() ? path.join(process.cwd(), '.cache') : null,
  ];
  // 桌面/测试环境才把系统临时目录作为最后兜底
  if (process.platform !== 'android') bases.push(os.tmpdir());
  for (const base of bases) {
    if (!base) continue;
    try {
      tmpRoot = fs.mkdtempSync(path.join(base, 'wempkg-rusttex-'));
      return tmpRoot;
    } catch { /* 换下一个 */ }
  }
  return null;
}

function run(bin, args, timeout = 60000) {
  let out;
  try {
    out = execFileSync(bin, args, {
      encoding: 'utf8',
      timeout,
      maxBuffer: 1 << 20,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    // rust-tex 失败时会把 {"ok":false,"error":"..."} 打到 stdout，优先用里面的原因
    const text = String((e && e.stdout) || '').trim() || String((e && e.stderr) || '').trim();
    const line = text.split('\n').filter(Boolean).pop() || '';
    let reason = (e && e.message) || String(e);
    try {
      const info = JSON.parse(line);
      if (info && info.error) reason = info.error;
    } catch { /* 不是 JSON 就用原始错误 */ }
    throw new Error(reason);
  }
  const line = out.trim().split('\n').pop();
  const info = JSON.parse(line);
  if (!info.ok) throw new Error(info.error || 'rust-tex 失败');
  return info;
}

function scratch(name) {
  const root = tmpDir();
  if (!root) return null;
  return path.join(root, `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
}

/** DXT 块解码 -> RGBA8；失败返回 null（调用方回落 JS） */
function dxtDecode(buf, fmtName, width, height) {
  const bin = requireEngine();
  const inFile = scratch('dxt.bin');
  const outFile = scratch('dxt.rgba');
  if (!inFile || !outFile) return null;
  try {
    fs.writeFileSync(inFile, buf);
    run(bin, ['dxt-decode', inFile, outFile, '--format', fmtName, '--width', String(width), '--height', String(height)]);
    stats.dxt++;
    return fs.readFileSync(outFile);
  } catch (e) {
    throw engineError('调用', e);
  } finally {
    for (const f of [inFile, outFile]) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
  }
}

function lz4Compress(buf) {
  const bin = requireEngine();
  // 流式：stdin 传原始数据、stdout 收压缩结果，省掉一次写盘 + 一次读盘
  const r = require('child_process').spawnSync(bin, ['lz4-compress', '-', '-'], {
    input: buf,
    timeout: 120000,
    maxBuffer: buf.length + (buf.length >> 8) + (1 << 20), // LZ4 最坏膨胀 ~0.4%
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (r.error || r.status !== 0) {
    const detail = r.error ? r.error.message : (r.stderr ? String(r.stderr).trim().slice(0, 200) : `退出码 ${r.status}`);
    throw engineError('lz4-compress', detail);
  }
  let meta = null;
  try { meta = JSON.parse(String(r.stderr || '').trim().split('\n').pop()); } catch { meta = null; }
  if (!meta || meta.ok !== true || meta.outBytes !== r.stdout.length) {
    throw engineError('lz4-compress', '输出长度与元信息不符');
  }
  stats.lz4++;
  return r.stdout;
}

function lz4Decompress(buf, expectedSize) {
  const bin = requireEngine();
  const inFile = scratch('lz4-c.bin');
  const outFile = scratch('lz4-d.bin');
  if (!inFile || !outFile) return null;
  try {
    fs.writeFileSync(inFile, buf);
    run(bin, ['lz4-decompress', inFile, outFile, '--size', String(expectedSize)]);
    stats.lz4++;
    return fs.readFileSync(outFile);
  } catch (e) {
    throw engineError('调用', e);
  } finally {
    for (const f of [inFile, outFile]) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
  }
}

/**
 * PNG 解码 -> RGBA8（直通纹理路径）。走 stdin/stdout 管道：
 * RGBA 动辄几十 MB，落盘再读回比管道更慢，也少一次闪存写入。
 * 尺寸由调用方从 IHDR 读出后传进来，只用来校验输出长度。
 */
function pngDecode(buf, width, height) {
  const bin = requireEngine();
  const need = width * height * 4;
  if (!(need > 0) || need > 512 * 1024 * 1024) return null;
  try {
    const r = require('child_process').spawnSync(bin, ['png-decode', '-', '-'], {
      input: buf,
      maxBuffer: need + 65536,
      timeout: 120000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (r.error || r.status !== 0 || !r.stdout) {
      const detail = r.error ? r.error.message : (r.stderr ? r.stderr.toString().trim() : `退出码 ${r.status}`);
      throw engineError('png-decode', detail);
    }
    if (r.stdout.length !== need) {
      throw engineError('png-decode', `输出长度 ${r.stdout.length} != 期望 ${need}`);
    }
    stats.png++;
    return r.stdout;
  } catch (e) {
    if (e && e.message && e.message.startsWith('rust-tex')) throw e;
    throw engineError('png-decode', e);
  }
}

/**
 * JPEG 解码 -> RGBA8（直通纹理路径 / 直接解码）。同样走 stdin/stdout：
 * 尺寸在 Rust 侧算，JSON 从 stderr 取（stdout 只放像素）。
 */
function jpegDecode(buf) {
  const bin = requireEngine();
  try {
    const r = require('child_process').spawnSync(bin, ['jpeg-decode', '-', '-'], {
      input: buf,
      maxBuffer: 512 * 1024 * 1024 + 65536,
      timeout: 120000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (r.error || r.status !== 0 || !r.stdout) {
      const detail = r.error ? r.error.message : (r.stderr ? r.stderr.toString().trim() : `退出码 ${r.status}`);
      throw engineError('jpeg-decode', detail);
    }
    let meta = null;
    try {
      const lines = (r.stderr || '').toString().trim().split('\n');
      meta = JSON.parse(lines[lines.length - 1]);
    } catch { meta = null; }
    if (!meta || !(meta.width > 0) || !(meta.height > 0)) {
      throw engineError('jpeg-decode', '缺少尺寸信息');
    }
    if (r.stdout.length !== meta.width * meta.height * 4) {
      throw engineError('jpeg-decode', `输出长度 ${r.stdout.length} != 期望 ${meta.width * meta.height * 4}`);
    }
    stats.jpeg++;
    return { width: meta.width, height: meta.height, data: r.stdout };
  } catch (e) {
    if (e && e.message && e.message.startsWith('rust-tex')) throw e;
    throw engineError('jpeg-decode', e);
  }
}

/**
 * 整包 tex 转换（非直通图路径：parse -> 解码 -> 裁 -> 缩放 -> 写 TEXB0004 -> 自校验）。
 * scale 由调用方按整包统一倍率算好传进来，保持 JS 侧单一事实来源。
 */
function texConvert(buf, scale, framesTail) {
  const bin = requireEngine();
  const inFile = scratch('tex-in.tex');
  const outFile = scratch('tex-out.tex');
  if (!inFile || !outFile) return null;
  try {
    fs.writeFileSync(inFile, buf);
    const r = run(bin, ['tex-convert', inFile, outFile,
      '--scale', String(scale),
      '--frames-tail', framesTail ? '1' : '0'], 120000);
    stats.tex++;
    return {
      bytes: fs.readFileSync(outFile),
      width: r.width,
      height: r.height,
      downsampled: r.downsampled === true,
    };
  } catch (e) {
    throw engineError('调用', e);
  } finally {
    for (const f of [inFile, outFile]) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
  }
}


/**
 * 一批纹理一次转换：job 文件用 NUL 分隔的四元组（scale / framesTail / 输入 / 输出），
 * 一个进程跑完整个包，省掉每张图一次 exec 的固定成本。
 * 返回与 jobs 等长的数组，每项 {ok, width, height, downsampled, error}。
 */
function texConvertBatch(jobs, opts = {}) {
  const bin = requireEngine();
  if (!jobs || !jobs.length) return [];
  const jobFile = scratch('tex-batch.job');
  if (!jobFile) throw engineError('tex-batch', '无法创建临时目录');
  const chunks = [];
  for (const j of jobs) {
    chunks.push(Buffer.from(String(j.scale), 'utf8'), Buffer.alloc(1));
    chunks.push(Buffer.from(j.framesTail ? '1' : '0', 'utf8'), Buffer.alloc(1));
    chunks.push(Buffer.from(j.inPath, 'utf8'), Buffer.alloc(1));
    chunks.push(Buffer.from(j.outPath, 'utf8'), Buffer.alloc(1));
  }
  fs.writeFileSync(jobFile, Buffer.concat(chunks));
  try {
    const argv = ['tex-batch', jobFile];
    if (opts.threads) argv.push('--threads', String(opts.threads));
    const r = require('child_process').spawnSync(bin, argv, {
      encoding: 'utf8',
      timeout: 600000,
      maxBuffer: 16 << 20,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (r.error || r.status !== 0) {
      const detail = r.error ? r.error.message : (r.stderr ? String(r.stderr).trim() : `退出码 ${r.status}`);
      throw new Error(detail);
    }
    stats.tex += jobs.length;
    const lines = String(r.stdout || '').trim().split('\n').filter(Boolean);
    const out = [];
    for (let i = 0; i < jobs.length; i++) {
      let rec = null;
      try { rec = JSON.parse(lines[i]); } catch { rec = null; }
      if (!rec || rec.ok !== true) out.push({ ok: false, error: (rec && rec.error) || '无输出' });
      else out.push({ ok: true, verified: rec.verified === true, width: rec.width, height: rec.height, downsampled: rec.downsampled === true, outBytes: rec.outBytes });
    }
    return out;
  } catch (e) {
    throw engineError('tex-batch', e);
  } finally {
    try { fs.unlinkSync(jobFile); } catch { /* ignore */ }
  }
}

/** 进程退出前清掉临时目录（失败也无所谓，系统会回收） */
function cleanup() {
  if (!tmpRoot) return;
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  tmpRoot = null;
}
process.on('exit', cleanup);

module.exports = {
  available,
  enabled,
  requireEngine,
  info,
  stats,
  locate,
  dxtDecode,
  lz4Compress,
  lz4Decompress,
  texConvert,
  texConvertBatch,
  pngDecode,
  jpegDecode,
  // 测试用：重置探测缓存
  _reset() { probe = undefined; },
};
