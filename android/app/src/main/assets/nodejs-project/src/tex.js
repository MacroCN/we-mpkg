'use strict';
/**
 * Wallpaper Engine 纹理容器（.tex）的读取 / 分类 / 物化。
 *
 * 为什么要物化：PC 包里的 .tex 有三种载荷形态 ——
 *   • DXT1/3/5 块压缩（移动端能直接解，逐字节照搬就行）
 *   • 原始像素 RGBA8 / R8 / RG88（移动端要的形态，照搬）
 *   • 「直通编码图」：TEXB0004 的 imageFormat 指向 PNG/JPEG，载荷就是一段图片字节
 * 第三种在移动端会被按 RGBA8 读（w*h*4 字节），喂进去一张 PNG 就等于整张纹理作废 ——
 * 导入手机后壁纸全黑/花屏的根因通常就是它。所以这里把它解码成直色 RGBA8，
 * 并按 WE 移动端导出的形态重写容器：TEXB0004 + imageFormat=FIF_UNKNOWN + 单 mip。
 *
 * 格式细节对齐 ReZe20/repkg-Re（RePKG_Re.Application/Texture/MobileTextureMaterializer.cs）：
 *   TEX 文件 = "TEXV0005\0" "TEXI0001\0"
 *              header(7×int32: format, flags, texW, texH, imgW, imgH, unk)
 *              "TEXB0004\0" int32 imageCount int32 imageFormat int32 isVideoMp4
 *              N × ( int32 mipCount, mip 记录… )
 *              （IsGif 时后面还有 TEXS000x 帧容器，本模块原样保留）
 *   mip 记录（TEXB0001）= w,h,字节数,字节
 *   mip 记录（TEXB0002/0003，以及 TEXB0004 非 MP4）= w,h,lz,解压后字节数,字节数,字节
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

let jpegDecoder = null;
function getJpeg() {
  if (jpegDecoder === null) {
    try { jpegDecoder = require('jpeg-js'); } catch { jpegDecoder = false; }
  }
  return jpegDecoder || null;
}

// ---- 枚举 ----
const FREE_IMAGE = {
  UNKNOWN: -1, BMP: 0, ICO: 1, JPEG: 2, PNG: 13, GIF: 25, MP4: 35,
};
const TEX_FORMAT = { RGBA8888: 0, DXT5: 4, ETC2_RGBA8: 5, DXT3: 6, DXT1: 7, RG88: 8, R8: 9 };
const TEX_FLAGS = { NoInterpolation: 1, ClampUVs: 2, IsGif: 4, IsVideoTexture: 32 };
const DXT_FORMATS = new Set([TEX_FORMAT.DXT1, TEX_FORMAT.DXT3, TEX_FORMAT.DXT5]);

// ---- 基础读写 ----
function readNString(buf, off) {
  const end = buf.indexOf(0, off);
  if (end < 0) throw new Error('NString 缺少终止符');
  return { value: buf.subarray(off, end).toString('utf8'), next: end + 1 };
}

function writeNString(s) {
  return Buffer.concat([Buffer.from(s, 'utf8'), Buffer.from([0])]);
}

function i32(n) {
  const b = Buffer.alloc(4);
  b.writeInt32LE(n | 0, 0);
  return b;
}

/**
 * 解析 .tex
 * @returns {{magic1:string,magic2:string,header:object,container:object,images:Array,framesStart:number,valid:boolean}}
 */
