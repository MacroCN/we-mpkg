'use strict';
// 对一个工程目录里的所有 .frag/.vert 跑 tools/glslc.js，汇总结果
// 用法: node tools/check-shaders.js <projectDir> [--es1]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const dir = process.argv[2];
const extra = process.argv.includes('--es1') ? ['--es1'] : [];
if (!dir) {
  console.error('用法: node tools/check-shaders.js <projectDir> [--es1]');
  process.exit(2);
}
const glslc = path.join(__dirname, 'glslc.js');
const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (/\.(frag|vert)$/i.test(e.name)) files.push(p);
  }
};
walk(dir);

let bad = 0;
for (const f of files) {
  let out = '';
  let ok = true;
  try {
    out = execFileSync(process.execPath, [glslc, ...extra, f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    ok = false;
    out = (err.stdout || '') + (err.stderr || '');
  }
  const lines = out.split('\n').filter((l) => l.startsWith('✔') || l.startsWith('✘') || l.includes('ERROR: 0:'));
  const rel = path.relative(dir, f).replace(/\\/g, '/');
  const verdict = lines.find((l) => l.startsWith('✔') || l.startsWith('✘')) || (ok ? '✔ ?' : '✘ ?');
  if (verdict.startsWith('✘')) bad++;
  console.log(`${verdict}  ${rel}`);
  for (const l of lines.filter((x) => x.includes('ERROR: 0:'))) console.log(`    ${l.trim()}`);
}
console.log(`\n合计 ${files.length} 个着色器，失败 ${bad} 个`);
process.exit(bad ? 1 : 0);
