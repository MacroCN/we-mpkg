// zipalign16.js —— 把 APK 里未压缩存储的 *.so 的数据区重排到 16 KB 边界
// build-tools 34 的 zipalign 没有 -P 16，故自行实现（只重写 zip 结构，不改文件内容）
// 用法: node zipalign16.js <in.apk> <out.apk> [--check]
const fs = require('fs');

const PAGE = 16384;
const SIG_LOCAL = 0x04034b50;
const SIG_CEN = 0x02014b50;
const SIG_EOCD = 0x06054b50;

function parseZip(buf) {
  // 找 EOCD（末尾倒序）
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 65558; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 zip/apk');
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const comment = buf.slice(eocd + 22, eocd + 22 + buf.readUInt16LE(eocd + 20));
  const entries = [];
  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(p) !== SIG_CEN) throw new Error('中央目录损坏 @' + p);
    const e = {
      nameLen: buf.readUInt16LE(p + 28),
      extraLen: buf.readUInt16LE(p + 30),
      commentLen: buf.readUInt16LE(p + 32),
      cOffset: p,
      offset: buf.readUInt32LE(p + 42),
      flags: buf.readUInt16LE(p + 8),
      compSize: buf.readUInt32LE(p + 20),
      uncompSize: buf.readUInt32LE(p + 24),
    };
    e.name = buf.slice(p + 46, p + 46 + e.nameLen).toString('utf8');
    e.data = readEntryData(buf, e.offset);
    entries.push(e);
    p += 46 + e.nameLen + e.extraLen + e.commentLen;
  }
  return { entries, comment };
}

function readEntryData(buf, lhOff) {
  if (buf.readUInt32LE(lhOff) !== SIG_LOCAL) throw new Error('本地头损坏 @' + lhOff);
  const nameLen = buf.readUInt16LE(lhOff + 26);
  const extraLen = buf.readUInt16LE(lhOff + 28);
  const compSize = buf.readUInt32LE(lhOff + 18);
  // 保留本地头里除 extra 以外的字段，extra 之后重新生成
  return {
    header: buf.slice(lhOff, lhOff + 30), // 本地头固定部分 0..29（含 name len @26, extra len @28）
    name: buf.slice(lhOff + 30, lhOff + 30 + nameLen),
    extra: buf.slice(lhOff + 30 + nameLen, lhOff + 30 + nameLen + extraLen),
    dataStart: lhOff + 30 + nameLen + extraLen,
  };
}

function main() {
  const [, , inPath, outPath, flag] = process.argv;
  if (!inPath) { console.error('用法: node zipalign16.js <in.apk> <out.apk> [--check]'); process.exit(2); }
  const buf = fs.readFileSync(inPath);
  const { entries, comment } = parseZip(buf);

  // 检查模式：.so 要 16 KB 对齐，其余未压缩条目要 4 字节对齐
  if (flag === '--check' || outPath === '--check') {
    let bad = 0;
    const z = parseZip(buf);
    for (const e of z.entries) {
      const stored = buf.readUInt16LE(e.offset + 8) === 0;
      if (!stored) continue;
      const isSo = e.name.endsWith('.so');
      const needArsc = e.name === 'resources.arsc';
      if (!isSo && !needArsc) continue;
      const d = readEntryData(buf, e.offset);
      const off = e.offset + 30 + d.name.length + d.extra.length;
      const ok = isSo ? off % PAGE === 0 : off % 4 === 0;
      console.log(`${e.name}  stored=${stored}  dataOffset=${off}  ${ok ? 'OK' : 'MISALIGNED'}`);
      if (!ok) bad++;
    }
    process.exit(bad ? 1 : 0);
  }

  // 丢弃签名文件（重签名时由 apksigner 重新生成）
  const kept = entries.filter((e) => {
    const n = e.name.toUpperCase();
    return !(n.startsWith('META-INF/') && (n.endsWith('.SF') || n.endsWith('.RSA') || n.endsWith('.DSA') || n.endsWith('MANIFEST.MF')));
  });

  const chunks = [];
  let offset = 0;
  const written = [];
  for (const e of kept) {
    const d = readEntryData(buf, e.offset);
    const method = buf.readUInt16LE(e.offset + 8);
    let extra = d.extra;
    // 未压缩条目按 4 字节对齐（resources.arsc 这类系统要求），.so 提到 16 KB
    // 对齐：往 extra 里塞一个 0xFFFF 填充块
    const align = method !== 0 ? 0 : (e.name.endsWith('.so') ? PAGE : 4);
    if (align) {
      const base = offset + 30 + d.name.length + extra.length;
      let pad = (align - (base % align)) % align;
      if (pad > 0 && pad < 4) pad += align;
      if (pad > 0) {
        const block = Buffer.alloc(pad);
        block.writeUInt16LE(0xffff, 0);
        block.writeUInt16LE(pad - 4, 2);
        extra = Buffer.concat([extra, block]);
      }
    }
    // 本地头：拷原固定 30 字节，写回真实大小、清掉 data descriptor 标志、改 extra 长度
    const fixed = Buffer.from(d.header);
    fixed.writeUInt16LE(e.flags & ~0x0008, 6);
    fixed.writeUInt32LE(e.compSize, 18);
    fixed.writeUInt32LE(e.uncompSize, 22);
    fixed.writeUInt16LE(extra.length, 28);
    const bytes = buf.slice(d.dataStart, d.dataStart + e.compSize);
    chunks.push(fixed, d.name, extra, bytes);
    const dataOff = offset + 30 + d.name.length + extra.length;
    written.push({ e, d, method, extra, localOff: offset, dataOff, size: e.compSize });
    offset = dataOff + e.compSize;
  }

  // 中央目录
  const cenChunks = [];
  let cenOff = offset;
  for (const w of written) {
    const src = buf; // 原中央目录记录，逐字段拷出再改
    const cen = Buffer.from(src.slice(w.e.cOffset, w.e.cOffset + 46));
    cen.writeUInt16LE(w.extra.length, 30);      // extra len
    cen.writeUInt16LE(w.e.flags & ~0x0008, 8);  // 清 data descriptor 标志
    cen.writeUInt32LE(w.localOff, 42);          // 本地头偏移
    const nameBuf = Buffer.from(w.e.name, 'utf8');
    const cmt = src.slice(
      w.e.cOffset + 46 + w.e.nameLen + w.e.extraLen,
      w.e.cOffset + 46 + w.e.nameLen + w.e.extraLen + w.e.commentLen
    );
    cenChunks.push(cen, nameBuf, Buffer.from(w.extra), cmt);
    // 注意：中央目录 extra 也同步填充，保持与本地头一致
  }
  const cenBuf = Buffer.concat(cenChunks);

  const eocd = Buffer.alloc(22 + comment.length);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(written.length, 8);
  eocd.writeUInt16LE(written.length, 10);
  eocd.writeUInt32LE(cenBuf.length, 12);
  eocd.writeUInt32LE(cenOff, 16);
  eocd.writeUInt16LE(comment.length, 20);
  comment.copy(eocd, 22);

  const out = Buffer.concat([...chunks, cenBuf, eocd]);
  fs.writeFileSync(outPath, out);

  let ok = 0, bad = 0;
  for (const w of written) {
    if (!w.e.name.endsWith('.so') || w.method !== 0) continue;
    if (w.dataOff % PAGE === 0) ok++; else { bad++; console.log('  ✘ ' + w.e.name + ' @' + w.dataOff); }
  }
  console.log(`写入 ${outPath}: ${written.length} 条目, .so 对齐 ${ok} 个, 未对齐 ${bad} 个`);
  if (bad) process.exit(1);
}

main();