function parseTex(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 32) throw new Error('文件太小，不是 TEX');
  const m1 = readNString(buf, 0);
  if (m1.value !== 'TEXV0005') throw new Error(`不是 TEX 文件（magic1=${m1.value}）`);
  const m2 = readNString(buf, m1.next);
  if (m2.value !== 'TEXI0001') throw new Error(`不是 TEX 文件（magic2=${m2.value}）`);

  let off = m2.next;
  const header = {
    format: buf.readInt32LE(off),
    flags: buf.readInt32LE(off + 4),
    textureWidth: buf.readInt32LE(off + 8),
    textureHeight: buf.readInt32LE(off + 12),
    imageWidth: buf.readInt32LE(off + 16),
    imageHeight: buf.readInt32LE(off + 20),
    unk: buf.readUInt32LE(off + 24),
  };
  off += 28;

  const cm = readNString(buf, off);
  off = cm.next;
  if (!/^TEXB000[1-4]$/.test(cm.value)) throw new Error(`未知的图片容器: ${cm.value}`);
  const imageCount = buf.readInt32LE(off);
  off += 4;
  if (imageCount < 0 || imageCount > 4096) throw new Error(`图片数异常: ${imageCount}`);
  let imageFormat = FREE_IMAGE.UNKNOWN;
  let videoMp4 = 0;
  if (cm.value === 'TEXB0003') {
    imageFormat = buf.readInt32LE(off);
    off += 4;
  } else if (cm.value === 'TEXB0004') {
    imageFormat = buf.readInt32LE(off);
    videoMp4 = buf.readInt32LE(off + 4);
    off += 8;
    if (imageFormat === FREE_IMAGE.UNKNOWN && videoMp4 === 1) imageFormat = FREE_IMAGE.MP4;
  }

  // TEXB0004 + MP4 用 V4 的 mip 记录；其余 TEXB0004 按 V3 记录（WE 读侧同样降级）
  const mipV4 = cm.value === 'TEXB0004' && imageFormat === FREE_IMAGE.MP4;
  const images = [];
  for (let i = 0; i < imageCount; i++) {
    const mipCount = buf.readInt32LE(off);
    off += 4;
    if (mipCount < 0 || mipCount > 64) throw new Error(`mip 数异常: ${mipCount}`);
    const mips = [];
    for (let j = 0; j < mipCount; j++) {
      if (mipV4) {
        off += 4 + 4; // param1=1, param2=2
        const cj = readNString(buf, off);
        off = cj.next + 4; // conditionJson + param3=1
      }
      const width = buf.readInt32LE(off);
      const height = buf.readInt32LE(off + 4);
      let lz4 = 0;
      let decompressedBytes = 0;
      off += 8;
      if (cm.value !== 'TEXB0001') {
        lz4 = buf.readInt32LE(off) === 1 ? 1 : 0;
        decompressedBytes = buf.readInt32LE(off + 4);
        off += 8;
      }
      const byteCount = buf.readInt32LE(off);
      off += 4;
      if (byteCount < 0 || off + byteCount > buf.length) throw new Error('mip 载荷越界');
      mips.push({
        width, height, lz4, decompressedBytes,
        bytes: buf.subarray(off, off + byteCount),
        offset: off, byteCount,
      });
      off += byteCount;
    }
    images.push({ mips });
  }

  // 帧容器（GIF）原样保留：从当前位置到文件末尾都是它
  return {
    magic1: m1.value, magic2: m2.value, header, imageCount,
    container: { magic: cm.value, imageFormat, videoMp4 },
    images, framesStart: off, size: buf.length, valid: true,
  };
}

/** 分类：video / passthrough / dxt / raw / noimages */
function classify(tex) {
  if (tex.container.videoMp4 === 1 || tex.container.imageFormat === FREE_IMAGE.MP4) return 'video';
  if (!tex.images.length) return 'noimages';
  if (tex.container.imageFormat !== FREE_IMAGE.UNKNOWN) return 'passthrough';
  if (DXT_FORMATS.has(tex.header.format)) return 'dxt';
  return 'raw';
}

// ---- PNG 解码 ----
/**
 * 解码 PNG 到直色 RGBA8（不做预乘）。只处理非隔行图；隔行图返回 null 由调用方放弃物化。
 * @returns {{width:number,height:number,data:Buffer}|null}
 */
