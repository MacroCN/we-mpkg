/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 MacroCN
 */
'use strict';
/**
 * DXT1 / DXT2 / DXT3 / DXT4 / DXT5（S3TC）块解码 -> 直色 RGBA8。
 *
 * 为什么要解：PC 端壁纸的 .tex 大量是 DXT 块压缩，而移动版 Wallpaper Engine 的
 * 手机 GPU（Adreno / Mali）普遍不带 S3TC，导入后纹理按 RGBA8 解读就是花屏或纯黑。
 * 官方桌面导出手机版时会把 DXT 重新编码成 RGBA8 / ETC2，这里做同样的事：
 * 解成 RGBA8，再按需降采样、LZ4 压缩。
 *
 * 块布局（4x4 像素）：
 *   DXT1            8 字节：color0(565) color1(565) 4x4 个 2bit 索引
 *   DXT2/DXT3      16 字节：8 字节显式 alpha(4bit/像素) + 8 字节颜色块（4 色模式）
 *                  注意：alpha 是标准 S3TC 排布——16 个 nibble 连续占满 8 字节，
 *                  像素 (x,y) 取 nibble 4y+x（即字节 2y 与 2y+1），不是「每行 1 字节」。
 *   DXT4/DXT5      16 字节：2 字节端点 alpha0/alpha1 + 6 字节 3bit 索引 + 8 字节颜色块
 *
 * 颜色量化、alpha 插值都按 S3TC 规范逐字节对齐（和 GPU 解码结果一致），
 * 不做任何近似 —— 这条路线是无损的，输出像素与显卡采样完全相同。
 */

const TEX_FORMAT = { DXT5: 4, DXT3: 6, DXT1: 7 };

// 阶段 1：热点走 Rust CLI（找不到可执行文件时静默回落纯 JS）
const rusttex = require('./rusttex');
const RUST_NAME = { [TEX_FORMAT.DXT1]: 'dxt1', 5: 'dxt2', [TEX_FORMAT.DXT3]: 'dxt3', 8: 'dxt4', [TEX_FORMAT.DXT5]: 'dxt5' };

const round = (v) => Math.max(0, Math.min(255, Math.round(v)));

/** 565 -> {r,g,b}（各通道扩展到 8 位，用位移补低位，与 GPU 一致） */
function expand565(c) {
  const r = (c >> 11) & 0x1f;
  const g = (c >> 5) & 0x3f;
  const b = c & 0x1f;
  return {
    r: (r << 3) | (r >> 2),
    g: (g << 2) | (g >> 4),
    b: (b << 3) | (b >> 2),
  };
}

/** 生成颜色调色板（4 色或 3 色+透明） */
function colorPalette(c0, c1, isDxt1) {
  const a = expand565(c0);
  const b = expand565(c1);
  const pal = [
    [a.r, a.g, a.b, 255],
    [b.r, b.g, b.b, 255],
  ];
  if (!isDxt1 || c0 > c1) {
    pal.push([round((2 * a.r + b.r) / 3), round((2 * a.g + b.g) / 3), round((2 * a.b + b.b) / 3), 255]);
    pal.push([round((a.r + 2 * b.r) / 3), round((a.g + 2 * b.g) / 3), round((a.b + 2 * b.b) / 3), 255]);
  } else {
    pal.push([round((a.r + b.r) / 2), round((a.g + b.g) / 2), round((a.b + b.b) / 2), 255]);
    pal.push([0, 0, 0, 0]); // DXT1 的三色模式：索引 3 是透明黑
  }
  return pal;
}

