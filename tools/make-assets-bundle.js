#!/usr/bin/env node
'use strict';
/**
 * 把 android assets 里的 nodejs-project 打成单个 zip，并写一份 buildId 清单。
 *
 * 目的：手机上首次/升级解包时，从"3478 次 AssetManager.open()"变成"读一个 zip 顺序解压"，
 * 数量级的差别；同时 NodeRunner 靠清单里的 buildId 判断要不要解包，
 * 换了内容才重解，平时冷启动零成本。
 *
 * 用法：node tools/make-assets-bundle.js [assets 根目录]
 *   默认 android/app/src/main/assets
 * 产物：
 *   <assets>/nodejs-project.zip       —— 内容相对 nodejs-project/ 根
 *   <assets>/nodejs-build.json        —— { buildId, files, bytes, builtAt }
 * 打完包会删掉展开的 nodejs-project/ 目录，避免 APK 里同时有两份。
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** 递归收集文件（相对路径用 / 分隔） */
function collect(root) {
  const out = [];
  const walk = (dir, rel) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      const name = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(abs, name);
      else out.push({ abs, name });
    }
  };
  walk(root, '');
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function dosTime(d) {
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
  const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date };
}

/** 极简 zip 写入器：全部 DEFLATE，无 zip64（单个文件 < 4GB、总量 < 4GB 足够） */
function writeZip(target, files) {
  const parts = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const { time, date } = dosTime(now);
  const crypto = require('crypto');
  const hash = crypto.createHash('sha1');

  for (const f of files) {
    const data = fs.readFileSync(f.abs);
    const compressed = zlib.deflateRawSync(data, { level: 6 });
    // 压不下去就直接存，省得比原文件还大
    const useDeflate = compressed.length < data.length;
    const body = useDeflate ? compressed : data;
    const crc = crc32(data);
    hash.update(f.name).update('\0').update(String(data.length)).update('\0').update(String(crc)).update('\n');

    const nameBuf = Buffer.from(f.name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);                       // version needed
    local.writeUInt16LE(0x0800, 6);                   // utf8 names
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);       // method
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    parts.push(local, nameBuf, body);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(useDeflate ? 8 : 0, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);                          // extra
    cd.writeUInt16LE(0, 32);                          // comment
    cd.writeUInt16LE(0, 34);                          // disk
    cd.writeUInt16LE(0, 36);                          // internal attr
    cd.writeUInt32LE(0, 38);                          // external attr
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  fs.writeFileSync(target, Buffer.concat([...parts, cdBuf, eocd]));
  return hash.digest('hex');
}

function main() {
  const arg = process.argv.slice(2).find((a) => !a.startsWith('-'));
  const given = path.resolve(arg || path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'assets'));
  // 参数可以是 assets 根目录（含 nodejs-project/），也可以直接是 nodejs-project/ 本身
  const isProjectDir = fs.existsSync(path.join(given, 'package.json')) && fs.existsSync(path.join(given, 'bin'));
  const assets = isProjectDir ? path.dirname(given) : given;
  const srcDir = isProjectDir ? given : path.join(assets, 'nodejs-project');
  const zipPath = path.join(assets, 'nodejs-project.zip');
  const manifestPath = path.join(assets, 'nodejs-build.json');

  if (!fs.existsSync(srcDir)) {
    // 已经是 zip 形态（没有展开目录）就只补清单，方便 CI 重复跑
    if (!fs.existsSync(zipPath)) {
      console.error(`找不到 ${srcDir}，也没有 ${zipPath}`);
      process.exit(1);
    }
    console.log(`跳过打包（只有 zip）：${zipPath}`);
    return;
  }

  const files = collect(srcDir);
  const bytes = files.reduce((n, f) => n + fs.statSync(f.abs).size, 0);
  const buildId = writeZip(zipPath, files);
  const zipSize = fs.statSync(zipPath).size;
  fs.writeFileSync(manifestPath, JSON.stringify({
    buildId,
    files: files.length,
    bytes,
    zipBytes: zipSize,
    builtAt: new Date().toISOString(),
  }, null, 2) + '\n');

  const mb = (n) => (n / 1048576).toFixed(2);
  console.log(`资产打包: ${files.length} 个文件 / ${mb(bytes)} MB → ${path.basename(zipPath)} ${mb(zipSize)} MB`);
  console.log(`  buildId = ${buildId}`);

  fs.rmSync(srcDir, { recursive: true, force: true });
  console.log('  已删除展开目录（APK 里只留 zip）');
}

main();
