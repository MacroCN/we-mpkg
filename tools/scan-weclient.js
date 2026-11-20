'use strict';
/**
 * 从 Wallpaper Engine 安卓版 APK 里扒线索：支持哪些容器魔数、认不认 web 类型。
 * 用法: node tools\scan-weclient.js <.cache\weapk\weclient.apk>
 */
const fs = require('fs');
const zlib = require('zlib');

const file = process.argv[2];
const buf = fs.readFileSync(file);

// 简易 zip 遍历：找本地头 PK\x03\x04
const entries = [];
let off = 0;
while (off + 4 <= buf.length) {
  const p = buf.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), off);
  if (p < 0) break;
  const method = buf.readUInt16LE(p + 8);
  const compSize = buf.readUInt32LE(p + 18);
  const nameLen = buf.readUInt16LE(p + 26);
  const extraLen = buf.readUInt16LE(p + 28);
  const name = buf.subarray(p + 30, p + 30 + nameLen).toString('utf8');
  const dataStart = p + 30 + nameLen + extraLen;
  let data = null;
  if (!(buf.readUInt32LE(p + 14) === 0 && buf.readUInt32LE(p + 18) === 0)) {
    const raw = buf.subarray(dataStart, dataStart + compSize);
    if (method === 0) data = raw;
    else if (method === 8) {
      try { data = zlib.inflateRawSync(raw); } catch { data = null; }
    }
  }
  entries.push({ name, method, size: compSize, data });
  off = dataStart + compSize;
}

const dexes = entries.filter((e) => /classes[0-9]*\.dex$/.test(e.name) && e.data);
const assets = entries.filter((e) => /\.(js|html|htm|json)$/i.test(e.name) || /lib\/arm64/.test(e.name));
console.log(`zip 条目 ${entries.length}，dex ${dexes.length}，候选资源 ${assets.length}`);

const needles = [
  'PKGM0016', 'PKGM0019', 'PKGM0020', 'PKGV0024', 'TEXB0004', 'TEXS000',
  'mpkg', 'scene.json', 'project.json', 'index.html', 'texturereduction',
  'web', 'WebWallpaper', 'html',
];

const hits = {};
for (const d of dexes) {
  for (const n of needles) {
    let idx = 0;
    let count = 0;
    while ((idx = d.data.indexOf(Buffer.from(n, 'latin1'), idx)) >= 0) { count++; idx += n.length; }
    if (count) hits[n] = (hits[n] || 0) + count;
  }
}
console.log('dex 命中:', JSON.stringify(hits, null, 1));

// 资源里带 mpkg / 类型清单的 json
for (const a of assets) {
  const name = a.name;
  const s = a.data.toString('latin1');
  if (/\.json$/i.test(name) && s.length < 200000) {
    console.log(`\n--- ${name} (${a.size}B) ---`);
    console.log(s.slice(0, 1200));
  }
}
