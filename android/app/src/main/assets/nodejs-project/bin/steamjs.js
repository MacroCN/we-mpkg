'use strict';

/**
 * 纯 JS 下载层：二维码登录 / 状态检查 / 直接下载工坊条目 / 下载并打包 mpkg
 *
 *   node bin/steamjs.js login            生成二维码，用手机 Steam App 扫
 *   node bin/steamjs.js whoami           检查当前 token 是否有效
 *   node bin/steamjs.js get <id>         下载到 downloads/<id>
 *   node bin/steamjs.js mpkg <id>        下载 + 打包成 output/<标题>_<id>.mpkg
 *   node bin/steamjs.js logout           删除本地 token
 */

const fs = require('fs');
const path = require('path');
const { config } = require('../src/config');
const steamjs = require('../src/steamjs');
const guard = require('../src/guard');

const ROOT = config.ROOT;
const SAMPLE_ID = 3841811070;

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

async function ensureToken() {
  const t = steamjs.readToken();
  if (t && t.refreshToken) return t;
  throw new Error('还没有登录，先执行: node bin/steamjs.js login');
}

async function cmdLogin() {
  log('正在请求二维码 ...');
  const friends = [
    '扫下面这张二维码（手机 Steam App → 扫码登录）',
    '确认后 token 会保存在 .cache/steam-token.json，之后不用再扫'
  ].join('\n  ');
  log(`  ${friends}`);

  const { refreshToken, accountName } = await steamjs.qrLogin({
    timeoutMs: 300000,
    async onQrChallenge(url) {
      const QRCode = require('qrcode');
      const outDir = path.join(ROOT, 'logs');
      fs.mkdirSync(outDir, { recursive: true });
      const png = path.join(outDir, 'qr-login.png');
      await QRCode.toFile(png, url, { width: 512, margin: 2 });
      log(`\n二维码图片: ${png}`);
      log(`二维码地址: ${url}\n`);
    }
  });

  steamjs.saveToken({ refreshToken, accountName });
  log(`✔ 登录成功${accountName ? `: ${accountName}` : ''}，token 已保存`);
}

async function cmdWhoami() {
  const { refreshToken } = await ensureToken();
  const client = await steamjs.connect(refreshToken, { onLog: log });
  const sid = client.steamID.getSteam3RenderedID();
  log(`✔ 会话有效，登录身份: ${sid}`);
  const details = await steamjs.getPublishedFileDetails(client, [SAMPLE_ID]);
  if (details.length) log(`  API 可用，示例条目: ${details[0].title} (${details[0].file_size} B)`);
  client.logOff();
}

async function cmdGet(id) {
  if (!id) throw new Error('用法: node bin/steamjs.js get <创意工坊id>');
  // 这个值会拼成 downloads/<id>，必须纯数字（防 "../evil" 写到 downloads 之外）
  id = guard.assertItemId(id);
  const { refreshToken } = await ensureToken();
  const outDir = path.join(ROOT, 'downloads', String(id));
  const res = await steamjs.downloadItem({ id, outDir, refreshToken, onLog: log, onProgress: (f, done, total) => {
    if (done === total) log(`  ✔ ${f} ${(done / 1048576).toFixed(2)} MB`);
  } });
  log(`✔ 下载目录: ${res.dir}`);
  return res;
}

async function cmdMpkg(id) {
  if (!id) throw new Error('用法: node bin/steamjs.js mpkg <创意工坊id>');
  id = guard.assertItemId(id);
  const res = await cmdGet(id);
  const pack = require('../src/pack');
  const out = await pack.packFromItemDir(res.dir, { id, title: res.title, onLog: log });
  log(`✔ 输出: ${out.file} (${(out.size / 1048576).toFixed(2)} MB, ${out.fileCount} 个文件)`);
}

function cmdLogout() {
  steamjs.clearToken();
  log('✔ 已删除本地 token');
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  switch (cmd) {
    case 'login': return cmdLogin();
    case 'whoami': return cmdWhoami();
    case 'get': return cmdGet(arg);
    case 'mpkg': return cmdMpkg(arg);
    case 'logout': return cmdLogout();
    default:
      log('用法:\n  node bin/steamjs.js login | whoami | get <id> | mpkg <id> | logout');
      return null;
  }
}

main().catch((err) => {
  log(`✖ ${err.message}`);
  process.exitCode = 1;
});
