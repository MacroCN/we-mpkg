/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 MacroCN
 */
'use strict';
/**
 * DXT1 / DXT2 / DXT3 / DXT4 / DXT5（S3TC）块解码 -> 直色 RGBA8。
 *
 * 解码器整体在 Rust（rust/tex-cli/src/dxt.rs），这里只保留格式常量、载荷尺寸计算
 * 和一个校验长度的薄封装。Rust 是必需组件：没有引擎直接抛错，不再有 JS 实现兜底。
 *
 * 块布局（4x4 像素）：
 *   DXT1            8 字节：color0(565) color1(565) 4x4 个 2bit 索引
 *   DXT2/DXT3      16 字节：8 字节显式 alpha(4bit/像素) + 8 字节颜色块（4 色模式）
 *                  alpha 是标准 S3TC 排布：16 个 nibble 连续占满 8 字节，像素 (x,y) 取第 4y+x 个
 *   DXT4/DXT5      16 字节：2 字节端点 alpha0/alpha1 + 6 字节 3bit 索引 + 8 字节颜色块
 */

const rusttex = require('./rusttex');

const TEX_FORMAT = { DXT5: 4, DXT3: 6, DXT1: 7 };

// TEX 里格式号与 DXT 代号的对应：7=DXT1 / 5=DXT2 / 6=DXT3 / 8=DXT4 / 4=DXT5
const RUST_NAME = { 7: 'dxt1', 5: 'dxt2', 6: 'dxt3', 8: 'dxt4', 4: 'dxt5' };

/** 解码一整张图。宽高不必是 4 的倍数，边缘块由 Rust 按原始尺寸裁剪。 */
function decode(buf, format, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`DXT 尺寸非法: ${width}x${height}`);
  }
  const name = RUST_NAME[format];
  if (!name) throw new Error(`不是 DXT 格式: ${format}`);
  const need = payloadSize(format, width, height);
  if (buf.length < need) throw new Error(`DXT 载荷不足: 需要 ${need} 字节，实际 ${buf.length}`);

  const rgba = rusttex.dxtDecode(buf.subarray(0, need), name, width, height);
  if (!rgba) throw new Error('rust-tex dxt-decode 不可用（临时目录创建失败）');
  if (rgba.length !== width * height * 4) throw new Error(`rust-tex dxt-decode 输出长度异常: ${rgba.length}`);
  return rgba;
}

function payloadSize(format, width, height) {
  const blockBytes = format === TEX_FORMAT.DXT1 ? 8 : 16;
  return Math.ceil(width / 4) * Math.ceil(height / 4) * blockBytes;
}

module.exports = { decode, payloadSize, TEX_FORMAT };