/** 解码一整张图。宽高不必是 4 的倍数，边缘块按原始尺寸裁剪。 */
function decode(buf, format, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`DXT 尺寸非法: ${width}x${height}`);
  }
  const blockBytes = format === TEX_FORMAT.DXT1 ? 8 : 16;
  if (format !== TEX_FORMAT.DXT1 && format !== TEX_FORMAT.DXT2
    && format !== TEX_FORMAT.DXT3 && format !== TEX_FORMAT.DXT4 && format !== TEX_FORMAT.DXT5) {
    throw new Error(`不是 DXT 格式: ${format}`);
  }
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  const need = blocksX * blocksY * blockBytes;
  if (buf.length < need) throw new Error(`DXT 载荷不足: 需要 ${need} 字节，实际 ${buf.length}`);

  const isDxt1 = format === TEX_FORMAT.DXT1;
  const hasAlpha4 = format === TEX_FORMAT.DXT2 || format === TEX_FORMAT.DXT3;
  const hasAlpha8 = format === TEX_FORMAT.DXT4 || format === TEX_FORMAT.DXT5;

  // Rust 引擎是必需组件：能走就走，执行失败直接抛错（不再退回下面的 JS 实现）
  if (rusttex.enabled() && RUST_NAME[format]) {
    const fast = rusttex.dxtDecode(buf.subarray(0, need), RUST_NAME[format], width, height);
    // 临时目录不可用时桥接层会返回 null，这里必须走显式错误，不能拿 null 当 Buffer
    if (!fast) throw new Error('rust-tex dxt-decode 不可用（临时目录创建失败）');
    if (fast.length !== width * height * 4) throw new Error(`rust-tex dxt-decode 输出长度异常: ${fast.length}`);
    return fast;
  }

  const out = Buffer.alloc(width * height * 4);
  let off = 0;
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      // ---- alpha 部分（若有） ----
      let alphaBits = null;   // DXT3：8 字节
      let alpha8 = null;      // DXT5：a0,a1 + 6 字节索引
      if (hasAlpha4) {
        alphaBits = buf.subarray(off, off + 8);
        off += 8;
      } else if (hasAlpha8) {
        alpha8 = buf.subarray(off, off + 8);
        off += 8;
      }

      // ---- 颜色部分 ----
      const c0 = buf[off] | (buf[off + 1] << 8);
      const c1 = buf[off + 2] | (buf[off + 3] << 8);
      const indices = buf.readUInt32LE(off + 4);
      off += 8;
      const pal = colorPalette(c0, c1, isDxt1);

      for (let y = 0; y < 4; y++) {
        const py = by * 4 + y;
        if (py >= height) break;
        for (let x = 0; x < 4; x++) {
          const px = bx * 4 + x;
          if (px >= width) continue;
          const idx = (indices >>> (2 * (4 * y + x))) & 0x3;
          const c = pal[idx];
          const di = (py * width + px) * 4;
          out[di] = c[0];
          out[di + 1] = c[1];
          out[di + 2] = c[2];

          let alpha = c[3];
          if (hasAlpha4) {
            // 标准 S3TC：16 个 4bit alpha 连续排布，像素 (x,y) 是第 4y+x 个 nibble
            const n = 4 * y + x;
            alpha = (((alphaBits[n >> 1] >> ((n & 1) * 4)) & 0x0f) * 17); // 4bit -> 8bit
          } else if (hasAlpha8) {
            alpha = alphaPalette(alpha8[0], alpha8[1])[alphaIndexAt(alpha8, 4 * y + x)];
          }
          out[di + 3] = alpha;
        }
      }
    }
  }
  return out;
}

/** 取 DXT5 alpha 索引的第 n 个 3bit 值（n 从 0 开始，按像素行优先） */
function alphaIndexAt(alpha8, n) {
  const bitPos = n * 3;
  const byte = 2 + (bitPos >> 3);
  if (byte >= 8) return 0;
  const shift = bitPos & 7;
  // 可能跨越字节边界，读 2 个字节拼出 <=9 位
  const v = alpha8[byte] | ((byte + 1 < 8 ? alpha8[byte + 1] : 0) << 8);
  return (v >>> shift) & 0x7;
}

/** DXT5 alpha 调色板（8 项） */
function alphaPalette(a0, a1) {
  const pal = [a0, a1];
  if (a0 > a1) {
    for (let i = 1; i <= 6; i++) pal.push(round(((7 - i) * a0 + i * a1) / 7));
  } else {
    for (let i = 1; i <= 4; i++) pal.push(round(((5 - i) * a0 + i * a1) / 5));
    pal.push(0);
    pal.push(255);
  }
  return pal;
}

/** 计算某个 DXT 格式在给定尺寸下应有的载荷字节数 */
function payloadSize(format, width, height) {
  const blockBytes = format === TEX_FORMAT.DXT1 ? 8 : 16;
  return Math.ceil(width / 4) * Math.ceil(height / 4) * blockBytes;
}

module.exports = { decode, payloadSize, alphaIndexAt, TEX_FORMAT };
