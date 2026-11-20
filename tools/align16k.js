#!/usr/bin/env node
/**
 * align16k.js —— 把 ELF64 共享库的 PT_LOAD 段对齐到 16 KB 页，满足 Android 16 的
 * 「16 KB page size」兼容性要求（不改任何虚拟地址/符号，只在文件里插入对齐填充）。
 *
 *   node tools/align16k.js <input.so> [output.so]
 *
 * 原理：Android 的检查项是「每个 LOAD 段的 p_align >= 16384，且 p_vaddr 与 p_offset 在
 * 16 KB 下同余」。虚拟地址一个字节都不动，只在段与段之间的文件间隙补齐字节，
 * 再改写 program/section header 里的文件偏移，因此重定位、符号表、代码都不用重写。
 */
const fs = require('fs');
const path = require('path');

const PAGE = 16384;

function main() {
  const inPath = process.argv[2];
  const outPath = process.argv[3] || inPath.replace(/\.so$/i, '') + '.16k.so';
  if (!inPath) {
    console.error('用法: node tools/align16k.js <input.so> [output.so]');
    process.exit(2);
  }
  const src = fs.readFileSync(inPath);

  // --- ELF64 头 ---
  if (src.readUInt32LE(0) !== 0x464c457f) throw new Error('不是 ELF 文件');
  if (src.readUInt8(4) !== 2) throw new Error('只支持 ELF64');
  if (src.readUInt8(5) !== 1) throw new Error('只支持小端');
  const e_phoff = Number(src.readBigUInt64LE(0x20));
  const e_shoff = Number(src.readBigUInt64LE(0x28));
  const e_phentsize = src.readUInt16LE(0x36);
  const e_phnum = src.readUInt16LE(0x38);
  const e_shentsize = src.readUInt16LE(0x3a);
  const e_shnum = src.readUInt16LE(0x3c);

  // --- 收集 program headers ---
  const phs = [];
  for (let i = 0; i < e_phnum; i++) {
    const off = e_phoff + i * e_phentsize;
    phs.push({
      off,
      type: src.readUInt32LE(off),
      flags: src.readUInt32LE(off + 4),
      p_offset: Number(src.readBigUInt64LE(off + 0x08)),
      p_vaddr: Number(src.readBigUInt64LE(off + 0x10)),
      p_filesz: Number(src.readBigUInt64LE(off + 0x20)),
      p_align: Number(src.readBigUInt64LE(off + 0x30)),
    });
  }

  const loads = phs.filter((p) => p.type === 1).sort((a, b) => a.p_offset - b.p_offset);
  if (!loads.length) throw new Error('没有 PT_LOAD 段');

  // --- 计算需要的填充 ---
  let shift = 0;
  const inserts = []; // { at: 原文件偏移, pad }
  for (const l of loads) {
    const curOff = l.p_offset + shift;          // 该段在新文件里的起始位置
    const need = ((l.p_vaddr % PAGE) - (curOff % PAGE) + PAGE * 2) % PAGE;
    l.newOffset = curOff + need;
    if (need > 0) inserts.push({ at: l.p_offset, pad: need });
    shift += need;
  }

  // --- 执行插入（从后往前，坐标不互相干扰）---
  let out = Buffer.from(src);
  for (const ins of inserts.slice().sort((a, b) => b.at - a.at)) {
    const at = ins.at + totalShiftBefore(inserts, ins.at);
    // 上面的 at 已经是「原文件偏移 + 更早插入造成的位移」，但因为我们从后往前处理，
    // 此时缓冲区里还没有插入过比它更早的，所以直接用原偏移即可。
    const pos = ins.at;
    out = Buffer.concat([out.slice(0, pos), Buffer.alloc(ins.pad), out.slice(pos)]);
    void at;
  }

  const mapOffset = (oldOff, atBoundary) => {
    let add = 0;
    for (const ins of inserts) {
      // 插入点位于 oldOff 之前的，会把内容往后推；正好等于 oldOff 的（段起点），
      // 段内容本身也整体后移，所以同样算进去
      if (atBoundary ? ins.at <= oldOff : ins.at < oldOff) add += ins.pad;
    }
    return oldOff + add;
  };

  // --- 改写 program headers ---
  for (const p of phs) {
    const isLoad = p.type === 1;
    // 所有段的文件偏移都跟着位移走（PT_DYNAMIC / PT_NOTE 等也读 p_offset）
    const newOff = mapOffset(p.p_offset, isLoad);
    out.writeBigUInt64LE(BigInt(newOff), p.off + 0x08);
    if (isLoad && p.p_align < PAGE) {
      out.writeBigUInt64LE(BigInt(PAGE), p.off + 0x30);
    }
  }

  // --- 改写 section headers（运行时不用，但工具链/校验工具会看）---
  if (e_shoff && e_shnum) {
    const newShOff = mapOffset(e_shoff, false);
    out.writeBigUInt64LE(BigInt(newShOff), 0x28);
    for (let i = 0; i < e_shnum; i++) {
      const off = newShOff + i * e_shentsize;
      if (off + 0x20 > out.length) break;
      const sh_type = out.readUInt32LE(off + 4);
      const sh_offset = Number(out.readBigUInt64LE(off + 0x18));
      if (sh_type === 8 /* SHT_NOBITS */ || sh_offset === 0) continue;
      out.writeBigUInt64LE(BigInt(mapOffset(sh_offset, false)), off + 0x18);
    }
  }

  fs.writeFileSync(outPath, out);

  // --- 报告 ---
  const P = (n) => n.toString(16);
  console.log(`in : ${path.basename(inPath)}  ${(src.length / 1024 / 1024).toFixed(2)} MB`);
  console.log(`out: ${path.basename(outPath)}  ${(out.length / 1024 / 1024).toFixed(2)} MB`);
  for (const l of loads) {
    const congruent = (l.newOffset % PAGE) === (l.p_vaddr % PAGE);
    console.log(
      `  LOAD vaddr=${P(l.p_vaddr)} offset ${P(l.p_offset)} -> ${P(l.newOffset)}  align ${P(l.p_align)} -> ${P(Math.max(l.p_align, PAGE))}  ${congruent ? 'OK' : 'FAIL'}`
    );
  }
}

function totalShiftBefore(inserts, at) {
  let s = 0;
  for (const i of inserts) if (i.at < at) s += i.pad;
  return s;
}

main();
