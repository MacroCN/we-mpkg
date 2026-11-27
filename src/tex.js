/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 MacroCN
 * 纹理容器解析与物化规格对齐 ReZe20/repkg-Re（MIT）的 MobileTextureMaterializer.cs，版权归原作者；
 * 见 THIRD-PARTY-NOTICES.md 与 licenses/repkg-Re-MIT.txt。
 */
'use strict';
/**
 * Wallpaper Engine 纹理容器（.tex）的读取 / 路由 / 物化 / 自校验。
 *
 * 背景：桌面包里的 .tex 有四种载荷形态，移动端能接受的不多：
 *   • 直通编码图（TEXB0003/0004 + imageFormat 指向 PNG/JPEG）：移动端按 RGBA8 读，
 *     喂一张 PNG 进去整张纹理就作废 —— 手机端黑屏/花屏的头号原因
 *   • DXT1/3/5 块压缩：手机 GPU 普遍没有 S3TC，同样读不出来
 *   • RGBA8 / R8 / RG88 原始像素：移动端能读，但没有压缩，体积白涨
 *   • 已经是移动端形态（TEXB0004 + imageFormat=-1 + 单 mip + LZ4）：原样保留
 *
 * 2.0 的处理原则（对齐官方「桌面版导出手机版」的思路）：
 *   1) 先判断文件是不是已经「移动端能读」，能读就原样保留，不为转换而转换
 *   2) 不能读的按类型分流：直通图解码、DXT 解码、原始像素重封装，统一输出
 *      RGBA8888 + 单 mip + LZ4（压不动就退回未压缩，见 writeMobileTex）
 *   3) 解码前先算像素预算，超预算就保留原文件并明确告警，绝不把内存打爆
 *   4) 降采样按「整包统一倍率」：同一张壁纸里所有可缩放的静态纹理用同一个比例，
 *      不能各自按自己的尺寸算，否则 8K 背景压到 2K、512 贴图仍原尺寸，图层缩放就对不上；
 *      法线/遮罩/LUT 这类数据图仍不做有损处理
 *   5) 写完后重新解析自己的输出做断言，通过才算转换成功
 *
 * 容器格式：
 *   "TEXV0005\0" "TEXI0001\0"
 *   header(7×int32: format, flags, texW, texH, imgW, imgH, unk)
 *   "TEXB0004\0" int32 imageCount int32 imageFormat int32 isVideoMp4
 *   N × ( int32 mipCount, mip 记录… )
 *   （IsGif 时后面还有 TEXS000x 帧容器，原样保留）
 *   mip 记录（TEXB0001）= w,h,字节数,字节
 *   mip 记录（TEXB0002/0003，以及 TEXB0004 非 MP4）= w,h,lz4,解压后字节数,字节数,字节
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const lz4 = require('./lz4');
const videoUtil = require('./video');

/** 同目录临时文件 + rename，避免中断时留下半截 .tex；失败时清掉临时文件 */
function writeFileAtomic(file, bytes) {
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
    throw e;
  }
}
const dxt = require('./dxt');
const rusttex = require('./rusttex');
const { sha256Buffer } = require('./convertplan');

// ---- 枚举（数值对照 notscuffed/repkg：TexFormat / TexFlags / FreeImageFormat）----
// header.format（TexFormat）：0=RGBA8888，4=DXT5，6=DXT3，7=DXT1，8=RG88，9=R8
// （移动端另外见过 5=ETC2_RGBA8，按 RGBA8 之外的可读格式对待）
const FREE_IMAGE = {
  UNKNOWN: -1, BMP: 0, ICO: 1, JPEG: 2, PNG: 13, GIF: 25, MP4: 35,
};
const TEX_FORMAT = { RGBA8888: 0, DXT5: 4, ETC2_RGBA8: 5, DXT3: 6, DXT1: 7, RG88: 8, R8: 9 };
// header.flags（TexFlags）：1=NoInterpolation，2=ClampUVs，4=IsGif，32=IsVideoTexture
const TEX_FLAGS = { NoInterpolation: 1, ClampUVs: 2, IsGif: 4, IsVideoTexture: 32 };
const DXT_FORMATS = new Set([TEX_FORMAT.DXT1, TEX_FORMAT.DXT3, TEX_FORMAT.DXT5]);
const RAW_FORMATS = new Set([TEX_FORMAT.RGBA8888, TEX_FORMAT.R8, TEX_FORMAT.RG88]);

/** 单张纹理解码出的 RGBA 字节上限（可用 opts.maxRgbaBytes 覆盖） */
const DEFAULT_MAX_RGBA_BYTES = 192 * 1024 * 1024;
/** 单个 .tex 文件读取上限，超过直接跳过（防止一个文件就把内存吃满） */
const DEFAULT_MAX_FILE_BYTES = 512 * 1024 * 1024;
const DEFAULT_MAX_DIMENSION = 4096;

/** 画质档位：对应官方客户端的「高画质 / 均衡 / 流畅」 */
const PRESETS = {
  high: { id: 'high', label: '高画质', reduction: 1, maxDimension: DEFAULT_MAX_DIMENSION },
  balanced: { id: 'balanced', label: '均衡', reduction: 2, maxDimension: 2048 },
  smooth: { id: 'smooth', label: '流畅', reduction: 4, maxDimension: 1024 },
  original: { id: 'original', label: '原尺寸', reduction: 1, maxDimension: 0 },
};

function presetOf(name) {
  return PRESETS[String(name || 'high').toLowerCase()] || PRESETS.high;
}

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

/** 计算 w*h*channels 的字节数，异常尺寸直接抛错 */
function checkedSize(width, height, channels) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`纹理尺寸非法: ${width}x${height}`);
  }
  const bytes = width * height * channels;
  if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new Error(`纹理解码尺寸溢出: ${width}x${height}`);
  return bytes;
}

