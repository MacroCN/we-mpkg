'use strict';
/**
 * 自检：把 mpkg 里的直通 PNG 纹理解出来，和 .NET System.Drawing 的解码结果逐字节对比。
 * 用法: node tools\test-png-decode.js <file.mpkg> [条目序号]
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pkgformat = require('../src/pkgformat');
const tex = require('../src/tex');

const file = process.argv[2];
const pkg = pkgformat.parsePkg(file);
const entry = pkg.entries.find((e) => /\.tex$/i.test(e.path));
const info = tex.parseTex(entry.data);
const mip = info.images[0].mips[0];
const png = mip.bytes;
const outPng = path.join(__dirname, '_sample.png');
fs.writeFileSync(outPng, png);

const decoded = tex.decodePng(png);
if (!decoded) {
  console.log('PNG 解码失败（可能是隔行图）');
  process.exit(1);
}
const w = decoded.width;
const h = decoded.height;
const data = decoded.data;

// 采样几个点 + 整体字节的校验和，供外部对比
const samples = [];
for (const [x, y] of [[0, 0], [w >> 1, h >> 1], [w - 1, h - 1], [w >> 2, h >> 2], [10, 200]]) {
  const i = (y * w + x) * 4;
  samples.push({ x, y, rgba: [data[i], data[i + 1], data[i + 2], data[i + 3]] });
}
const sha = crypto.createHash('sha256').update(data).digest('hex');

console.log(JSON.stringify({
  texEntry: entry.path,
  size: `${w}x${h}`,
  rgbaSha256: sha,
  samples,
  pngPath: outPng,
}, null, 2));
