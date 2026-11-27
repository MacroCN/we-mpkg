#!/usr/bin/env node
'use strict';
/**
 * 生成「格式黄金样本集」（阶段 0）。
 *
 * 每个用例 = 固定输入 + 期望输出字节，用来锁住当前的格式行为：
 *   - 任何语言重写（Rust / WASM / 其他）都必须逐字节对齐这些输出；
 *   - 现有 JS 实现改动后也要重新对照，避免悄悄改坏兼容性。
 *
 * 产物：test/golden/format/<case>/{in.bin,out.bin} + manifest.json
 * 生成时强制走纯 JS 实现（WE_TEX_RUST=off），避免用 Rust 结果给自己当基准。
 *
 * 用法：node tools/make-golden-format.js
 */
process.env.WE_TEX_RUST = 'off';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const outRoot = path.join(root, 'test', 'golden', 'format');
const dxt = require(path.join(root, 'src', 'dxt'));
const lz4 = require(path.join(root, 'src', 'lz4'));
const tex = require(path.join(root, 'src', 'tex'));

/** 确定性伪随机：同一个 seed 每次生成的字节完全一样 */
function rnd(n, seed) {
  const buf = Buffer.alloc(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    buf[i] = (s >>> 8) & 0xff;
  }
  return buf;
}

/** 可压缩数据：重复片段 + 少量噪声，用来让 LZ4 真正走匹配分支 */
function compressible(n, seed) {
  const base = rnd(64, seed);
  const buf = Buffer.alloc(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    if (i % 7 === 0) {
      s = (Math.imul(s, 1103515245) + 12345) >>> 0;
      buf[i] = (s >>> 9) & 0xff;
    } else {
      buf[i] = base[i % base.length];
    }
  }
  return buf;
}

function buildTex(opts) {
  const {
    format = tex.TEX_FORMAT.DXT1, flags = 0,
    texW = 4, texH = 4, imgW = texW, imgH = texH,
    imageFormat = -1, videoMp4 = 0, container = 'TEXB0004',
    images = [], tail = null,
  } = opts;
  const parts = [Buffer.from('TEXV0005\0'), Buffer.from('TEXI0001\0')];
  const head = Buffer.alloc(28);
  head.writeInt32LE(format, 0);
  head.writeInt32LE(flags, 4);
  head.writeInt32LE(texW, 8);
  head.writeInt32LE(texH, 12);
  head.writeInt32LE(imgW, 16);
  head.writeInt32LE(imgH, 20);
  head.writeUInt32LE(0, 24);
  parts.push(head, Buffer.from(container + '\0'));
  const ic = Buffer.alloc(4);
  ic.writeInt32LE(images.length, 0);
  parts.push(ic);
  if (container === 'TEXB0003' || container === 'TEXB0004') {
    const ifmt = Buffer.alloc(container === 'TEXB0004' ? 8 : 4);
    ifmt.writeInt32LE(imageFormat, 0);
    if (container === 'TEXB0004') ifmt.writeInt32LE(videoMp4, 4);
    parts.push(ifmt);
  }
  for (const img of images) {
    const mc = Buffer.alloc(4);
    mc.writeInt32LE(img.mips.length, 0);
    parts.push(mc);
    for (const m of img.mips) {
      const recLen = container === 'TEXB0001' ? 8 : 16;
      const rec = Buffer.alloc(recLen);
      rec.writeInt32LE(m.w, 0);
      rec.writeInt32LE(m.h, 4);
      if (recLen === 16) {
        rec.writeInt32LE(m.lz4 ? 1 : 0, 8);
        rec.writeInt32LE(m.decompressed || m.bytes.length, 12);
      }
      const len = Buffer.alloc(4);
      len.writeInt32LE(m.bytes.length, 0);
      parts.push(rec, len, m.bytes);
    }
  }
  if (tail) parts.push(tail);
  return Buffer.concat(parts);
}