/**
 * 解析 .tex
 * @returns {{header:object,container:object,images:Array,framesStart:number,size:number,valid:boolean}}
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
  if (header.textureWidth <= 0 || header.textureHeight <= 0 || header.imageWidth <= 0 || header.imageHeight <= 0) {
    throw new Error('TEX 头部尺寸非法');
  }

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
      let lz4Flag = 0;
      let decompressedBytes = 0;
      off += 8;
      if (cm.value !== 'TEXB0001') {
        lz4Flag = buf.readInt32LE(off);
        decompressedBytes = buf.readInt32LE(off + 4);
        off += 8;
        if (lz4Flag !== 0 && lz4Flag !== 1) throw new Error(`mip 的 lz4 标志异常: ${lz4Flag}`);
        if (decompressedBytes < 0) throw new Error(`mip 的解压长度异常: ${decompressedBytes}`);
      }
      const byteCount = buf.readInt32LE(off);
      off += 4;
      if (byteCount < 0 || off + byteCount > buf.length) throw new Error('mip 载荷越界');
      mips.push({
        width, height, lz4: lz4Flag, decompressedBytes,
        bytes: buf.subarray(off, off + byteCount),
        offset: off, byteCount,
      });
      off += byteCount;
    }
    images.push({ mips });
  }

  // 帧容器（GIF）原样保留：从当前位置到文件末尾都是它
  return {
    header, imageCount,
    container: { magic: cm.value, imageFormat, videoMp4 },
    images, framesStart: off, size: buf.length, valid: true,
  };
}

/** 分类：video / mobile / passthrough / dxt / raw / noimages / unknown */
function classify(tex) {
  if (tex.container.videoMp4 === 1 || tex.container.imageFormat === FREE_IMAGE.MP4) return 'video';
  if (!tex.images.length) return 'noimages';
  if (isMobileCompatible(tex)) return 'mobile';
  if (tex.container.imageFormat >= 0) return 'passthrough';
  if (DXT_FORMATS.has(tex.header.format)) return 'dxt';
  if (RAW_FORMATS.has(tex.header.format)) return 'raw';
  return 'unknown';
}

/**
 * 是否已经是移动端可读形态：
 *   TEXB0004 + imageFormat=-1 + 非 MP4 + 单 mip + RGBA8/ETC2 + 尺寸与长度自洽
 */
function isMobileCompatible(tex) {
  const { header, container, images } = tex;
  if (container.magic !== 'TEXB0004') return false;
  if (container.imageFormat !== FREE_IMAGE.UNKNOWN || container.videoMp4 !== 0) return false;
  if (header.flags & TEX_FLAGS.IsGif) return false;
  if (!images.length) return false;
  for (const img of images) {
    if (img.mips.length !== 1) return false;
    const mip = img.mips[0];
    if (header.format === TEX_FORMAT.RGBA8888) {
      const need = checkedSize(mip.width, mip.height, 4);
      if (mip.lz4 === 1 && mip.decompressedBytes !== need) return false;
      if (mip.lz4 === 0 && mip.bytes.length !== need) return false;
    } else if (header.format === TEX_FORMAT.ETC2_RGBA8) {
      const blocks = Math.ceil(mip.width / 4) * Math.ceil(mip.height / 4) * 8;
      if (mip.lz4 === 1 && mip.decompressedBytes !== blocks) return false;
      if (mip.lz4 === 0 && mip.bytes.length !== blocks) return false;
    } else {
      return false;
    }
    // 逻辑尺寸要么等于 mip 尺寸，要么是同倍率的整数缩小（源包存在 8K 逻辑 + 1K mip 的图层）
    const rx = header.imageWidth / mip.width;
    const ry = header.imageHeight / mip.height;
    const intRatio = rx >= 1 && Math.abs(rx - Math.round(rx)) < 1e-6
      && Math.abs(rx - ry) < 1e-6;
    if (!intRatio) return false;
  }
  return true;
}

/** 视频纹理的基本校验：声明为 MP4 且确实有 mip */
function isVerifiedVideo(tex) {
  return (tex.container.imageFormat === FREE_IMAGE.MP4 || tex.container.videoMp4 === 1)
    && tex.images.length > 0 && tex.images[0].mips.length > 0;
}

/**
 * 取出「视频纹理」里真正的视频载荷。
 * 官方写的视频纹理有两种头：imageFormat=MP4/videoMp4=1，以及 imageFormat=-1/videoMp4=0
 * 但 flags 带 IsVideoTexture(32)（repkg 与桌面版都用后者）。所以以「载荷是不是 MP4/WebM」
 * 为准，不能只看容器声明。
 * @returns {{data:Buffer,width:number,height:number}|null}
 */
function videoPayload(tex) {
  if (tex.images.length !== 1 || tex.images[0].mips.length !== 1) return null;
  const mip = tex.images[0].mips[0];
  const data = mip.bytes;
  if (!data || data.length < 24) return null;
  const isMp4 = data.subarray(4, 8).toString('latin1') === 'ftyp';
  const isWebm = data.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (!isMp4 && !isWebm) return null;
  return {
    data,
    width: mip.width || tex.header.imageWidth,
    height: mip.height || tex.header.imageHeight,
  };
}

/** 手机端建议的视频最长边上限（0 = 不限制；画质档位会在此基础上继续缩） */
function videoMaxWidth(opts = {}) {
  return videoUtil.videoMaxWidth(opts);
}

/**
 * 写「视频纹理」TEX（与官方/repkg 一致：TEXB0004 + imageFormat=-1 + videoMp4=0 + V3 mip，
 * mip 载荷整段就是 MP4）。Android 端认这种结构，且 texture 尺寸与视频一致。
 */
