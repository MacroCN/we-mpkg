#!/usr/bin/env node
'use strict';
/**
 * node_modules 瘦身：删掉运行时用不到的东西，保留能 require 的最小集合。
 *
 * 删什么：
 *   - 文档 / 测试 / 示例 / 覆盖率 / CI 配置（*.md、test/、docs/、.github/ …）
 *   - TypeScript 声明、source map、.tsbuildinfo（Node 不读）
 *   - protobufjs 的 cli/（里面还挂着一整套 lodash，2000+ 个文件，运行时用不到）
 *   - lodash 的 fp/ amd/ cjs/ modules/ jsdoc/ 多份副本，只留 lodash.js
 *
 * 不删什么：dist/ lib/ src/ protobufs/ 这些可能被 package.json 的 main 指向的目录。
 *
 * 用法：node tools/prune-node-modules.js [node_modules 目录]
 *   默认目标是 android/app/src/main/assets/nodejs-project/node_modules
 */
const fs = require('fs');
const path = require('path');

const DROP_DIRS = new Set([
  'test', 'tests', '__tests__', 'spec', 'specs', 'benchmark', 'benchmarks',
  'docs', 'doc', 'jsdoc', 'examples', 'example', 'coverage', '.github',
  '.vscode', '.idea', 'man',
]);

const DROP_FILE = [
  /\.md$/i,
  /\.markdown$/i,
  /\.map$/i,
  /\.d\.ts$/i,
  /\.tsbuildinfo$/i,
  /^(changelog|history|authors|contributing|notice)(\.|$)/i,
  /^\.(eslintrc|prettierrc|editorconfig|travis|appveyor|npmignore|gitignore|gitattributes)/i,
];

// lodash 只留运行时唯一入口
const LODASH_KEEP = new Set(['lodash.js', 'package.json', 'LICENSE']);

function isLodashDir(p) {
  return path.basename(p) === 'lodash';
}

function isProtobufCli(p) {
  return path.basename(p) === 'cli' && path.basename(path.dirname(p)) === 'protobufjs';
}

function walk(dir, ctx) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (DROP_DIRS.has(ent.name) || isProtobufCli(abs)) {
        ctx.drop(abs, 'dir'); continue;
      }
      if (isLodashDir(abs)) {
        // lodash 特例：只留 lodash.js / package.json / LICENSE
        let subs = [];
        try { subs = fs.readdirSync(abs, { withFileTypes: true }); } catch { /* ignore */ }
        for (const s of subs) {
          if (LODASH_KEEP.has(s.name)) continue;
          ctx.drop(path.join(abs, s.name), s.isDirectory() ? 'dir' : 'file');
        }
        continue;
      }
      walk(abs, ctx);
      continue;
    }
    if (ent.name === '.bin') continue;
    if (DROP_FILE.some((re) => re.test(ent.name))) {
      ctx.drop(abs, 'file');
      continue;
    }
    try { ctx.count++; ctx.bytes += fs.statSync(abs).size; } catch { /* ignore */ }
  }
}

function main() {
  const arg = process.argv.slice(2).find((a) => !a.startsWith('-'));
  const root = path.resolve(arg || path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'assets', 'nodejs-project', 'node_modules'));
  if (!fs.existsSync(root)) {
    console.error(`找不到 node_modules: ${root}`);
    process.exit(1);
  }

  // 先统计
  let files = 0;
  let bytes = 0;
  const stat = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) stat(abs);
      else { try { files++; bytes += fs.statSync(abs).size; } catch { /* ignore */ } }
    }
  };
  stat(root);

  const ctx = { count: 0, bytes: 0, dropped: 0, dropBytes: 0, drop: (abs, kind) => {
    let size = 0;
    try {
      if (kind === 'dir') {
        const sub = (d) => {
          let e = [];
          try { e = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
          for (const x of e) {
            const p = path.join(d, x.name);
            if (x.isDirectory()) sub(p);
            else { try { size += fs.statSync(p).size; } catch { /* ignore */ } }
          }
        };
        sub(abs);
      } else {
        size = fs.statSync(abs).size;
      }
    } catch { /* ignore */ }
    try {
      fs.rmSync(abs, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      ctx.dropped++; ctx.dropBytes += size;
    } catch (e) {
      console.warn(`  跳过（被占用?）: ${abs}: ${e.message}`);
    }
  } };

  walk(root, ctx);

  // 再统计一次，避免把目录数和文件数混在一起
  let leftFiles = 0;
  let leftBytes = 0;
  const statLeft = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) statLeft(abs);
      else { try { leftFiles++; leftBytes += fs.statSync(abs).size; } catch { /* ignore */ } }
    }
  };
  statLeft(root);

  const mb = (n) => (n / 1048576).toFixed(2);
  console.log(`node_modules 瘦身: ${root}`);
  console.log(`  删除 ${ctx.dropped} 项，释放 ${mb(bytes - leftBytes)} MB`);
  console.log(`  文件 ${files} → ${leftFiles}，体积 ${mb(bytes)} MB → ${mb(leftBytes)} MB`);
}

main();