function dxtBlocks(w, h, blockBytes, seed) {
  return rnd(Math.ceil(w / 4) * Math.ceil(h / 4) * blockBytes, seed);
}


/** 造一个最小 PNG：只用于黄金样本，过滤方式与 colorType 覆盖常见路径 */
function makePng({ width, height, colorType, bitDepth, rows, plte, trns }) {
  const zlib = require('zlib');
  const chunk = (type, data) => {
    const b = Buffer.alloc(8 + data.length + 4);
    b.writeUInt32BE(data.length, 0);
    b.write(type, 4, 'ascii');
    data.copy(b, 8);
    b.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
    return b;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  const parts = [
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
  ];
  if (plte) parts.push(chunk('PLTE', plte));
  if (trns) parts.push(chunk('tRNS', trns));
  parts.push(chunk('IDAT', zlib.deflateSync(rows, { level: 9 })));
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

/** 按给定 filter 列表把像素行编码成 PNG 的 raw 数据（与之字形解码器无关，纯测试素材） */
function pngRows(pixels, width, height, channels, bitDepth, filters) {
  const rowBytes = Math.ceil((width * channels * bitDepth) / 8);
  const bpp = Math.max(1, Math.ceil((channels * bitDepth) / 8));
  const out = Buffer.alloc(height * (rowBytes + 1));
  for (let y = 0; y < height; y++) {
    const f = filters[y % filters.length];
    out[y * (rowBytes + 1)] = f;
    for (let x = 0; x < rowBytes; x++) {
      const cur = pixels[y * rowBytes + x];
      const left = x >= bpp ? pixels[y * rowBytes + x - bpp] : 0;
      const up = y > 0 ? pixels[(y - 1) * rowBytes + x] : 0;
      const ul = y > 0 && x >= bpp ? pixels[(y - 1) * rowBytes + x - bpp] : 0;
      let v;
      switch (f) {
        case 0: v = cur; break;
        case 1: v = cur - left; break;
        case 2: v = cur - up; break;
        case 3: v = cur - ((left + up) >> 1); break;
        default: {
          const p = left + up - ul;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - ul);
          v = cur - (pa <= pb && pa <= pc ? left : (pb <= pc ? up : ul));
        }
      }
      out[y * (rowBytes + 1) + 1 + x] = v & 0xff;
    }
  }
  return out;
}

const cases = [];

function addCase(name, kind, input, build, meta = {}) {
  cases.push({ name, kind, input, build, meta });
}

// ---- DXT 解码（三种最常用格式） ----
addCase('dxt1-decode-8x8', 'dxt-decode', dxtBlocks(8, 8, 8, 11),
  (buf) => dxt.decode(buf, dxt.TEX_FORMAT.DXT1, 8, 8),
  { format: 'dxt1', width: 8, height: 8 });
addCase('dxt3-decode-8x8', 'dxt-decode', dxtBlocks(8, 8, 16, 13),
  (buf) => dxt.decode(buf, dxt.TEX_FORMAT.DXT3, 8, 8),
  { format: 'dxt3', width: 8, height: 8 });
addCase('dxt5-decode-13x7', 'dxt-decode', dxtBlocks(13, 7, 16, 17),
  (buf) => dxt.decode(buf, dxt.TEX_FORMAT.DXT5, 13, 7),
  { format: 'dxt5', width: 13, height: 7 });

// ---- LZ4 块编解码 ----
const lz4Raw = compressible(4096, 19);
addCase('lz4-compress-4k', 'lz4-compress', lz4Raw, (buf) => lz4.compress(buf), {});
const lz4Packed = lz4.compress(lz4Raw);
addCase('lz4-decompress-4k', 'lz4-decompress', lz4Packed,
  (buf) => lz4.decompress(buf, lz4Raw.length),
  { expectedSize: lz4Raw.length, expectedSha256: crypto.createHash('sha256').update(lz4Raw).digest('hex') });

// ---- 整包纹理转换（容器 + 缩放 + LZ4 一起覆盖） ----
const texSrc = buildTex({
  texW: 4, texH: 4,
  images: [{ mips: [{ w: 4, h: 4, bytes: dxtBlocks(4, 4, 8, 23) }] }],
});
addCase('tex-convert-dxt1-4x4', 'tex-convert', texSrc,
  (buf) => tex.convertTexBuffer(buf, { relPath: 'materials/黄金样本.tex' }).bytes,
  { preset: 'default' });

const texBig = buildTex({
  texW: 32, texH: 32,
  images: [{ mips: [{ w: 32, h: 32, bytes: dxtBlocks(32, 32, 8, 29) }] }],
});
addCase('tex-convert-dxt1-32x32', 'tex-convert', texBig,
  (buf) => tex.convertTexBuffer(buf, { relPath: 'materials/大图.tex', preset: 'balanced' }).bytes,
  { preset: 'balanced' });


// ---- 直通 PNG（整包转换也走 Rust：解码 + 裁剪 + 缩放 + LZ4 一条链） ----
const texPng = buildTex({
  format: tex.TEX_FORMAT.RGBA8888,
  texW: 16, texH: 16, imageFormat: tex.FREE_IMAGE.PNG,
  images: [{ mips: [{ w: 16, h: 16, bytes: makePng({ width: 16, height: 16, colorType: 6, bitDepth: 8, rows: pngRows(rnd(16 * 16 * 4, 47), 16, 16, 4, 8, [0, 1, 2, 3, 4]) }) }] }],
});
addCase('tex-convert-png-passthrough-16x16', 'tex-convert', texPng,
  (buf) => tex.convertTexBuffer(buf, { relPath: 'materials/直通.tex' }).bytes,
  { preset: 'default' });

const bigPngBytes = makePng({ width: 40, height: 40, colorType: 2, bitDepth: 8, rows: pngRows(rnd(40 * 40 * 3, 53), 40, 40, 3, 8, [1]) });
const texPngBig = buildTex({
  format: tex.TEX_FORMAT.RGBA8888,
  texW: 40, texH: 40, imageFormat: tex.FREE_IMAGE.PNG,
  images: [{ mips: [{ w: 40, h: 40, bytes: bigPngBytes }] }],
});
addCase('tex-convert-png-passthrough-40x40', 'tex-convert', texPngBig,
  (buf) => tex.convertTexBuffer(buf, { relPath: 'materials/直通大图.tex', preset: 'balanced' }).bytes,
  { preset: 'balanced' });

// ---- 直通形态（不该改写字节） ----
const texMobile = buildTex({
  format: tex.TEX_FORMAT.RGBA8888,
  texW: 8, texH: 8,
  images: [{ mips: [{ w: 8, h: 8, bytes: rnd(8 * 8 * 4, 31), lz4: 0, decompressed: 8 * 8 * 4 }] }],
});
addCase('tex-keep-mobile-8x8', 'tex-convert', texMobile,
  (buf) => {
    const r = tex.convertTexBuffer(buf, { relPath: 'materials/已适配.tex' });
    return r.bytes || buf; // 已适配的纹理不改写，期望输出就是原字节
  },
  { expectUnchanged: true });


// ---- PNG 解码（直通纹理路径：Rust 与 JS 必须逐字节一致） ----
const pngPix = rnd(16 * 16 * 4, 41);
addCase('png-decode-rgba8-16x16', 'png-decode',
  makePng({
    width: 16, height: 16, colorType: 6, bitDepth: 8,
    rows: pngRows(pngPix, 16, 16, 4, 8, [0, 1, 2, 3, 4]),
  }),
  (buf) => tex.decodePng(buf).data,
  { width: 16, height: 16 });

const pal = Buffer.alloc(16 * 3);
for (let i = 0; i < pal.length; i++) pal[i] = (i * 19) & 0xff;
const palTrns = Buffer.alloc(16);
for (let i = 0; i < 16; i++) palTrns[i] = (i * 17) & 0xff;
const palIdx = Buffer.alloc(10 * 10);
for (let i = 0; i < palIdx.length; i++) palIdx[i] = i % 16;
addCase('png-decode-palette4-10x10', 'png-decode',
  makePng({
    width: 10, height: 10, colorType: 3, bitDepth: 4,
    rows: pngRows(palIdx, 10, 10, 1, 4, [0]),
    plte: pal, trns: palTrns,
  }),
  (buf) => tex.decodePng(buf).data,
  { width: 10, height: 10 });

const gray16 = rnd(9 * 9 * 2, 43);
addCase('png-decode-gray16-9x9', 'png-decode',
  makePng({
    width: 9, height: 9, colorType: 0, bitDepth: 16,
    rows: pngRows(gray16, 9, 9, 1, 16, [2]),
  }),
  (buf) => tex.decodePng(buf).data,
  { width: 9, height: 9 });


// ---- JPEG 解码（baseline / 渐进式，Rust 输出必须与 jpeg-js 逐字节一致） ----
function makeJpegRgba(w, h, seed) {
  const px = rnd(w * h * 4, seed);
  for (let i = 3; i < px.length; i += 4) px[i] = 255;
  return require('jpeg-js').encode({ data: px, width: w, height: h }, 70).data;
}

const jpegBase = makeJpegRgba(16, 16, 61);
addCase('jpeg-decode-baseline-16x16', 'jpeg-decode', jpegBase,
  (buf) => tex.decodeJpeg(buf).data, { width: 16, height: 16 });

// 渐进式样本固定内联（PIL 生成，jpeg-js 编码器只能出 baseline）
const jpegProg = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/wgALCAAoADABAREA/8QAGAABAQEBAQAAAAAAAAAAAAAABQcGAAP/2gAIAQEAAAABxTbTbGXPbaHnvVXynJ7bZOababYljbbQ89//xAAZEAADAQEBAAAAAAAAAAAAAAAAAwQCBQH/2gAIAQEAAQUCVOKnFTipzCfMZ6HeUj1U4qcVOXdiWLVldPR2qcVOV3xwFvVsuFTipxU5b3qHipxU4qcVOYT5jKpxU4qcVOXdiWLVldPR3//EACYQAAIBAgMIAwAAAAAAAAAAAAECAxEhACBBBBATIjJCcdFSU8H/2gAIAQEABj8CyFnoFFyTpjh7CqzPq56R7yNGgM8y2KrYDycVnbl0jXpG+kz1k+tLtgrXhQnsT9OuQpsi8CP5dx9ZSz0Ci5J0ytGgM8y2KrYDycVnbl0jXpGP/8QAHRAAAgMBAQEBAQAAAAAAAAAAASEAETFBYVGRof/aAAgBAQABPyHJTJTJTJQlQWwoAOmUFLouvB+mDWbMlMlMlDtysLKX6ZbFGoK1hpgGHa+sv2ZKZKZN/wCBvxG3U6HwzsP0Q0eeTJTJTJRn3Y6E++KxgjZkpkpkpkoSoLYUAHTMlMlMlMlDtysLKX6ZbFGoK1hpgGHa+sv2f//aAAgBAQAAABC+y7fb/8QAHBABAQEBAQEAAwAAAAAAAAAAAREA8SFBMVFh/9oACAEBAAE/EObubububkk/HCqo+AAqu9kuIwpgRsPA9IfQc3c3c3JErGK0kSx8CUo3sTVIokNb9BX0WQObubrvinmfZ4oeUXRZfxv3JgNcT7ETxwZdzdzdzd/JAJyL8WlK8Debubububkk/HCqo+AAqu5u5u5u5uSJWMVpIlj4EpRvYmqRRIa36Cvosgf/2Q==',
  'base64'
);
addCase('jpeg-decode-progressive-48x40', 'jpeg-decode', jpegProg,
  (buf) => tex.decodeJpeg(buf).data, { width: 48, height: 40 });

