#!/usr/bin/env node
'use strict';
/**
 * check-16k.js —— 检查 ELF64 共享库是否满足 Android 16「16 KB 页」要求。
 *
 *   node tools/check-16k.js <file.so> [more.so ...]
 *
 * 判定（与系统安装时的检查一致）：每个 PT_LOAD 段 p_align >= 16384，
 * 且 p_offset 与 p_vaddr 在 16 KB 下同余。
 * 全部达标退出码 0，否则 1（构建脚本据此决定要不要跑 tools/align16k.js）。
 */
const fs = require('fs');
const path = require('path');

const PAGE = 16384;

function inspect(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 64 || buf.readUInt32LE(0) !== 0x464c457f) throw new Error('不是 ELF 文件');
  if (buf.readUInt8(4) !== 2) throw new Error('只支持 ELF64');
  if (buf.readUInt8(5) !== 1) throw new Error('只支持小端');

  const e_phoff = Number(buf.readBigUInt64LE(0x20));
  const e_phentsize = buf.readUInt16LE(0x36);
  const e_phnum = buf.readUInt16LE(0x38);
  const bad = [];
  let loads = 0;
  for (let i = 0; i < e_phnum; i++) {
    const off = e_phoff + i * e_phentsize;
    if (buf.readUInt32LE(off) !== 1) continue; // PT_LOAD
    loads++;
    const p_offset = Number(buf.readBigUInt64LE(off + 0x08));
    const p_vaddr = Number(buf.readBigUInt64LE(off + 0x10));
    const p_align = Number(buf.readBigUInt64LE(off + 0x30));
    if (p_align < PAGE || (p_offset % PAGE) !== (p_vaddr % PAGE)) {
      bad.push({ p_offset, p_vaddr, p_align });
    }
  }
  return { loads, bad };
}

let failed = 0;
for (const file of process.argv.slice(2)) {
  try {
    const r = inspect(file);
    if (!r.loads) {
      console.log(`${path.basename(file)}  WARN 没有 PT_LOAD 段`);
      continue;
    }
    if (r.bad.length === 0) {
      console.log(`${path.basename(file)}  OK  ${r.loads} 个 LOAD 段均 >= 16 KB`);
    } else {
      failed++;
      console.log(`${path.basename(file)}  NG  ${r.bad.length}/${r.loads} 个 LOAD 段未对齐: `
        + r.bad.map((b) => `align=${b.p_align}`).join(', '));
    }
  } catch (e) {
    failed++;
    console.log(`${path.basename(file)}  NG  ${e.message}`);
  }
}
process.exit(failed ? 1 : 0);
