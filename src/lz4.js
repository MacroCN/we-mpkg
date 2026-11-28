/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 MacroCN
 */
'use strict';
/**
 * LZ4 块编解码（不是 LZ4 frame）。实现整体在 Rust（rust/tex-cli/src/lz4.rs），
 * 这里只做参数校验和转调：引擎是必需组件，缺引擎直接抛错，没有 JS 兜底。
 */

const rusttex = require('./rusttex');

/** 压缩一段数据，返回 LZ4 block（末尾是纯字面量、最后 5 字节不参与匹配）。 */
function compress(src) {
  if (!Buffer.isBuffer(src) && !(src instanceof Uint8Array)) throw new Error('LZ4 压缩只接受 Buffer');
  return rusttex.lz4Compress(Buffer.from(src));
}

/** 解压，expectedSize 是解压后长度（必填：LZ4 block 自带不完整的长度信息）。 */
function decompress(src, expectedSize) {
  if (!Number.isInteger(expectedSize) || expectedSize < 0) throw new Error(`LZ4 解压长度非法: ${expectedSize}`);
  const out = rusttex.lz4Decompress(Buffer.from(src), expectedSize);
  if (!out) throw new Error('rust-tex lz4 不可用（临时目录创建失败）');
  if (out.length !== expectedSize) throw new Error(`LZ4 解压长度不符: ${out.length} != ${expectedSize}`);
  return out;
}

module.exports = { compress, decompress };