// ---- 直通 JPEG 纹理：解码 + 裁剪 + 缩放 + LZ4 一条链 ----
const texJpeg = buildTex({
  format: tex.TEX_FORMAT.RGBA8888,
  texW: 16, texH: 16, imageFormat: tex.FREE_IMAGE.JPEG,
  images: [{ mips: [{ w: 16, h: 16, bytes: jpegBase }] }],
});
addCase('tex-convert-jpeg-passthrough-16x16', 'tex-convert', texJpeg,
  (buf) => tex.convertTexBuffer(buf, { relPath: 'materials/直通jpeg.tex' }).bytes,
  { preset: 'default' });

const texJpegProg = buildTex({
  format: tex.TEX_FORMAT.RGBA8888,
  texW: 48, texH: 40, imageFormat: tex.FREE_IMAGE.JPEG,
  images: [{ mips: [{ w: 48, h: 40, bytes: jpegProg }] }],
});
addCase('tex-convert-jpeg-progressive-48x40', 'tex-convert', texJpegProg,
  (buf) => tex.convertTexBuffer(buf, { relPath: 'materials/直通jpeg渐进.tex' }).bytes,
  { preset: 'default' });


// ---- 动图（GIF）纹理：帧表 + 尾巴一起进 Rust，尺寸不缩 ----
const gifA = makePng({ width: 8, height: 8, colorType: 6, bitDepth: 8, rows: pngRows(rnd(8 * 8 * 4, 71), 8, 8, 4, 8, [0]) });
const gifB = makePng({ width: 8, height: 8, colorType: 6, bitDepth: 8, rows: pngRows(rnd(8 * 8 * 4, 73), 8, 8, 4, 8, [1]) });
const texGif = buildTex({
  format: tex.TEX_FORMAT.RGBA8888, flags: tex.TEX_FLAGS.IsGif,
  texW: 8, texH: 8, imageFormat: tex.FREE_IMAGE.GIF,
  images: [
    { mips: [{ w: 8, h: 8, bytes: gifA }] },
    { mips: [{ w: 8, h: 8, bytes: gifB }] },
  ],
  tail: Buffer.from([9, 8, 7, 6, 5, 4]),
});
addCase('tex-convert-gif-animated-8x8', 'tex-convert', texGif,
  (buf) => tex.convertTexBuffer(buf, { relPath: 'materials/动图.tex' }).bytes,
  { preset: 'default' });

