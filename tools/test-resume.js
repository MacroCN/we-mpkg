'use strict';
/**
 * 断点续传自检（不联网）：用一个假的 client 模拟 CDN 分块下载，
 * 中途抛出中断模拟「意外退出」，再跑一次看是否只补了缺的分块。
 *
 * 用法: node tools\test-resume.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { downloadFileResumable } = require('../src/steamjs');
const cdn = require('../src/cdn');

const CHUNK = 1024 * 16;
const CHUNKS = 6;
const totalSize = CHUNK * CHUNKS;
const payload = Buffer.alloc(totalSize);
for (let i = 0; i < totalSize; i++) payload[i] = Math.floor(Math.random() * 256);

// 按 chunk 切出来的数据
const parts = [];
for (let i = 0; i < CHUNKS; i++) {
  parts.push({ offset: i * CHUNK, sha: crypto.createHash('sha1').update(String(i)).digest('hex'), data: payload.slice(i * CHUNK, (i + 1) * CHUNK) });
}
const manifest = { size: totalSize, sha: crypto.createHash('sha1').update(payload).digest('hex'), chunks: parts };

function makeClient(limit) {
  const fetched = [];
  return {
    fetched,
    getContentServers: async () => ({ servers: [{ Host: 'fake' }] }),
    downloadChunk: (appId, depotId, sha, server, cb) => {
      if (fetched.length >= limit) {
        // 模拟断网/进程被杀：一直报错，让下载中断
        return cb(new Error('boom'));
      }
      fetched.push(sha);
      const p = parts.find((x) => x.sha === sha);
      setImmediate(() => cb(null, p.data));
    },
  };
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wempkg-resume-'));
  const target = path.join(dir, 'scene.pkg');
  const logs = [];
  try {
    // 第一轮：只允许取 3 个分块 → 必然中断
    const c1 = makeClient(3);
    try {
      await downloadFileResumable(c1, manifest, target, { onLog: (m) => logs.push(m) });
      console.log('✘ 第一轮应该失败但成功了');
    } catch (e) {
      console.log('✔ 第一轮按预期中断:', e.message);
    }
    const st1 = JSON.parse(fs.readFileSync(target + '.part.json', 'utf8'));
    console.log('  断点记录里的分块数:', st1.done.length, '/', CHUNKS);
    if (st1.done.length !== 3) throw new Error('断点记录数量不对（可能是并发 worker 已取走但没写盘）');

    // 第二轮：只允许取剩下的 3 个分块，如果续传生效就正好够
    const c2 = makeClient(3);
    const r = await downloadFileResumable(c2, manifest, target, { onLog: (m) => logs.push(m) });
    console.log('✔ 第二轮完成，重新拉取的分块数:', c2.fetched.length, '（应为', CHUNKS - st1.done.length, '）');
    if (c2.fetched.length !== CHUNKS - st1.done.length) throw new Error('续传没有跳过已完成分块');

    // 校验结果字节是否一致
    const got = fs.readFileSync(target);
    if (!got.equals(payload)) throw new Error('续传后文件内容不对');
    console.log('✔ 文件内容与原始数据完全一致，大小', got.length);
    if (fs.existsSync(target + '.part.json')) throw new Error('.part.json 没清理');
    console.log('✔ 断点记录已清理');

    // CDN 发现失败发生在文件打开之后，文件描述符仍必须关闭。
    const failedTarget = path.join(dir, 'discovery-failure.pkg');
    const originalOpenSync = fs.openSync;
    const originalCloseSync = fs.closeSync;
    const originalGetOrderedServers = cdn.getOrderedServers;
    let openedFd = null;
    let closedFd = false;
    fs.openSync = function () {
      const fd = originalOpenSync.apply(this, arguments);
      if (arguments[0] === failedTarget) openedFd = fd;
      return fd;
    };
    fs.closeSync = function (fd) {
      if (fd === openedFd) closedFd = true;
      return originalCloseSync.call(this, fd);
    };
    cdn.getOrderedServers = async () => { throw new Error('discovery failed'); };
    try {
      await downloadFileResumable(makeClient(0), manifest, failedTarget);
      throw new Error('CDN discovery failure should reject');
    } catch (e) {
      if (!/discovery failed/.test(e.message)) throw e;
    } finally {
      fs.openSync = originalOpenSync;
      fs.closeSync = originalCloseSync;
      cdn.getOrderedServers = originalGetOrderedServers;
    }
    if (openedFd === null || !closedFd) throw new Error('CDN discovery failure leaked the file descriptor');
    console.log('✔ CDN 发现失败时下载文件句柄已关闭');
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { }
  }
  console.log('\n断点续传自检通过');
})().catch((e) => {
  console.error('✘ 失败:', e.message);
  process.exit(1);
});
