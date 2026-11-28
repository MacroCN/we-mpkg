/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 MacroCN
 */
'use strict';
/**
 * 转换计划（plan）与断点续转（checkpoint）。
 *
 * 为什么要这一层：一条壁纸的纹理转换可能要几十秒到几分钟（4K 图 + LZ4 + 降采样），
 * 手机端进程被杀、桌面上手动中断都很常见。没有续转，中断一次就得从头再转。
 *
 * 做法：
 *   plan.json          —— 本次转换的"清单"：预设、策略版本、每个资源的类型/大小/哈希。
 *                         内容稳定、可解释，出问题能对照。
 *   checkpoint.json    —— 每个资源转换完成后的指纹（输入 sha / 输出 sha / 处理路线）。
 *                         续转时先看"文件当前 sha 是不是已经等于输出 sha"，
 *                         相等就跳过；不相等再比对输入 sha 决定要不要重转。
 *
 * 两个文件都写在本次打包的 workDir 里，用「写临时文件 + 原子 rename」落盘，
 * 写到一半断电也不会留下半截 JSON。文件损坏时按"没有 checkpoint"处理，不会卡死。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PLAN_VERSION = 2;
const CHECKPOINT_VERSION = 2;

/** 流式计算文件 sha256（大文件也不会一次读进内存） */
function sha256File(file, chunkSize = 1 << 20) {
  const fd = fs.openSync(file, 'r');
  try {
    const hash = crypto.createHash('sha256');
    const buf = Buffer.alloc(chunkSize);
    let read;
    while ((read = fs.readSync(fd, buf, 0, chunkSize, null)) > 0) {
      hash.update(buf.subarray(0, read));
    }
    return hash.digest('hex');
  } finally {
    fs.closeSync(fd);
  }
}

function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** 原子写 JSON：先写 .tmp 再改名 */
function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** 资源类型判定 */
function resourceKind(relPath) {
  const lower = relPath.toLowerCase();
  if (lower.endsWith('.tex')) return 'texture';
  if (lower.endsWith('.frag') || lower.endsWith('.vert')) return 'shader';
  if (/\.(mp3|wav|ogg|flac|aac|m4a|opus)$/.test(lower)) return 'audio';
  return 'other';
}

/**
 * 生成转换计划（会读一遍纹理/着色器算哈希，只对这两类做）
 * @param {{dir:string, preset:object, preserveAudio?:boolean, maxFileBytes?:number}} opts
 */
function buildPlan(opts) {
  const dir = opts.dir;
  const preset = opts.preset;
  const resources = [];
  let totalBytes = 0;

  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, ent.name);
      if (ent.isDirectory()) { walk(abs); continue; }
      if (ent.isSymbolicLink()) continue;
      const rel = path.relative(dir, abs).split(path.sep).join('/');
      const stat = fs.statSync(abs);
      totalBytes += stat.size;
      const kind = resourceKind(rel);
      const item = { path: rel, kind, size: stat.size };
      if (kind === 'texture' || kind === 'shader') {
        // 超大文件不算哈希：它反正会被跳过，省一次全量读取
        if (!(opts.maxFileBytes && stat.size > opts.maxFileBytes)) item.sha256 = sha256File(abs);
      }
      resources.push(item);
    }
  };
  walk(dir);
  resources.sort((a, b) => (a.path < b.path ? -1 : (a.path > b.path ? 1 : 0)));

  return {
    version: PLAN_VERSION,
    policy: 'mobile-rgba-lz4-v3-uniform-scale',
    createdAt: new Date().toISOString(),
    preset: { id: preset.id, reduction: preset.reduction, maxDimension: preset.maxDimension },
    preserveAudio: !!opts.preserveAudio,
    resourceCount: resources.length,
    totalBytes,
    resources,
  };
}

function writePlan(file, plan) {
  writeJsonAtomic(file, plan);
}

/**
 * 断点记录。
 *  entries[rel] = { inSha, outSha, route, at }
 *  纹理改用 has()+文件形态判断续转，inSha/outSha 可为 null；shader 仍用 outSha 比哈希
 */
class Checkpoint {
  constructor(file) {
    this.file = file;
    this.state = readJsonSafe(file);
    if (!this.state || this.state.version !== CHECKPOINT_VERSION || typeof this.state.entries !== 'object' || !this.state.entries) {
      // 版本不对 / 文件坏了 → 当作没有续转记录，不阻塞打包
      this.state = { version: CHECKPOINT_VERSION, policy: '', entries: Object.create(null) };
      this.loadedFromDisk = false;
    } else {
      this.loadedFromDisk = true;
    }
    this.dirty = false;
  }

  /** 是否有这条文件的断点记录（纹理只靠记录 + 文件形态判断，不再比哈希） */
  has(rel) {
    return Object.prototype.hasOwnProperty.call(this.state.entries, rel);
  }

  /** 只接受同一策略的断点：预设或策略变了，旧记录作废 */
  bind(policy) {
    if (this.state.policy !== policy) {
      this.state.policy = policy;
      this.state.entries = Object.create(null);
      this.loadedFromDisk = false;
      this.dirty = true;
    }
  }

  entry(rel) {
    return this.state.entries[rel] || null;
  }

  /**
   * 当前磁盘上的文件是否已经是"转换完成"的产物。
   * @param {string} rel
   * @param {string} currentSha 文件当前内容的 sha
   */
  isResolved(rel, currentSha) {
    const e = this.entry(rel);
    return !!(e && e.outSha && e.outSha === currentSha);
  }

  record(rel, inSha, outSha, route) {
    this.state.entries[rel] = { inSha, outSha, route, at: Date.now() };
    this.dirty = true;
  }

  /** 落盘（有变化才写，失败不影响主流程） */
  flush() {
    if (!this.dirty) return true;
    try {
      writeJsonAtomic(this.file, this.state);
      this.dirty = false;
      return true;
    } catch {
      return false;
    }
  }

  get resolvedCount() {
    return Object.keys(this.state.entries).length;
  }
}

module.exports = {
  PLAN_VERSION, CHECKPOINT_VERSION,
  sha256File, sha256Buffer, writeJsonAtomic, readJsonSafe,
  resourceKind, buildPlan, writePlan, Checkpoint,
};
