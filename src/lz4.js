/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 MacroCN
 */
'use strict';
/**
 * LZ4 块格式（raw block）编解码。
 *
 * 移动版 .tex 的 mip 载荷允许用 LZ4 压缩（TEXB0002..0004 里那个 lz4 标志位），
 * Wallpaper Engine 移动端自己解压。打包时先压一遍能显著缩小 mpkg，尤其是把 DXT
 * 解成 RGBA8 之后（像素量涨了 4~8 倍，不压就白涨）。
 *
 * 只实现 LZ4 块格式（不含帧头/校验和），与桌面 lz4 库的 LZ4_compress_default /
 * LZ4_decompress_safe 兼容：
 *   序列 = [token][字面量][offset(2, LE)][匹配长度扩展]
 *   token 高 4 位 = 字面量长度（>=15 时后跟 255 累加，直到 <255）
 *   token 低 4 位 = 匹配长度-4（>=15 时同样累加）
 * 末尾必须是一段纯字面量，且最后 5 个字节不参与匹配（LZ4 规范）。
 */

/** 阶段 1：热点走 Rust CLI。引擎存在但执行失败 -> 直接抛错（不回落）；引擎不可用 -> 用下面的纯 JS 实现 */
const rusttex = require('./rusttex');

/** 4 字节小端读取 */
function read32(buf, i) {
  return buf[i] | (buf[i + 1] << 8) | (buf[i + 2] << 16) | (buf[i + 3] << 24);
}

const HASH_BITS = 16;
const HASH_SIZE = 1 << HASH_BITS;

/** LZ4 官方用的乘性散列，取高 16 位 */
function hash32(v) {
  return Math.imul(v, 2654435761) >>> (32 - HASH_BITS);
}

/**
 * 压缩。返回 Buffer（长度即压缩后长度）。
 * @param {Buffer} src
 * @returns {Buffer}
 */
function compress(src) {
  const n = src.length;
  if (n === 0) return Buffer.alloc(0);
  // Rust 引擎是必需组件；WE_TEX_RUST=off 仅用于回归测试对照 JS 实现
  if (rusttex.enabled()) {
    const fast = rusttex.lz4Compress(src);
    if (!fast.length) throw new Error('rust-tex lz4-compress 输出为空');
    return fast;
  }
  // 纯字面量编码是最坏情况：n + 1 + ceil((n-15)/255) 左右，留一点余量
  const out = Buffer.alloc(n + Math.ceil(n / 255) + 16);
  let op = 0;

  const writeLen = (len) => {
    // 长度 >= 15 的部分用 255 累加
    while (len >= 255) {
      out[op++] = 255;
      len -= 255;
    }
    out[op++] = len;
  };

  // 上一个位置：哈希表存的是「上次出现的起点」
  const table = new Int32Array(HASH_SIZE).fill(-1);
  let anchor = 0;
  let i = 0;
  // 末尾 12 字节不参与匹配（MFLIMIT），保证结尾始终是字面量
  const matchLimit = n - 12;

  while (i < matchLimit) {
    const seq = read32(src, i);
    const h = hash32(seq);
    const cand = table[h];
    table[h] = i;

    if (cand >= 0 && i - cand <= 0xffff && i - cand > 0 && read32(src, cand) === seq) {
      // 向后延伸匹配（能多覆盖一个字节就多覆盖，代价很小）
      let matchLen = 4;
      while (i + matchLen < n - 5 && src[cand + matchLen] === src[i + matchLen]) matchLen++;

      const literals = i - anchor;
      const tokenPos = op++;

      if (literals >= 15) {
        out[tokenPos] = 0xf0;
        writeLen(literals - 15);
      } else {
        out[tokenPos] = literals << 4;
      }
      src.copy(out, op, anchor, i);
      op += literals;

      // offset 必须 >= 1
      const offset = i - cand;
      out[op++] = offset & 0xff;
      out[op++] = (offset >> 8) & 0xff;

      const matchCode = matchLen - 4;
      if (matchCode >= 15) {
        out[tokenPos] |= 0x0f;
        writeLen(matchCode - 15);
      } else {
        out[tokenPos] |= matchCode;
      }

      i += matchLen;
      anchor = i;
      // 匹配后把起点前一个位置补进哈希表，帮助后续找到更长匹配
      if (i - 2 >= 0) table[hash32(read32(src, i - 2))] = i - 2;
    } else {
      i++;
    }
  }

  // 收尾：剩余全部作为字面量
  const tail = n - anchor;
  const tokenPos = op++;
  if (tail >= 15) {
    out[tokenPos] = 0xf0;
    writeLen(tail - 15);
  } else {
    out[tokenPos] = tail << 4;
  }
  src.copy(out, op, anchor, n);
  op += tail;

  return out.subarray(0, op);
}

/**
 * 解压（仅用于自检和读取 LZ4 压缩过的源载荷）。
 * @param {Buffer} src
 * @param {number} expectedSize 目标字节数，用于校验
 * @returns {Buffer}
 */
function decompress(src, expectedSize) {
  if (rusttex.enabled()) {
    const fast = rusttex.lz4Decompress(src, expectedSize);
    if (fast.length !== expectedSize) throw new Error(`rust-tex lz4-decompress 输出 ${fast.length} != ${expectedSize}`);
    return fast;
  }
  const out = Buffer.alloc(expectedSize);
  let ip = 0;
  let op = 0;
  for (;;) {
    if (ip >= src.length) throw new Error('LZ4 数据在 token 处截断');
    const token = src[ip++];
    let literals = token >> 4;
    if (literals === 15) {
      let b;
      do {
        if (ip >= src.length) throw new Error('LZ4 字面量长度截断');
        b = src[ip++];
        literals += b;
      } while (b === 255);
    }
    if (ip + literals > src.length) throw new Error('LZ4 字面量越界');
    if (op + literals > expectedSize) throw new Error('LZ4 输出超出预期长度');
    src.copy(out, op, ip, ip + literals);
    ip += literals;
    op += literals;

    // 末尾序列没有 offset
    if (ip >= src.length) break;

    if (ip + 2 > src.length) throw new Error('LZ4 offset 截断');
    const offset = src[ip] | (src[ip + 1] << 8);
    ip += 2;
    if (offset === 0 || offset > op) throw new Error(`LZ4 offset 非法: ${offset}`);

    let matchLen = token & 0x0f;
    if (matchLen === 15) {
      let b;
      do {
        if (ip >= src.length) throw new Error('LZ4 匹配长度截断');
        b = src[ip++];
        matchLen += b;
      } while (b === 255);
    }
    matchLen += 4;
    if (op + matchLen > expectedSize) throw new Error('LZ4 匹配输出超出预期长度');

    // 允许重叠复制（offset 可以小于 matchLen）
    let from = op - offset;
    for (let k = 0; k < matchLen; k++) out[op + k] = out[from + k];
    op += matchLen;
  }

  if (op !== expectedSize) throw new Error(`LZ4 解压长度不符: ${op} != ${expectedSize}`);
  return out;
}

module.exports = { compress, decompress };