function buildVideoTex({ format, flags, unk, width, height, mp4 }) {
  const parts = [
    writeNString('TEXV0005'),
    writeNString('TEXI0001'),
    Buffer.concat([
      i32(format), i32(flags), i32(width), i32(height), i32(width), i32(height), i32(unk || 0),
    ]),
    writeNString('TEXB0004'),
    i32(1),
    i32(FREE_IMAGE.UNKNOWN),
    i32(0),
    i32(1),
    i32(width),
    i32(height),
    i32(0),
    i32(0),
    i32(mp4.length),
    mp4,
  ];
  return Buffer.concat(parts);
}

// ---- 图片解码（直通载荷） ----
let jpegDecoder = null;
function getJpeg() {
  if (jpegDecoder === null) {
    try { jpegDecoder = require('jpeg-js'); } catch { jpegDecoder = false; }
  }
  return jpegDecoder || null;
}

/**
 * 解码 PNG 到直色 RGBA8（不做预乘）。只处理非隔行图；隔行图返回 null，由调用方保留原文件。
 * @returns {{width:number,height:number,data:Buffer}|null}
 */
function decodePng(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  // PNG 解码交给 Rust（自带 inflate）。尺寸从 IHDR 直接读（PNG 规定 IHDR 是第一个 chunk）。
  // 下面的 JS 实现只作为黄金样本的对照实现保留，生产路径不再使用。
  if (buf.length >= 24 && buf.readUInt32BE(12) === 0x49484452 && rusttex.enabled()) {
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    if (w > 0 && h > 0) {
      return { width: w, height: h, data: rusttex.pngDecode(buf, w, h) };
    }
  }
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

/** 最近一次解码失败的原因（供上层给用户看具体原因，而不是一句“无法解码”） */
let lastDecodeError = '';

/**
 * 解码 JPEG（依赖 jpeg-js；未安装时返回 null）。
 * jpeg-js 默认只给 512MB 内存 / 100MP，6000×4500 的渐进式大图会被它自己拦下，
 * 之前就是这里把整张纹理判成「无法解码」→ 原图直通 → 手机端读不出来 → 黑屏。
 */
function decodeJpeg(buf, opts = {}) {
  // JPEG 解码交给 Rust（baseline / 渐进式都支持，输出与 jpeg-js 逐字节一致）。
  // 下面的 jpeg-js 路径只作为黄金样本的对照实现保留。
  if (rusttex.enabled()) {
    try {
      const r = rusttex.jpegDecode(buf);
      lastDecodeError = '';
      return { width: r.width, height: r.height, data: Buffer.from(r.data) };
    } catch (e) {
      lastDecodeError = `JPEG 解码失败: ${e.message || e}`;
      return null;
    }
  }
  const jpeg = getJpeg();
  if (!jpeg) { lastDecodeError = '缺少 jpeg-js 依赖'; return null; }
  const maxMemoryUsageInMB = opts.maxMemoryMB || DEFAULT_MAX_RGBA_BYTES / 1048576 * 4;
  try {
    const r = jpeg.decode(buf, {
      useTArray: true,
      formatAsRGBA: true,
      maxMemoryUsageInMB: Math.max(512, Math.ceil(maxMemoryUsageInMB)),
      maxResolutionInMP: Math.max(100, opts.maxResolutionMP || 512),
    });
    lastDecodeError = '';
    return { width: r.width, height: r.height, data: Buffer.from(r.data) };
  } catch (e) {
    lastDecodeError = `JPEG 解码失败: ${e.message}`;
    return null;
  }
}

/** 按载荷首字节猜图种，兜住 imageFormat 写错的包 */
function decodeImage(buf, opts = {}) {
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) {
    const png = decodePng(buf);
    if (!png) lastDecodeError = lastDecodeError || 'PNG 解码失败';
    return png;
  }
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return decodeJpeg(buf, opts);
  lastDecodeError = '既不是 PNG 也不是 JPEG';
  return null;
}

// ---- 像素处理 ----
/** 裁到左上角 w×h（头部声明的逻辑尺寸可能比 mip 小） */
function cropRgba(pixels, srcW, srcH, dstW, dstH) {
  if (srcW === dstW && srcH === dstH) return pixels;
  if (srcW < dstW || srcH < dstH) throw new Error(`裁剪尺寸大于原图: ${srcW}x${srcH} -> ${dstW}x${dstH}`);
  const out = Buffer.alloc(checkedSize(dstW, dstH, 4));
  const rowBytes = dstW * 4;
  for (let y = 0; y < dstH; y++) {
    pixels.copy(out, y * rowBytes, y * srcW * 4, (y * srcW + dstW) * 4);
  }
  return out;
}

/** 面积平均降采样（比最近邻稳，观感与官方降采样接近） */
function resizeAreaAverage(pixels, srcW, srcH, dstW, dstH) {
  if (srcW === dstW && srcH === dstH) return pixels;
  if (dstW <= 0 || dstH <= 0 || dstW > srcW || dstH > srcH) throw new Error('降采样尺寸非法');
  const out = Buffer.alloc(checkedSize(dstW, dstH, 4));
  const xMap = new Int32Array(dstW + 1);
  for (let x = 0; x <= dstW; x++) xMap[x] = Math.floor((x * srcW) / dstW);
  for (let y = 0; y < dstH; y++) {
    const top = Math.floor((y * srcH) / dstH);
    const bottom = Math.max(top + 1, Math.floor(((y + 1) * srcH) / dstH));
    for (let x = 0; x < dstW; x++) {
      const left = xMap[x];
      const right = Math.max(left + 1, xMap[x + 1]);
      const count = (right - left) * (bottom - top);
      const di = (y * dstW + x) * 4;
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = top; sy < bottom; sy++) {
        let si = (sy * srcW + left) * 4;
        for (let sx = left; sx < right; sx++) {
          r += pixels[si]; g += pixels[si + 1]; b += pixels[si + 2]; a += pixels[si + 3];
          si += 4;
        }
      }
      out[di] = Math.floor((r + count / 2) / count);
      out[di + 1] = Math.floor((g + count / 2) / count);
      out[di + 2] = Math.floor((b + count / 2) / count);
      out[di + 3] = Math.floor((a + count / 2) / count);
    }
  }
  return out;
}

