'use strict';
/**
 * 极简 ZIP 写入器（无需第三方依赖）。
 *
 * 用途：把「离线网页包」压成一个 zip 交给手机。zip 是手机端最通用的容器，
 * 文件管理器 / ZArchiver / 微信 都能直接处理，而 mpkg 只有壁纸引擎认识。
 *
 * 只做「写」：deflate（zlib.deflateRawSync）+ 中央目录 + EOCD，
 * 不支持 ZIP64（单文件 >4GB 或总包 >4GB 时直接报错，避免产出坏包）。
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/** 已经是压缩格式的文件：再 deflate 基本没收益，直接 store，省 CPU 也省时间 */
const STORE_EXT = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.webm', '.mp3', '.ogg', '.m4a',
  '.zip', '.gz', '.7z', '.woj', '.woff', '.woff2', '.ttf', '.otf', '.ktx', '.basis',
]);

// ---------- CRC32 ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

// ---------- DOS 时间 ----------
function dosTime(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const year = Math.max(1980, d.getFullYear());
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((Math.floor(d.getSeconds() / 2)) & 0x1f);
  const day = (((year - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f);
  return { time, date: day };
}

/**
 * 递归收集目录下的文件。
 * @returns {{abs:string, rel:string}[]} rel 用 / 分隔，不带前导斜杠
 */
function listFiles(dir, filter) {
  const out = [];
  const walk = (sub) => {
    let entries = [];
    try { entries = fs.readdirSync(sub, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const abs = path.join(sub, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!e.isFile()) continue;
      const rel = path.relative(dir, abs).split(path.sep).join('/');
      if (filter && !filter(rel, abs)) continue;
      out.push({ abs, rel });
    }
  };
  walk(dir);
  return out;
}

/**
 * 把目录打包成 zip Buffer。
 * @param {string} dir
 * @param {{filter?:Function, level?:number, comment?:string}} opts
 */
function zipDirToBuffer(dir, opts = {}) {
  const files = listFiles(dir, opts.filter);
  const level = Number.isFinite(opts.level) ? opts.level : 6;
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const f of files) {
    const data = fs.readFileSync(f.abs);
    const ext = path.extname(f.rel).toLowerCase();
    const store = STORE_EXT.has(ext);
    const method = store ? 0 : 8;
    const body = store ? data : zlib.deflateRawSync(data, { level });
    const crc = crc32(data);
    const stamp = dosTime(fs.statSync(f.abs).mtime);

    const nameBuf = Buffer.from(f.rel, 'utf8');
    const useUtf8 = /[^\x00-\x7f]/.test(f.rel);
    const flags = useUtf8 ? 0x0800 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);            // version needed
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);  // compressed size
    local.writeUInt32LE(data.length, 22);  // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);            // extra len

    const localBuf = Buffer.concat([local, nameBuf, body]);
    locals.push(localBuf);
    if (body.length > 0xffffffff || data.length > 0xffffffff || offset > 0xffffffff) {
      throw new Error('离线包超过 4GB，ZIP64 未支持');
    }

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);          // version made by
    central.writeUInt16LE(20, 6);          // version needed
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);          // extra len
    central.writeUInt16LE(0, 32);          // comment len
    central.writeUInt16LE(0, 34);          // disk number
    central.writeUInt16LE(0, 36);          // internal attrs
    central.writeUInt32LE(0, 38);          // external attrs
    central.writeUInt32LE(offset, 42);     // local header offset
    centrals.push(Buffer.concat([central, nameBuf]));

    offset += localBuf.length;
  }

  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return {
    buffer: Buffer.concat([...locals, ...centrals, eocd]),
    entries: files.length,
    bytes: offset + centralSize + eocd.length,
  };
}

function zipDirToFile(dir, outFile, opts = {}) {
  const res = zipDirToBuffer(dir, opts);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, res.buffer);
  return { outFile, size: res.buffer.length, entries: res.entries };
}

module.exports = { crc32, listFiles, zipDirToBuffer, zipDirToFile };