// ---- 写盘 ----
fs.rmSync(outRoot, { recursive: true, force: true });
fs.mkdirSync(outRoot, { recursive: true });

const manifest = [];
for (const c of cases) {
  const dir = path.join(outRoot, c.name);
  fs.mkdirSync(dir, { recursive: true });
  const output = c.build(c.input);
  fs.writeFileSync(path.join(dir, 'in.bin'), c.input);
  fs.writeFileSync(path.join(dir, 'out.bin'), output);
  manifest.push({
    name: c.name,
    kind: c.kind,
    input: `${c.name}/in.bin`,
    output: `${c.name}/out.bin`,
    inputBytes: c.input.length,
    outputBytes: output.length,
    outputSha256: crypto.createHash('sha256').update(output).digest('hex'),
    ...c.meta,
  });
  console.log(`  ✔ ${c.name}  in=${c.input.length}B out=${output.length}B`);
}

fs.writeFileSync(path.join(outRoot, 'manifest.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  generator: 'tools/make-golden-format.js',
  note: '期望输出由纯 JS 实现生成（WE_TEX_RUST=off），任何重写都必须逐字节对齐',
  cases: manifest,
}, null, 2) + '\n');

console.log(`\n黄金样本集: ${cases.length} 个用例 -> ${path.relative(root, outRoot)}`);