/** R8 灰度 -> RGBA */
function expandR8(pixels, width, height) {
  const n = width * height;
  const out = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const v = pixels[i];
    out[i * 4] = v; out[i * 4 + 1] = v; out[i * 4 + 2] = v; out[i * 4 + 3] = 255;
  }
  return out;
}

/** RG88 -> RGBA（R=粗、G=细，B 置 0，与 repkg-Re 的物化规则一致） */
function expandRg88(pixels, width, height) {
  const n = width * height;
  const out = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    out[i * 4] = pixels[i * 2];
    out[i * 4 + 1] = pixels[i * 2 + 1];
    out[i * 4 + 2] = 0;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** 把某个 mip 的载荷解成逻辑尺寸的 RGBA8（按头部 format） */
function decodeMip(mip, format, logicalW, logicalH) {
  let payload = mip.bytes;
  if (mip.lz4 === 1) {
    const expected = mip.decompressedBytes || 0;
    if (expected <= 0) throw new Error('LZ4 载荷缺少解压长度');
    payload = lz4.decompress(payload, expected);
  }
  let pixels;
  if (DXT_FORMATS.has(format)) {
    const need = dxt.payloadSize(format, mip.width, mip.height);
    if (payload.length !== need) throw new Error(`DXT 载荷长度不符: ${payload.length} != ${need}`);
    pixels = dxt.decode(payload, format, mip.width, mip.height);
  } else if (format === TEX_FORMAT.RGBA8888) {
    const need = checkedSize(mip.width, mip.height, 4);
    if (payload.length < need) throw new Error(`RGBA 载荷不足: ${payload.length} < ${need}`);
    pixels = payload.subarray(0, need);
  } else if (format === TEX_FORMAT.R8) {
    const need = checkedSize(mip.width, mip.height, 1);
    if (payload.length < need) throw new Error(`R8 载荷不足: ${payload.length} < ${need}`);
    pixels = expandR8(payload, mip.width, mip.height);
  } else if (format === TEX_FORMAT.RG88) {
    const need = checkedSize(mip.width, mip.height, 2);
    if (payload.length < need) throw new Error(`RG88 载荷不足: ${payload.length} < ${need}`);
    pixels = expandRg88(payload, mip.width, mip.height);
  } else {
    throw new Error(`不支持的源格式: ${format}`);
  }
  return cropRgba(pixels, mip.width, mip.height, logicalW, logicalH);
}

// ---- 语义判定：数据图不许有损 ----
const DATA_TOKENS = new Set([
  'normal', 'normals', 'nrm', 'bump', 'mask', 'masks', 'alpha', 'opacity', 'spec', 'specular',
  'metal', 'metallic', 'rough', 'roughness', 'ao', 'occlusion', 'height', 'disp', 'displacement',
  'lut', 'gradient', 'curve', 'data', 'sdf', 'thickness', 'flow', 'velocity', 'depth', 'id',
]);
const COLOR_TOKENS = new Set([
  'albedo', 'diffuse', 'color', 'colour', 'basecolor', 'basecolour', 'texture', 'tex', 'image',
  'bg', 'background', 'sky', 'cloud', 'clouds', 'light', 'glow', 'noise', 'pattern', 'emissive',
  'sticker', 'sprite', 'photo', 'poster',
]);

/**
 * 纹理语义：'data'（数据图，禁止降采样）、'color'（彩色图，允许降采样）、'unknown'。
 * 只用文件名启发式 —— 判不准就当 unknown，按最保守的方式处理。
 */
function semanticOf(relPath) {
  const base = String(relPath || '').replace(/\\/g, '/').split('/').pop() || '';
  const tokens = base.toLowerCase().replace(/\.[a-z0-9]+$/, '').split(/[^a-z0-9]+/).filter(Boolean);
  if (!tokens.length) return 'unknown';
  if (tokens.some((t) => DATA_TOKENS.has(t))) return 'data';
  if (tokens.some((t) => COLOR_TOKENS.has(t))) return 'color';
  return 'unknown';
}

// ---- 路由 ----
/**
 * 决定一个 .tex 该怎么处理（不读写）。
 * @returns {{route:string, reason:string, pixels:number, width:number, height:number, animated:boolean}}
 */
function inspectTex(buf, opts = {}) {
  const maxRgbaBytes = opts.maxRgbaBytes || DEFAULT_MAX_RGBA_BYTES;
  let tex;
  try {
    tex = parseTex(buf);
  } catch (e) {
    return { route: 'failed', reason: `TEX 解析失败: ${e.message}`, pixels: 0, width: 0, height: 0, animated: false };
  }
  const { header } = tex;
  const animated = (header.flags & TEX_FLAGS.IsGif) !== 0;
  const video = videoPayload(tex);
  if (video) {
    const target = videoUtil.targetLongEdge(video.width, video.height, opts.preset, opts);
    return {
      route: target > 0 ? 'video-texture-shrink' : 'video-texture',
      reason: target > 0
        ? `视频纹理 ${video.width}x${video.height}，当前画质档位将缩到最长边 ${target}px`
        : '视频纹理（MP4 载荷，手机端可直接解码）',
      pixels: 0, width: video.width, height: video.height, animated: true,
    };
  }
  const kind = classify(tex);
  const largest = tex.images.reduce((max, img) => {
    const w = img.mips.length ? img.mips[0].width : 0;
    const h = img.mips.length ? img.mips[0].height : 0;
    return Math.max(max, w * h);
  }, 0);
  const width = header.imageWidth;
  const height = header.imageHeight;

  if (kind === 'video') {
    const ok = isVerifiedVideo(tex);
    return {
      route: ok ? 'keep-video' : 'keep-video-unverified',
      reason: ok ? '视频纹理，移动端可读' : '视频纹理结构不完整，原样保留',
      pixels: largest, width, height, animated,
    };
  }
  if (kind === 'noimages') return { route: 'keep-empty', reason: '没有图像数据', pixels: 0, width, height, animated };
  if (kind === 'mobile') return { route: 'keep-mobile', reason: '已是移动端形态（单 mip + RGBA8/ETC2）', pixels: largest, width, height, animated };
  if (kind === 'unknown') return { route: 'keep-unsupported', reason: `不支持的源格式 ${header.format}`, pixels: largest, width, height, animated };
  if (largest * 4 > maxRgbaBytes) {
    return {
      route: 'keep-budget',
      reason: `解码需要约 ${(largest * 4 / 1048576).toFixed(1)}MB，超过 ${(maxRgbaBytes / 1048576).toFixed(0)}MB 预算；`
        + '原样保留会让手机端读不出来，建议调高 --max-texture-mb 或改用均衡/流畅档位',
      pixels: largest, width, height, animated,
    };
  }
  if (animated) return { route: 'convert-animated', reason: '动图逐帧转 RGBA8（不改尺寸/帧表）', pixels: largest, width, height, animated };
  return {
    route: kind === 'passthrough' ? 'convert-image' : (kind === 'dxt' ? 'convert-dxt' : 'convert-raw'),
    reason: kind === 'passthrough' ? '直通编码图 -> RGBA8+LZ4' : (kind === 'dxt' ? 'DXT -> RGBA8+LZ4' : '原始像素 -> RGBA8+LZ4'),
    pixels: largest, width, height, animated,
  };
}

/**
 * 整包统一缩放倍率：先按 reduction 取 1/2、1/4，再用 maxDimension 约束最大的一条纹理。
 * 关键是这个倍率由「整包最大的纹理」算出来，之后所有纹理都乘同一个倍率，
 * 这样 8K 背景和 512 的小贴图会一起等比缩小，不会出现各自缩、图层错位。
 */
function uniformScale(maxSourceDim, preset) {
  if (!preset || maxSourceDim <= 0) return 1;
  let scale = preset.reduction > 1 ? 1 / preset.reduction : 1;
  if (preset.maxDimension && maxSourceDim * scale > preset.maxDimension) {
    scale = preset.maxDimension / maxSourceDim;
  }
  return scale > 1 ? 1 : scale;
}

/** 目标尺寸：source 尺寸 × 统一倍率（只缩不放） */
function targetSize(width, height, scale) {
  const s = scale > 0 && scale < 1 ? scale : 1;
  return {
    width: Math.max(1, Math.floor(width * s)),
    height: Math.max(1, Math.floor(height * s)),
  };
}

/**
 * 写移动端 TEX（TEXB0004 + imageFormat=-1 + 单 mip + LZ4）。
 * 压缩后反而更大时退回未压缩（lz4=0），移动端两种都能读。
 */
function writeMobileTex({ flags, unk, images, framesTail }) {
  if (!images.length) throw new Error('没有可写入的图像');
  const first = images[0];
  // imageWidth/Height 必须和真实 mip 尺寸一致：手机端按这两个字段决定纹理上传大小，
  // 写成和载荷不同的值会按错误 stride 采样。需要保持图层大小的纹理由场景 scale 补偿。
  const texW = first.width;
  const texH = first.height;
  const imgW = texW;
  const imgH = texH;
  const parts = [
    writeNString('TEXV0005'),
    writeNString('TEXI0001'),
    Buffer.concat([
      i32(TEX_FORMAT.RGBA8888),
      i32(flags),
      i32(texW),
      i32(texH),
      i32(imgW),
      i32(imgH),
      i32(unk),
    ]),
    writeNString('TEXB0004'),
    i32(images.length),
    i32(FREE_IMAGE.UNKNOWN),
    i32(0),
  ];

  for (const im of images) {
    const raw = im.pixels;
    if (raw.length !== checkedSize(im.width, im.height, 4)) throw new Error('像素长度与尺寸不符');
    const compressed = lz4.compress(raw);
    const useLz4 = compressed.length < raw.length - 16; // 压不动就别压，省解码开销
    const payload = useLz4 ? compressed : raw;
    parts.push(i32(1));
    parts.push(Buffer.concat([
      i32(im.width), i32(im.height),
      i32(useLz4 ? 1 : 0),
      i32(raw.length),
      i32(payload.length),
    ]));
    parts.push(payload);
  }
  if (framesTail && framesTail.length) parts.push(framesTail);
  return Buffer.concat(parts);
}

/** 自校验：重新解析输出，确认移动端真的能读。不通过就抛错（调用方回退原文件）。 */
function verifyMobileTex(buf, expect = {}) {
  const tex = parseTex(buf);
  const { header, container, images } = tex;
  if (header.format !== TEX_FORMAT.RGBA8888) throw new Error(`输出格式不是 RGBA8888: ${header.format}`);
  if (container.magic !== 'TEXB0004') throw new Error(`输出容器不是 TEXB0004: ${container.magic}`);
  if (container.imageFormat !== FREE_IMAGE.UNKNOWN) throw new Error('输出的 imageFormat 不是 -1');
  if (container.videoMp4 !== 0) throw new Error('输出被标成了 MP4');
  if (!images.length) throw new Error('输出没有图像');
  for (const img of images) {
    if (img.mips.length !== 1) throw new Error(`输出 mip 数为 ${img.mips.length}，应为 1`);
    const mip = img.mips[0];
    const need = checkedSize(mip.width, mip.height, 4);
    if (mip.lz4 === 1 && mip.decompressedBytes !== need) throw new Error(`输出解压长度不符: ${mip.decompressedBytes} != ${need}`);
    if (mip.lz4 === 0 && mip.bytes.length !== need) throw new Error(`输出未压缩长度不符: ${mip.bytes.length} != ${need}`);
  }
  if (typeof expect.width === 'number' && header.imageWidth !== expect.width) {
    throw new Error(`输出宽度不符: ${header.imageWidth} != ${expect.width}`);
  }
  if (typeof expect.height === 'number' && header.imageHeight !== expect.height) {
    throw new Error(`输出高度不符: ${header.imageHeight} != ${expect.height}`);
  }
  if (expect.framesTail) {
    const tail = buf.subarray(tex.framesStart);
    if (!tail.equals(expect.framesTail)) throw new Error('动图帧表在转换后被改动了');
  }
  return true;
}

/**
 * 把视频纹理按当前画质档位缩到目标最长边，再按官方结构重封装。
 * 转码失败/没有 ffmpeg 时原样保留（至少不会比原文件更差）。
 */
function shrinkVideoTex(buf, info, opts = {}) {
  const tex = parseTex(buf);
  const video = videoPayload(tex);
  if (!video) return { changed: false, route: 'video-texture', reason: '视频载荷异常，原样保留' };
  const target = videoUtil.targetLongEdge(video.width, video.height, opts.preset, opts);
  if (!target) return { changed: false, route: 'video-texture', reason: '当前画质档位无需缩小视频纹理' };
  const ffmpeg = videoUtil.findFfmpeg(opts);
  if (!ffmpeg) {
    return {
      changed: false,
      route: 'keep-video-noffmpeg',
      reason: `视频纹理 ${video.width}x${video.height} 需要缩到 ${target}px，但没找到 ffmpeg，只能原样保留 —— ${require('./ffmpeg').missingHelpShort()}`,
    };
  }
  try {
    const res = videoUtil.transcodeBuffer(video.data, {
      width: video.width, height: video.height, target, ffmpeg, opts,
    });
    if (!res || !res.mp4) throw new Error('转码没有产出 MP4');
    const dims = { width: res.width, height: res.height };
    const out = buildVideoTex({
      format: tex.header.format,
      flags: tex.header.flags, // 保留 IsVideoTexture(32) 与 ClampUVs(2)
      unk: tex.header.unk,
      width: dims.width,
      height: dims.height,
      mp4: res.mp4,
    });
    return {
      changed: true,
      bytes: out,
      route: 'video-texture-shrink',
      reason: `视频纹理 ${video.width}x${video.height} -> ${dims.width}x${dims.height}（H.264/yuv420p，手机端兼容）`,
      width: dims.width,
      height: dims.height,
    };
  } catch (e) {
    const msg = String((e && e.message) || e).split('\n')[0];
    const tail = /ETIMEDOUT|timed out/i.test(msg) ? '（转码超时）' : '';
    return { changed: false, route: 'keep-video-transcode-failed', reason: `视频转码失败，原样保留${tail}（${msg}）` };
  }
}

/**
 * 单个纹理转换（不写盘）。
 * @param {Buffer} buf
 * @param {{relPath?:string, preset?:object|string, maxRgbaBytes?:number, semantic?:string, force?:boolean,
 *          videoMaxWidth?:number, scale?:number}} opts
 * @returns {{changed:boolean, bytes?:Buffer, reason:string, route:string, width?:number, height?:number, downsampled?:boolean}}
 */
function convertTexBuffer(buf, opts = {}) {
  const info = inspectTex(buf, opts);
  if (info.route === 'video-texture') {
    return { changed: false, route: 'video-texture', reason: info.reason, width: info.width, height: info.height };
  }
  if (info.route === 'video-texture-shrink') {
    return shrinkVideoTex(buf, info, opts);
  }
  if (!opts.force && !info.route.startsWith('convert')) {
    return { changed: false, route: info.route, reason: info.reason };
  }

  let tex;
  try {
    tex = parseTex(buf);
  } catch (e) {
    return { changed: false, route: 'keep', reason: `TEX 解析失败: ${e.message}` };
  }
  const preset = typeof opts.preset === 'string' ? presetOf(opts.preset) : (opts.preset || presetOf('high'));
  let semantic = opts.semantic || semanticOf(opts.relPath);
  // 文件名没有语义线索（materials/1.tex 这种）但载荷是直通图时按格式兜底：
  // JPEG 没有 alpha，基本都是照片/背景 → 当彩色图，可以降采样（否则 6000×4500 原尺寸写进 mpkg，
  // 体积和显存都顶不住）；PNG/GIF 常被用来做**叠加层的蒙版或带透明边的贴图**，一旦降采样，
  // 叠加层的边缘/透明度就会糊掉、整块发白 → 当数据图处理，只做无损重编码。
  if (semantic === 'unknown' && tex.container.imageFormat >= 0) {
    semantic = tex.container.imageFormat === FREE_IMAGE.JPEG ? 'color' : 'data';
  }
  const animated = (tex.header.flags & TEX_FLAGS.IsGif) !== 0;
  const framesTail = tex.framesStart < buf.length ? buf.subarray(tex.framesStart) : null;

  const logicalW = tex.header.imageWidth;
  const logicalH = tex.header.imageHeight;
  // 数据图不做有损缩放；动图尺寸一变帧表就对不上，也保持原尺寸
  const scale = (!animated && semantic !== 'data')
    ? (typeof opts.scale === 'number' ? opts.scale : uniformScale(Math.max(logicalW, logicalH), preset))
    : 1;

  // 非直通图（DXT / RGBA8 / R8 / RG88）以及直通 PNG，整包交给 Rust：
  // 容器读写、解码、裁剪、缩放、LZ4 都在一个进程里做完，不再每张图拆成多次调用。
  // 动图（GIF）帧表由 JS 处理，这类继续走下面的原实现。
  const rustPacket = tex.container.imageFormat < 0
    || tex.container.imageFormat === FREE_IMAGE.PNG
    || tex.container.imageFormat === FREE_IMAGE.JPEG;
  if (rustPacket && !animated && opts.scale === undefined && rusttex.enabled()) {
    const fast = rusttex.texConvert(buf, scale, animated);
    verifyMobileTex(fast.bytes, {
      width: fast.width,
      height: fast.height,
      framesTail: animated ? framesTail : null,
    });
    return {
      changed: true,
      bytes: fast.bytes,
      route: info.route,
      reason: info.reason + (fast.downsampled ? '（已降采样）' : ''),
      width: fast.width,
      height: fast.height,
      sourceWidth: tex.header.textureWidth || fast.width,
      sourceHeight: tex.header.textureHeight || fast.height,
      downsampled: fast.downsampled,
    };
  }

  const images = [];
  let downsampled = false;
  let outW = 0;
  let outH = 0;
  for (let i = 0; i < tex.images.length; i++) {
    const img = tex.images[i];
    if (!img.mips.length) throw new Error(`第 ${i} 帧没有 mip`);
    const mip = img.mips[0];

    let pixels;
    let effW;
    let effH;
    if (tex.container.imageFormat >= 0) {
      let payload = mip.bytes;
      if (mip.lz4 === 1) {
        if (mip.decompressedBytes <= 0) throw new Error('直通图载荷被 LZ4 压缩但缺少解压长度');
        payload = lz4.decompress(payload, mip.decompressedBytes);
      }
      const decoded = decodeImage(payload);
      if (!decoded) throw new Error(`直通图无法解码（${lastDecodeError || '未知原因'}）`);
      pixels = decoded.data;
      effW = decoded.width;
      effH = decoded.height;
    } else {
      pixels = decodeMip(mip, tex.header.format, mip.width, mip.height);
      if (pixels.length !== checkedSize(mip.width, mip.height, 4)) throw new Error('解码后像素长度异常');
      effW = mip.width;
      effH = mip.height;
    }

    // 逻辑尺寸比实际小时裁左上角；逻辑尺寸比实际大（直通图常见）时保留实际载荷，不放大像素。
    if (logicalW <= effW && logicalH <= effH && (logicalW !== effW || logicalH !== effH)) {
      pixels = cropRgba(pixels, effW, effH, logicalW, logicalH);
      effW = logicalW;
      effH = logicalH;
    }
    if (pixels.length !== checkedSize(effW, effH, 4)) throw new Error('解码后像素长度异常');

    const want = targetSize(effW, effH, scale);
    if (want.width !== effW || want.height !== effH) {
      pixels = resizeAreaAverage(pixels, effW, effH, want.width, want.height);
      downsampled = true;
    }
    if (!outW) { outW = want.width; outH = want.height; }
    images.push({ width: want.width, height: want.height, pixels });
  }
  // 只有像素尺寸真正变了才算降采样

  // 非视频纹理的输出必须清掉 IsVideoTexture 位：否则手机端会去找视频流，找不到就整块黑
  const out = writeMobileTex({
    flags: tex.header.flags & ~TEX_FLAGS.IsVideoTexture,
    unk: tex.header.unk,
    images,
    framesTail,
  });
  verifyMobileTex(out, {
    width: images[0].width,
    height: images[0].height,
    framesTail: animated ? framesTail : null,
  });
  return {
    changed: true,
    bytes: out,
    route: info.route,
    reason: info.reason + (downsampled ? '（已降采样）' : ''),
    width: images[0].width,
    height: images[0].height,
    sourceWidth: tex.header.textureWidth || images[0].width,
    sourceHeight: tex.header.textureHeight || images[0].height,
    downsampled,
  };
}

/**
 * 批量处理目录里的 .tex。
 * @param {string} dir
 * @param {{onLog?:Function, preset?:object|string, maxRgbaBytes?:number, maxFileBytes?:number,
 *          skipRelPaths?:Set<string>, semanticOf?:Function, onResource?:Function,
 *          checkpoint?:object}} opts
 *        checkpoint 是 convertplan.Checkpoint 实例；给了就支持断点续转
 * @returns {{stats:object, warnings:string[], outcomes:Array}}
 */
/**
 * 扫一遍目录，用「整包最大的可缩放静态纹理」算出统一倍率。
 * 按 header 的逻辑尺寸算：多数源包 imageWidth/Height 等于 mip 尺寸。
 * autosize 图层的尺寸补偿由 pack 阶段按实际缩放倍率改场景 scale 完成。
 */
function measureUniformScale(dir, preset, semanticFn, skip, maxFileBytes) {
  if (!preset || (preset.reduction <= 1 && !preset.maxDimension)) return 1;
  let maxDim = 0;
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, ent.name);
      if (ent.isDirectory()) { walk(abs); continue; }
      if (!/\.tex$/i.test(ent.name)) continue;
      const rel = path.relative(dir, abs).split(path.sep).join('/');
      if (skip.has(rel)) continue;
      try {
        if (maxFileBytes && fs.statSync(abs).size > maxFileBytes) continue;
        const buf = fs.readFileSync(abs);
        const tex = parseTex(buf);
        if (videoPayload(tex)) continue;
        if (tex.header.flags & TEX_FLAGS.IsGif) continue;
        const kind = classify(tex);
        if (kind === 'mobile' || kind === 'noimages') continue;
        let semantic = semanticFn(rel);
        // 和 convertTexBuffer 的兜底保持一致：无名 PNG 当数据图、无名 JPEG 当彩图
        if (semantic === 'unknown' && tex.container.imageFormat >= 0) {
          semantic = tex.container.imageFormat === FREE_IMAGE.JPEG ? 'color' : 'data';
        }
        if (semantic === 'data') continue;
        maxDim = Math.max(maxDim, tex.header.imageWidth, tex.header.imageHeight);
      } catch { /* 坏文件留给正式转换阶段报错 */ }
    }
  };
  walk(dir);
  return uniformScale(maxDim, preset);
}

