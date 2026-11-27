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
const stats = { dxt: 0, lz4: 0, tex: 0, fallback: 0 };
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
  if (!tmpRoot) tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wempkg-rusttex-'));
  return tmpRoot;
}

function run(bin, args, timeout = 60000) {
  const out = execFileSync(bin, args, {
    encoding: 'utf8',
    timeout,
    maxBuffer: 1 << 20,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const line = out.trim().split('\n').pop();
  const info = JSON.parse(line);
  if (!info.ok) throw new Error(info.error || 'rust-tex 失败');
  return info;
}

function scratch(name) {
  return path.join(tmpDir(), `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
}

/** DXT 块解码 -> RGBA8；失败返回 null（调用方回落 JS） */
function dxtDecode(buf, fmtName, width, height) {
  const bin = locate();
  if (!bin) return null;
  const inFile = scratch('dxt.bin');
  const outFile = scratch('dxt.rgba');
  try {
    fs.writeFileSync(inFile, buf);
    run(bin, ['dxt-decode', inFile, outFile, '--format', fmtName, '--width', String(width), '--height', String(height)]);
    stats.dxt++;
    return fs.readFileSync(outFile);
  } catch {
    stats.fallback++;
    return null;
  } finally {
    for (const f of [inFile, outFile]) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
  }
}

function lz4Compress(buf) {
  const bin = locate();
  if (!bin) return null;
  const inFile = scratch('lz4-in.bin');
  const outFile = scratch('lz4-out.lz4');
  try {
    fs.writeFileSync(inFile, buf);
    run(bin, ['lz4-compress', inFile, outFile]);
    stats.lz4++;
    return fs.readFileSync(outFile);
  } catch {
    stats.fallback++;
    return null;
  } finally {
    for (const f of [inFile, outFile]) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
  }
}

function lz4Decompress(buf, expectedSize) {
  const bin = locate();
  if (!bin) return null;
  const inFile = scratch('lz4-c.bin');
  const outFile = scratch('lz4-d.bin');
  try {
    fs.writeFileSync(inFile, buf);
    run(bin, ['lz4-decompress', inFile, outFile, '--size', String(expectedSize)]);
    stats.lz4++;
    return fs.readFileSync(outFile);
  } catch {
    stats.fallback++;
    return null;
  } finally {
    for (const f of [inFile, outFile]) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
  }
}

/**
 * 整包 tex 转换（非直通图路径：parse -> 解码 -> 裁 -> 缩放 -> 写 TEXB0004 -> 自校验）。
 * scale 由调用方按整包统一倍率算好传进来，保持 JS 侧单一事实来源。
 */
function texConvert(buf, scale, framesTail) {
  const bin = locate();
  if (!bin) return null;
  const inFile = scratch('tex-in.tex');
  const outFile = scratch('tex-out.tex');
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
  } catch {
    stats.fallback++;
    return null;
  } finally {
    for (const f of [inFile, outFile]) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
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
  info,
  stats,
  locate,
  dxtDecode,
  lz4Compress,
  lz4Decompress,
  texConvert,
  // 测试用：重置探测缓存
  _reset() { probe = undefined; },
  MIN_PIXELS_FOR_RUST: 4096,
  MIN_BYTES_FOR_LZ4: 4096,
};
