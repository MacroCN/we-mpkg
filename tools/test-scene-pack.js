'use strict';
/**
 * 自检：把现有 mpkg 解开成目录，走一遍新的打包流程，再把产物里的 .tex 拆出来检查。
 * 用法: node tools\test-scene-pack.js <输入.mpkg 或目录> [输出目录]
 */
const fs = require('fs');
const path = require('path');
const pkgformat = require('../src/pkgformat');
const pack = require('../src/pack');
const tex = require('../src/tex');

(async () => {
  const input = process.argv[2];
  const outDir = process.argv[3] || path.join(__dirname, '..', '.cache', '_test-scene');
  fs.mkdirSync(outDir, { recursive: true });

  let srcDir = input;
  if (fs.statSync(input).isFile()) {
    srcDir = path.join(outDir, 'extract');
    fs.rmSync(srcDir, { recursive: true, force: true });
    const res = pkgformat.extractPkg(input, srcDir);
    console.log(`解开输入: ${res.files.length} 个文件 (${res.magic})`);
  }

  const logs = [];
  const r = await pack.packFromItemDir(srcDir, {
    title: 'scene-test',
    id: 'selfcheck',
    outDir,
    onLog: (m) => { logs.push(m); console.log(m); },
  });

  console.log(`\n产物: ${r.outFile} (${(r.size / 1048576).toFixed(2)} MB, ${r.entryCount} 条目)`);
  if (r.warnings.length) console.log('警告:', r.warnings);

  // 复检产物里的 .tex
  const pkg = pkgformat.parsePkg(r.outFile);
  const texes = pkg.entries.filter((e) => /\.tex$/i.test(e.path));
  let ok = 0;
  let bad = 0;
  for (const e of texes) {
    const info = tex.parseTex(e.data);
    const kind = tex.classify(info);
    const mip = info.images[0] && info.images[0].mips[0];
    const expected = mip ? mip.width * mip.height * 4 : 0;
    const payloadOk = mip && mip.byteCount === expected && mip.lz4 === 0;
    const fmtOk = info.header.format === tex.TEX_FORMAT.RGBA8888;
    const containerOk = info.container.magic === 'TEXB0004' && info.container.imageFormat === -1;
    const pass = kind === 'raw' && payloadOk && fmtOk && containerOk;
    if (pass) ok++; else bad++;
    console.log(`${pass ? '✔' : '✘'} ${e.path}: kind=${kind} fmt=${info.header.format} ` +
      `container=${info.container.magic}/${info.container.imageFormat} ` +
      `${mip ? mip.width + 'x' + mip.height : '?'} 载荷=${mip ? mip.byteCount : 0} 期望=${expected}`);
  }
  console.log(`\n纹理检查: 通过 ${ok} / 失败 ${bad}`);
  process.exit(bad ? 1 : 0);
})();