function convertTexDir(dir, opts = {}) {
  const onLog = opts.onLog || (() => {});
  const preset = typeof opts.preset === 'string' ? presetOf(opts.preset) : (opts.preset || presetOf('high'));
  const maxRgbaBytes = opts.maxRgbaBytes || DEFAULT_MAX_RGBA_BYTES;
  const maxFileBytes = opts.maxFileBytes || DEFAULT_MAX_FILE_BYTES;
  const semanticFn = opts.semanticOf || semanticOf;
  const skip = opts.skipRelPaths || new Set();
  const checkpoint = opts.checkpoint || null;
  // 先算整包统一倍率：所有静态纹理乘同一个比例；autosize 图层在 pack 阶段补 scale
  const scale = measureUniformScale(dir, preset, semanticFn, skip, maxFileBytes);
  if (scale < 1) onLog(`  统一缩放: ${(scale * 100).toFixed(1)}%（整包静态纹理按同一比例缩小）`);

  const stats = {
    total: 0, converted: 0, kept: 0, failed: 0, video: 0, budget: 0, resumed: 0,
    downsampled: 0, bytesIn: 0, bytesOut: 0,
    routes: Object.create(null),
  };
  const warnings = [];
  const outcomes = [];

  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, ent.name);
      if (ent.isDirectory()) { walk(abs); continue; }
      if (!/\.tex$/i.test(ent.name)) continue;

      const rel = path.relative(dir, abs).split(path.sep).join('/');
      stats.total++;
      if (skip.has(rel)) { stats.kept++; continue; }

      const st = fs.statSync(abs);
      if (st.size > maxFileBytes) {
        stats.budget++;
        warnings.push(`${rel}: 文件 ${(st.size / 1048576).toFixed(1)}MB 超过读取上限，原样保留`);
        outcomes.push({ path: rel, route: 'keep-budget', reason: '文件过大', changed: false, bytesIn: st.size, bytesOut: st.size });
        continue;
      }
      const buf = fs.readFileSync(abs);

      // 断点续转：磁盘上这份文件已经等于上次的输出，就直接跳过
      const shaIn = checkpoint ? sha256Buffer(buf) : null;
      if (checkpoint && checkpoint.isResolved(rel, shaIn)) {
        stats.resumed++;
        onLog(`  [纹理] ${rel}: 已是上次转换的产物，跳过`);
        continue;
      }

      let r;
      try {
        r = convertTexBuffer(buf, { relPath: rel, preset, maxRgbaBytes, semantic: semanticFn(rel), scale });
      } catch (e) {
        stats.failed++;
        warnings.push(`${rel}: 转换失败，已保留原文件（${e.message}）`);
        outcomes.push({ path: rel, route: 'failed', reason: e.message, changed: false, bytesIn: st.size, bytesOut: st.size });
        onLog(`  [纹理] ${rel}: 转换失败 -> 保留原文件（${e.message}）`);
        continue;
      }
      stats.routes[r.route] = (stats.routes[r.route] || 0) + 1;

      if (r.changed) {
        writeFileAtomic(abs, r.bytes);
        if (checkpoint) checkpoint.record(rel, shaIn, sha256Buffer(r.bytes), r.route);
        stats.converted++;
        if (r.downsampled) stats.downsampled++;
        stats.bytesIn += buf.length;
        stats.bytesOut += r.bytes.length;
        const ratio = buf.length ? ((1 - r.bytes.length / buf.length) * 100).toFixed(0) : '0';
        onLog(`  [纹理] ${rel}: ${r.reason} ${r.width}x${r.height} (${(buf.length / 1048576).toFixed(2)} -> ${(r.bytes.length / 1048576).toFixed(2)} MB, ${ratio}%)`);
      } else {
        if (r.route === 'keep-budget') stats.budget++;
        else if (r.route.startsWith('keep-video') || r.route.startsWith('video-texture')) stats.video++;
        else if (r.route === 'failed') stats.failed++;
        else stats.kept++;
        // 原样保留的也记一笔，续转时不会反复解析
        if (checkpoint && r.route !== 'failed') checkpoint.record(rel, shaIn, shaIn, r.route);
        if (r.route === 'keep-budget' || r.route === 'keep-unsupported' || r.route === 'keep-video-unverified'
          || r.route === 'keep-video-noffmpeg' || r.route === 'keep-video-transcode-failed' || r.route === 'failed') {
          warnings.push(`${rel}: ${r.reason}`);
        }
      }
      const outcome = {
        path: rel, route: r.route, reason: r.reason, changed: !!r.changed,
        width: r.width, height: r.height, downsampled: !!r.downsampled,
        sourceWidth: r.sourceWidth, sourceHeight: r.sourceHeight,
        bytesIn: buf.length, bytesOut: r.changed ? r.bytes.length : buf.length,
      };
      outcomes.push(outcome);
      if (opts.onResource) opts.onResource(outcome);
    }
  };
  walk(dir);

  if (stats.total) {
    onLog(`  纹理统计: 共 ${stats.total} 条，转换 ${stats.converted}（其中降采样 ${stats.downsampled}），保留 ${stats.kept}，视频 ${stats.video}，超预算 ${stats.budget}，失败 ${stats.failed}${stats.resumed ? `，续转跳过 ${stats.resumed}` : ''}`);
  }
  return { stats, warnings, outcomes };
}

/** 兼容旧接口：把直通编码图物化成移动端 RGBA8（单文件） */
function materializeTex(buf) {
  return convertTexBuffer(buf, { preset: PRESETS.original });
}

module.exports = {
  parseTex, classify, isMobileCompatible, inspectTex, convertTexBuffer, convertTexDir, materializeTex,
  verifyMobileTex, writeMobileTex, buildVideoTex, videoPayload, semanticOf, presetOf, PRESETS,
  decodePng, decodeJpeg, decodeImage,
  FREE_IMAGE, TEX_FORMAT, TEX_FLAGS, DEFAULT_MAX_RGBA_BYTES,
};

