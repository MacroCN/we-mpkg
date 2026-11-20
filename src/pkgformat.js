'use strict';
/**
 * Wallpaper Engine 容器格式（.pkg / .mpkg）编解码。
 *
 * 容器结构（桌面版 PKGV0024 与手机版 PKGM0020 完全一致，只有 magic 不同）：
 *   [int32 长度][magic 字符串]                  // "PKGV0024" / "PKGM0020"
 *   [int32 条目数]
 *   N × ( [int32 路径长度][路径 UTF-8][int32 offset][int32 length] )   // offset 相对数据区起点
 *   [数据区]
 *
 * 参考：nxdyy/pkg2mpkg 的读写实现。
 */
const fs = require('fs');
const path = require('path');

const MAGIC_PC = 'PKGV0024';
const MAGIC_MOBILE = 'PKGM0020';

function readInt32(buf, off) {
  if (off + 4 > buf.length) throw new Error(`容器头部越界（offset=${off}）`);
  return buf.readInt32LE(off);
}

function readSizedString(buf, off) {
  const len = readInt32(buf, off);
  if (len < 0 || len > 8192) throw new Error(`非法的字符串长度 ${len}（offset=${off}），可能不是 PKG/MPKG 文件`);
  const start = off + 4;
  if (start + len > buf.length) throw new Error('字符串越界，文件可能已损坏');
  return { value: buf.subarray(start, start + len).toString('utf8'), next: start + len };
}

/**
 * 解析 PKG/MPKG
 * @param {Buffer|string} input Buffer 或文件路径
 * @returns {{magic:string, entryCount:number, dataStart:number, entries:Array<{path:string,offset:number,length:number,data:Buffer}>}}
 */
function parsePkg(input) {
  const buf = Buffer.isBuffer(input) ? input : fs.readFileSync(input);
  const magic = readSizedString(buf, 0);
  if (!/^PKG[VM]\d{4}$/.test(magic.value)) {
    throw new Error(`不认识的容器 magic: "${magic.value}"`);
  }
  let off = magic.next;
  const entryCount = readInt32(buf, off);
  off += 4;
  if (entryCount < 0 || entryCount > 200000) throw new Error(`条目数异常: ${entryCount}`);
  const entries = [];
  for (let i = 0; i < entryCount; i++) {
    const p = readSizedString(buf, off);
    off = p.next;
    const offset = readInt32(buf, off);
    const length = readInt32(buf, off + 4);
    off += 8;
    entries.push({ index: i, path: p.value, offset, length, data: null });
  }
  const dataStart = off;
  for (const e of entries) {
    if (e.offset < 0 || e.length < 0) throw new Error(`条目 ${e.path} 的 offset/length 非法`);
    const abs = dataStart + e.offset;
    if (abs + e.length > buf.length) {
      throw new Error(`条目 ${e.path} 数据越界（需要 ${abs + e.length} 字节，实际 ${buf.length}）`);
    }
    e.data = buf.subarray(abs, abs + e.length);
  }
  return { magic: magic.value, entryCount, dataStart, entries, buffer: buf };
}

function writeSizedString(s) {
  const b = Buffer.from(s, 'utf8');
  const head = Buffer.alloc(4);
  head.writeInt32LE(b.length, 0);
  return Buffer.concat([head, b]);
}

/**
 * 组装容器
 * @param {string} magic
 * @param {Array<{path:string,data:Buffer}>} entries
 */
function buildPkg(magic, entries) {
  if (!/^PKG[VM]\d{4}$/.test(magic)) throw new Error(`非法 magic: ${magic}`);
  const headerParts = [writeSizedString(magic)];
  const count = Buffer.alloc(4);
  count.writeInt32LE(entries.length, 0);
  headerParts.push(count);

  let dataOffset = 0;
  const dataParts = [];
  for (const e of entries) {
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data);
    const head = [writeSizedString(normalizeEntryPath(e.path))];
    const off = Buffer.alloc(4);
    off.writeInt32LE(dataOffset, 0);
    const len = Buffer.alloc(4);
    len.writeInt32LE(data.length, 0);
    head.push(off, len);
    headerParts.push(...head);
    dataParts.push(data);
    dataOffset += data.length;
  }
  return Buffer.concat([...headerParts, ...dataParts]);
}

/** 统一用正斜杠，去掉危险片段 */
function normalizeEntryPath(p) {
  return String(p).replace(/\\/g, '/').replace(/^\/+/, '');
}

/** 防止路径穿越：拒绝绝对路径、盘符、.. */
function safeJoin(baseDir, relPath) {
  const cleaned = normalizeEntryPath(relPath);
  const parts = cleaned.split('/').filter((s) => s && s !== '.');
  if (parts.some((s) => s === '..') || /^[a-zA-Z]:/.test(cleaned)) {
    throw new Error(`条目路径不安全，拒绝写入: ${relPath}`);
  }
  const target = path.resolve(baseDir, parts.join(path.sep));
  const base = path.resolve(baseDir);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error(`条目路径逃逸出目标目录: ${relPath}`);
  }
  return target;
}

/** 解包到目录 */
function extractPkg(input, outDir, opts = {}) {
  const pkg = parsePkg(input);
  const files = [];
  fs.mkdirSync(outDir, { recursive: true });
  for (const e of pkg.entries) {
    const dest = safeJoin(outDir, e.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, e.data);
    files.push({ path: e.path, dest, size: e.length });
  }
  return { magic: pkg.magic, entryCount: pkg.entryCount, files, outDir };
}

/** 把目录打成容器（不写文件，返回 Buffer） */
function packDirToBuffer(dir, magic = MAGIC_MOBILE, opts = {}) {
  const list = walk(dir, opts);
  const entries = list.map((abs) => ({
    path: path.relative(dir, abs).split(path.sep).join('/'),
    data: fs.readFileSync(abs),
  }));
  // project.json 放最前面，部分实现依赖这个顺序
  entries.sort((a, b) => {
    if (a.path === 'project.json') return -1;
    if (b.path === 'project.json') return 1;
    // 用码位比较而不是 localeCompare：后者随语言环境变化，会让不同平台产出不同顺序
    return a.path < b.path ? -1 : (a.path > b.path ? 1 : 0);
  });
  const buf = buildPkg(magic, entries);
  return { buffer: buf, entries: entries.map((e) => ({ path: e.path, size: e.data.length })) };
}

function walk(dir, opts = {}) {
  const out = [];
  const ents = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of ents) {
    const abs = path.join(dir, ent.name);
    if (ent.isSymbolicLink()) continue;
    if (ent.isDirectory()) {
      out.push(...walk(abs, opts));
    } else if (ent.isFile()) {
      if (opts.skip && opts.skip(ent.name, abs)) continue;
      out.push(abs);
    }
  }
  return out;
}

module.exports = {
  MAGIC_PC,
  MAGIC_MOBILE,
  parsePkg,
  buildPkg,
  extractPkg,
  packDirToBuffer,
  normalizeEntryPath,
  safeJoin,
};