function decodePng(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  let off = 8;
  let ihdr = null;
  let plte = null;
  let trns = null;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const dataStart = off + 8;
    if (dataStart + len > buf.length) break;
    const data = buf.subarray(dataStart, dataStart + len);
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0), height: data.readUInt32BE(4),
        bitDepth: data[8], colorType: data[9], compression: data[10], filter: data[11], interlace: data[12],
      };
    } else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off = dataStart + len + 4; // 跳过 4 字节 CRC
  }
  if (!ihdr || !idat.length) return null;
  if (ihdr.interlace !== 0) return null;
  if (ihdr.compression !== 0 || ihdr.filter !== 0) return null;

  const { width, height, bitDepth, colorType } = ihdr;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) return null;
  const bytesPerSample = bitDepth === 16 ? 2 : 1;
  const bpp = Math.max(1, Math.ceil(channels * bitDepth / 8));
  const rowBytes = Math.ceil(width * channels * bitDepth / 8);

  let raw;
  try {
    raw = zlib.inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }
  if (raw.length < height * (rowBytes + 1)) return null;

  // 反滤波
  const out = Buffer.alloc(rowBytes * height);
  let rawPos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rawPos++];
    const rowStart = y * rowBytes;
    const prevStart = rowStart - rowBytes;
    for (let x = 0; x < rowBytes; x++) {
      const cur = raw[rawPos + x];
      const left = x >= bpp ? out[rowStart + x - bpp] : 0;
      const up = y > 0 ? out[prevStart + x] : 0;
      const upLeft = (y > 0 && x >= bpp) ? out[prevStart + x - bpp] : 0;
      let v;
      switch (filter) {
        case 0: v = cur; break;
        case 1: v = cur + left; break;
        case 2: v = cur + up; break;
        case 3: v = cur + ((left + up) >> 1); break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          const pred = pa <= pb && pa <= pc ? left : (pb <= pc ? up : upLeft);
          v = cur + pred;
          break;
        }
        default: return null;
      }
      out[rowStart + x] = v & 0xff;
    }
    rawPos += rowBytes;
  }

  // 取一个采样值（支持 1/2/4/8/16 位）
  const readSample = (rowStart, sampleIndex) => {
    if (bitDepth === 8) return out[rowStart + sampleIndex];
    if (bitDepth === 16) return out[rowStart + sampleIndex * 2]; // 取高字节
    const bitOffset = sampleIndex * bitDepth;
    const byte = out[rowStart + (bitOffset >> 3)];
    const shift = 8 - bitDepth - (bitOffset & 7);
    const mask = (1 << bitDepth) - 1;
    return (byte >> shift) & mask;
  };
  const scale = (v) => (bitDepth === 8 || bitDepth === 16 ? v : Math.round(v * 255 / ((1 << bitDepth) - 1)));

  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowBytes;
    for (let x = 0; x < width; x++) {
      const di = (y * width + x) * 4;
      if (colorType === 6) {
        data[di] = readSample(rowStart, x * 4);
        data[di + 1] = readSample(rowStart, x * 4 + 1);
        data[di + 2] = readSample(rowStart, x * 4 + 2);
        data[di + 3] = readSample(rowStart, x * 4 + 3);
      } else if (colorType === 2) {
        data[di] = readSample(rowStart, x * 3);
        data[di + 1] = readSample(rowStart, x * 3 + 1);
        data[di + 2] = readSample(rowStart, x * 3 + 2);
        data[di + 3] = 255;
      } else if (colorType === 4) {
        const g = readSample(rowStart, x * 2);
        data[di] = data[di + 1] = data[di + 2] = g;
        data[di + 3] = readSample(rowStart, x * 2 + 1);
      } else if (colorType === 0) {
        const g = scale(readSample(rowStart, x));
        data[di] = data[di + 1] = data[di + 2] = g;
        data[di + 3] = 255;
      } else {
        const idx = readSample(rowStart, x);
        if (!plte || idx * 3 + 2 >= plte.length) return null;
        data[di] = plte[idx * 3];
        data[di + 1] = plte[idx * 3 + 1];
        data[di + 2] = plte[idx * 3 + 2];
        data[di + 3] = trns && idx < trns.length ? trns[idx] : 255;
      }
    }
  }
  return { width, height, data };
}

/** 解码 JPEG（依赖 jpeg-js；未安装时返回 null） */
function decodeJpeg(buf) {
  const jpeg = getJpeg();
  if (!jpeg) return null;
  try {
    const r = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
    return { width: r.width, height: r.height, data: Buffer.from(r.data) };
  } catch {
    return null;
  }
}

/** 按载荷首字节猜图种，兜住 imageFormat 写错的包 */
function decodeImage(buf) {
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) return decodePng(buf);
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return decodeJpeg(buf);
  return null;
}

/**
 * 把直通编码图纹理物化成移动端 RGBA8。
 * @returns {{changed:boolean, bytes?:Buffer, reason?:string, width?:number, height?:number}}
 */
