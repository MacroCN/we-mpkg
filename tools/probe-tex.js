'use strict';
/**
 * 诊断用：列出容器（.pkg/.mpkg）里每条 .tex 的头部信息，判断它属于
 * passthrough(PNG/JPEG blob) / DXT 块 / 原始像素 / 视频纹理，以及整包的类型。
 *
 * 用法: node tools\probe-tex.js <file.pkg|file.mpkg|目录>
 */
const fs = require('fs');
const path = require('path');
const pkgformat = require('../src/pkgformat');

const FREE_IMAGE = { 0: 'UNKNOWN(raw)', 1: 'PNG', 2: 'JPEG', 3: 'MP4(?)', 12: 'UNKNOWN_12' };
const TEX_FORMAT = { 0: 'RGBA8888', 4: 'DXT5', 5: 'ETC2_RGBA8', 6: 'DXT3', 7: 'DXT1', 8: 'RG88', 9: 'R8' };

function readNString(buf, off) {
  const end = buf.indexOf(0, off);
  if (end < 0) throw new Error('NString 没有终止符');
  return { value: buf.subarray(off, end).toString('utf8'), next: end + 1 };
}

function probeTex(buf) {
  const m1 = readNString(buf, 0);
  const m2 = readNString(buf, m1.next);
  let off = m2.next;
  const format = buf.readInt32LE(off);
  const flags = buf.readInt32LE(off + 4);
  const tw = buf.readInt32LE(off + 8);
  const th = buf.readInt32LE(off + 12);
  const iw = buf.readInt32LE(off + 16);
  const ih = buf.readInt32LE(off + 20);
  const unk = buf.readUInt32LE(off + 24);
  off += 28;
  const cm = readNString(buf, off);
  off = cm.next;
  const imageCount = buf.readInt32LE(off);
  off += 4;
  let imageFormat = null;
  let videoMp4 = 0;
  if (cm.value === 'TEXB0003') { imageFormat = buf.readInt32LE(off); off += 4; }
  else if (cm.value === 'TEXB0004') {
    imageFormat = buf.readInt32LE(off); videoMp4 = buf.readInt32LE(off + 4); off += 8;
  }
  const images = [];
  for (let i = 0; i < imageCount; i++) {
    const mipCount = buf.readInt32LE(off); off += 4;
    const mips = [];
    for (let j = 0; j < mipCount; j++) {
      if (cm.value === 'TEXB0001') {
        const w = buf.readInt32LE(off); const h = buf.readInt32LE(off + 4); off += 8;
        const n = buf.readInt32LE(off); off += 4;
        mips.push({ w, h, bytes: n, lz4: 0 });
        off += n;
      } else if (cm.value === 'TEXB0004' && imageFormat === 3) {
        off += 4 + 4; // param1, param2
        const cn = readNString(buf, off); off = cn.next + 4; // conditionJson + param3
        const w = buf.readInt32LE(off); const h = buf.readInt32LE(off + 4);
        const lz = buf.readInt32LE(off + 8); const dc = buf.readInt32LE(off + 12);
        off += 16; const n = buf.readInt32LE(off); off += 4;
        mips.push({ w, h, bytes: n, lz4: lz, decomp: dc });
        off += n;
      } else {
        const w = buf.readInt32LE(off); const h = buf.readInt32LE(off + 4);
        const lz = buf.readInt32LE(off + 8); const dc = buf.readInt32LE(off + 12);
        off += 16; const n = buf.readInt32LE(off); off += 4;
        mips.push({ w, h, bytes: n, lz4: lz, decomp: dc });
        off += n;
      }
    }
    images.push(mips);
  }
  return { m1: m1.value, m2: m2.value, format, flags, tw, th, iw, ih, unk, container: cm.value, imageCount, imageFormat, videoMp4, images };
}

function classify(p) {
  if (p.videoMp4 === 1 || p.imageFormat === 3) return 'video';
  if (p.imageFormat && p.imageFormat !== 0) return `passthrough(${FREE_IMAGE[p.imageFormat] || p.imageFormat})`;
  if ([4, 6, 7].includes(p.format)) return `dxt(${TEX_FORMAT[p.format]})`;
  return `raw(${TEX_FORMAT[p.format] || p.format})`;
}

function run(input) {
  const stat = fs.statSync(input);
  let entries;
  if (stat.isDirectory()) {
    entries = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const abs = path.join(d, e.name);
        if (e.isDirectory()) walk(abs);
        else entries.push({ path: path.relative(input, abs).split(path.sep).join('/'), data: fs.readFileSync(abs) });
      }
    };
    walk(input);
  } else {
    entries = pkgformat.parsePkg(input).entries;
  }

  const tally = {};
  let texCount = 0;
  const rows = [];
  for (const e of entries) {
    if (!/\.tex$/i.test(e.path)) continue;
    texCount++;
    try {
      const p = probeTex(e.data);
      const cls = classify(p);
      tally[cls] = (tally[cls] || 0) + 1;
      rows.push({
        path: e.path, size: e.data.length, cls,
        fmt: TEX_FORMAT[p.format] || p.format,
        container: p.container,
        imageFormat: p.imageFormat,
        size_tex: `${p.tw}x${p.th}`,
        size_img: `${p.iw}x${p.ih}`,
        images: p.imageCount,
        mips: p.images.map((im) => im.length).join(','),
        flags: p.flags,
      });
    } catch (err) {
      tally['解析失败'] = (tally['解析失败'] || 0) + 1;
      rows.push({ path: e.path, size: e.data.length, cls: `ERR ${err.message}` });
    }
  }

  console.log(`输入: ${input}`);
  console.log(`.tex 条目: ${texCount}`);
  console.log('分类统计:', JSON.stringify(tally));
  const other = entries.filter((e) => !/\.tex$/i.test(e.path)).map((e) => e.path);
  console.log('非 .tex 条目:', other.join(', '));
  console.log('');
  for (const r of rows) console.log(JSON.stringify(r));
}

run(process.argv[2] || '.');