function materializeTex(buf) {
  let tex;
  try {
    tex = parseTex(buf);
  } catch (e) {
    return { changed: false, reason: `TEX 解析失败: ${e.message}` };
  }
  const kind = classify(tex);
  if (kind !== 'passthrough') return { changed: false, reason: kind };
  if (tex.header.flags & TEX_FLAGS.IsGif) {
    // 动图帧表描述的是"每帧在图像里的矩形"，物化不改尺寸，帧表可原样保留
  }

  const images = [];
  for (const img of tex.images) {
    const mip = img.mips[0];
    if (!mip || !mip.bytes.length) return { changed: false, reason: '某帧没有载荷' };
    const decoded = mip.lz4 ? null : decodeImage(mip.bytes);
    if (!decoded) {
      // LZ4 压过的直通图这里没有解压器；隔行 PNG、不支持的图种同样走这里
      return { changed: false, reason: '直通图无法解码（隔行/LZ4/不支持的图种）' };
    }
    const expected = decoded.width * decoded.height * 4;
    if (decoded.data.length !== expected) return { changed: false, reason: '解码尺寸与像素数不符' };
    images.push({ width: decoded.width, height: decoded.height, pixels: decoded.data });
  }

  // 逻辑尺寸沿用头部（宁可不变），真实像素尺寸由 mip 记录说话
  const logicalW = pickLogical(tex.header.imageWidth, images[0].width);
  const logicalH = pickLogical(tex.header.imageHeight, images[0].height);

  const parts = [];
  parts.push(writeNString('TEXV0005'));
  parts.push(writeNString('TEXI0001'));
  parts.push(Buffer.concat([
    i32(TEX_FORMAT.RGBA8888),
    i32(tex.header.flags),
    i32(logicalW),
    i32(logicalH),
    i32(logicalW),
    i32(logicalH),
    i32(tex.header.unk),
  ]));
  parts.push(writeNString('TEXB0004'));
  parts.push(i32(images.length));
  parts.push(i32(FREE_IMAGE.UNKNOWN)); // imageFormat：移动端按"原始 RGBA8"读
  parts.push(i32(0)); // isVideoMp4
  for (const im of images) {
    parts.push(i32(1)); // 单 mip
    parts.push(Buffer.concat([
      i32(im.width), i32(im.height),
      i32(0), // 未压缩
      i32(im.pixels.length), // 解压后字节数
      i32(im.pixels.length), // 载荷字节数
    ]));
    parts.push(im.pixels);
  }
  // 帧表原样接回
  if (tex.framesStart && tex.framesStart < buf.length) parts.push(buf.subarray(tex.framesStart));

  return {
    changed: true,
    bytes: Buffer.concat(parts),
    width: logicalW,
    height: logicalH,
    pixels: images[0].pixels.length,
  };
}

function pickLogical(headerSize, pixelSize) {
  return headerSize > 0 && headerSize <= pixelSize ? headerSize : pixelSize;
}

/**
 * 批量处理目录里的 .tex
 * @returns {{stats:object, warnings:string[]}}
 */
function convertTexDir(dir, opts = {}) {
  const onLog = opts.onLog || (() => {});
  const stats = { total: 0, passthrough: 0, converted: 0, kept: 0, failed: 0, bytesIn: 0, bytesOut: 0 };
  const warnings = [];
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, ent.name);
      if (ent.isDirectory()) { walk(abs); continue; }
      if (!/\.tex$/i.test(ent.name)) continue;
      stats.total++;
      const buf = fs.readFileSync(abs);
      const rel = path.relative(dir, abs).split(path.sep).join('/');
      const r = materializeTex(buf);
      if (r.changed) {
        fs.writeFileSync(abs, r.bytes);
        stats.converted++;
        stats.bytesIn += buf.length;
        stats.bytesOut += r.bytes.length;
        onLog(`  [纹理] ${rel}: 直通图 -> RGBA8 ${r.width}x${r.height} (${(buf.length / 1048576).toFixed(2)} -> ${(r.bytes.length / 1048576).toFixed(2)} MB)`);
      } else {
        if (r.reason === 'passthrough') stats.failed++;
        else stats.kept++;
        if (r.reason && r.reason !== 'dxt' && r.reason !== 'raw') {
          warnings.push(`${rel}: ${r.reason}`);
        }
      }
    }
  };
  walk(dir);
  if (stats.total) {
    onLog(`  纹理统计: 共 ${stats.total} 条，物化 ${stats.converted}，原样 ${stats.kept}，失败 ${stats.failed}`);
  }
  return { stats, warnings };
}

module.exports = {
  parseTex, classify, materializeTex, convertTexDir, decodePng, decodeJpeg,
  FREE_IMAGE, TEX_FORMAT, TEX_FLAGS,
};
