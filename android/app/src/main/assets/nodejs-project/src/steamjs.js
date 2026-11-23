'use strict';

/**
 * 纯 JS 的 Steam 下载层：不依赖 SteamCMD，任何能跑 Node 的平台都能用（Windows / Linux / Android）。
 *
 * 流程（全部基于官方 Steam 客户端协议，无 x86 依赖）：
 *   1) steam-session 二维码登录 → refresh token（存 .cache/steam-token.json）
 *   2) steam-user 用 refresh token 连 Steam
 *   3) IPublishedFileService 拿条目详情 → hcontent_file 即内容 manifest id
 *   4) getManifest 取 depot manifest → downloadFile 逐文件下载（内部按 chunk 拉取 + AES 解密 + sha1 校验）
 *
 * 前置条件：账号必须拥有 Wallpaper Engine（431960），否则 getDepotDecryptionKey 会被 Steam 拒绝。
 */

const fs = require('fs');
const path = require('path');
const { config, ensureDirs } = require('./config');
const cdn = require('./cdn');

const APP_ID = 431960;
const DEPOT_ID = 431960;
const TOKEN_FILE = path.join(config.CACHE_DIR, 'steam-token.json');

function readToken() {
  try {
    const j = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    return j && j.refreshToken ? j : null;
  } catch {
    return null;
  }
}

function saveToken(data) {
  ensureDirs();
  const prev = readToken() || {};
  // Steam 有些登录流程不回报账号名，别把已有的名字丢掉（否则界面会显示"未登录"）
  const merged = Object.assign({}, data);
  if (!merged.accountName && prev.accountName) merged.accountName = prev.accountName;
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(Object.assign({ savedAt: new Date().toISOString() }, merged), null, 2));
  try { fs.chmodSync(TOKEN_FILE, 0o600); } catch { /* Windows 上忽略 */ }
}

function clearToken() {
  try { fs.unlinkSync(TOKEN_FILE); } catch { /* ignore */ }
}

/** 代理选项：Node 不读系统代理，必须显式传 */
function proxyOptions() {
  return config.PROXY ? { httpProxy: config.PROXY } : {};
}

/** 把回调风格方法包成 Promise */
function invoke(obj, method, ...args) {
  return new Promise((resolve, reject) => {
    obj[method](...args, (err, ...res) => {
      if (err) return reject(err);
      return resolve(res.length <= 1 ? res[0] : res);
    });
  });
}

function once(emitter, event, { timeoutMs = 30000, label = event } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 超时（${timeoutMs} ms）`)), timeoutMs);
    emitter.once(event, (...a) => { clearTimeout(timer); resolve(a); });
    emitter.once('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

/** 在终端渲染二维码 */
function printQr(url) {
  console.log('\n用手机 Steam App 扫码登录（Steam App → 右下「Steam 令牌」→「扫一扫」）：\n');
  try {
    const qr = require('qrcode-terminal');
    qr.generate(url, { small: true }, (s) => console.log(s));
  } catch {
    console.log('（未安装 qrcode-terminal，直接复制下面的地址也可）');
  }
  console.log(`\n二维码内容: ${url}\n`);
}

/**
 * 创建扫码登录会话（不等待）。返回 { session, url }。
 * 手机端用它把 url 交给 Steam App 打开确认，就能在本机完成登录。
 */
async function createQrSession() {
  const { LoginSession, EAuthTokenPlatformType } = require('steam-session');
  const session = new LoginSession(EAuthTokenPlatformType.SteamClient, proxyOptions());
  const started = await session.startWithQR();
  if (!started || !started.qrChallengeUrl) throw new Error('Steam 没有返回二维码地址');
  return { session, url: started.qrChallengeUrl };
}

/** 等待会话被确认，成功后保存凭据 */
async function awaitQrSession(session, { timeoutMs = 180000 } = {}) {
  await once(session, 'authenticated', { timeoutMs, label: '扫码登录' });
  const refreshToken = session.refreshToken;
  if (!refreshToken) throw new Error('认证通过但没有拿到 refresh token，请重试');
  const accountName = session.accountName || null;
  saveToken({ refreshToken, accountName });
  return { refreshToken, accountName };
}

/**
 * 账号密码登录（网页/手机端用）。返回 { session, codeType, needsCode }，
 * 调用方按需 submitSteamGuardCode，然后 await once(session,'authenticated')。
 * 有 Steam App 的账号会收到「确认登录」推送，直接在手机上点确认即可。
 */
async function createPasswordSession({ user, pass } = {}) {
  if (!user || !pass) throw new Error('需要账号与密码');
  const { LoginSession, EAuthTokenPlatformType } = require('steam-session');
  const session = new LoginSession(EAuthTokenPlatformType.SteamClient, proxyOptions());
  let deviceConfirm = false;
  session.on('deviceConfirmation', () => { deviceConfirm = true; });
  await session.startWithCredentials({ accountName: user, password: pass });
  const codeType = session.steamGuardCodeType || null;
  return { session, codeType, deviceConfirm, needsCode: !!codeType };
}

/** 登录成功后的收尾：校验 token 并落盘 */
function finishSession(session, fallbackName) {
  const refreshToken = session.refreshToken;
  if (!refreshToken) throw new Error('认证通过但没有拿到 refresh token');
  const accountName = session.accountName || fallbackName || null;
  saveToken({ refreshToken, accountName });
  return { refreshToken, accountName };
}

/**
 * 二维码登录，成功后把 refresh token 落盘。
 */
async function qrLogin({ onLog = () => {}, onQr = printQr, timeoutMs = 180000 } = {}) {
  const { session, url } = await createQrSession();
  onQr(url);
  onLog('等待手机确认…');
  const res = await awaitQrSession(session, { timeoutMs });
  onLog(`✔ 已登录: ${res.accountName || '（未知账号）'}`);
  return res;
}

/**
 * 账号密码登录（可选路径）。getCode() 在需要 Steam Guard 验证码时被调用。
 */
async function passwordLogin({ user, pass, getCode, onLog = () => {}, onPrompt = () => {} } = {}) {
  if (!user || !pass) throw new Error('需要账号与密码');
  const { LoginSession, EAuthTokenPlatformType } = require('steam-session');
  const session = new LoginSession(EAuthTokenPlatformType.SteamClient, proxyOptions());

  session.on('steamGuard', () => { onPrompt('需要 Steam Guard 验证码'); });
  session.on('deviceConfirmation', () => { onPrompt('请在手机 Steam App 上点“确认登录”'); });

  await session.startWithCredentials({ accountName: user, password: pass });

  // 需要验证码时，startWithCredentials 已完成但 authenticated 还没触发
  if (session.steamGuardCodeType) {
    const code = await getCode(session.steamGuardCodeType);
    await session.submitSteamGuardCode(code);
  }

  await once(session, 'authenticated', { timeoutMs: 180000, label: '密码登录' });
  const refreshToken = session.refreshToken;
  if (!refreshToken) throw new Error('认证通过但没有拿到 refresh token');
  saveToken({ refreshToken, accountName: session.accountName || user });
  onLog(`✔ 已登录: ${session.accountName || user}`);
  return { refreshToken, accountName: session.accountName || user };
}

/** 用 refresh token 连上 Steam */
async function connect(refreshToken, { onLog = () => {} } = {}) {
  if (!refreshToken) throw new Error('还没有登录凭据，先执行: run.bat steamjs login');
  const SteamUser = require('steam-user');
  const client = new SteamUser(Object.assign({ autoRelogin: false, renewRefreshTokens: true }, proxyOptions()));
  const loggedOn = once(client, 'loggedOn', { timeoutMs: 30000, label: '连接 Steam' });
  client.logOn({ refreshToken });
  await loggedOn;
  try {
    if (typeof client.setPersona === 'function') client.setPersona(1); // 1 = EPersonaState.Online
  } catch { /* 无所谓 */ }
  onLog(`已连接: ${client.steamID ? client.steamID.getSteam3RenderedID() : 'unknown'}`);
  return client;
}

/** 拉取创意工坊条目详情（steam-user 返回的是按 id 索引的对象，不是数组） */
async function getPublishedFileDetails(client, ids) {
  const raw = await invoke(client, 'getPublishedFileDetails', ids.map(String));
  const bag = (raw && raw.files) || raw || {};
  const arr = Array.isArray(bag) ? bag : Object.keys(bag).map((k) => bag[k]);
  return arr.filter((d) => {
    if (!d || !d.publishedfileid) return false;
    // 有 result 字段时必须为 1（OK）
    if (d.result !== undefined && String(d.result) !== '1') return false;
    return true;
  });
}

/**
 * 断点续传：按 chunk 自己下载单个文件。
 *
 * steam-user 自带的 downloadFile 用 'w' 打开文件（会截断）且每次都把所有 chunk 重下一遍，
 * 意外退出后只能从头再来。这里改成：
 *   - 文件按 r+ 打开、ftruncate 到完整大小，chunk 按自己的 offset 直接写进去；
 *   - 每下完一个 chunk 把它的 sha 记到 <文件>.part.json，下次启动只补缺的 chunk；
 *   - 全部下完后按 manifest 的 sha1 校验整个文件，再删掉 .part.json。
 */
async function downloadFileResumable(client, fileManifest, target, opts = {}) {
  const onLog = opts.onLog || (() => {});
  const onProgress = opts.onProgress || (() => {});
  const size = parseInt(fileManifest.size, 10) || 0;
  const chunks = fileManifest.chunks || [];
  const partFile = target + '.part.json';

  let have = -1;
  try { have = fs.statSync(target).size; } catch { /* 没有 */ }
  const partExists = fs.existsSync(partFile);

  // 没有断点记录但大小已经对：可能是上一次完整下完的，也可能是老版本中断留下的
  // 「整份长度但内容是空洞」的文件 —— 用 sha1 确认一遍，确认过才跳过。
  if (have === size && !partExists) {
    if (!fileManifest.sha) return { resumed: false, skipped: true, bytes: 0 };
    const okHash = (await sha1File(target)) === String(fileManifest.sha).toLowerCase();
    if (okHash) {
      onLog(`跳过（已下载完成 ${have} B）`);
      return { resumed: false, skipped: true, bytes: 0 };
    }
    onLog('已有文件校验不通过，重新下载');
  }

  let doneShas = new Set();
  if (have > 0) {
    try {
      const st = JSON.parse(fs.readFileSync(partFile, 'utf8'));
      if (Number(st.size) === size && Array.isArray(st.done)) doneShas = new Set(st.done);
    } catch { /* 没有断点记录：旧数据不可信，重下 */ }
  }

  const fd = fs.openSync(target, have > 0 ? 'r+' : 'w+');
  try {
    fs.ftruncateSync(fd, size);
    // 没有可信断点记录就把已有内容当无效（避免把半截乱序数据当成已下载）
    if (have > 0 && doneShas.size === 0) {
      fs.ftruncateSync(fd, 0);
      fs.ftruncateSync(fd, size);
    }
    // 先落一个断点标记：以后就算进程被杀，也能看出「这个文件是下到一半的」
    try { fs.writeFileSync(partFile, JSON.stringify({ size, done: Array.from(doneShas) })); } catch { /* ignore */ }
  
    const pending = chunks.filter((c) => !doneShas.has(String(c.sha).toLowerCase()));
    const totalDone = chunks
      .filter((c) => doneShas.has(String(c.sha).toLowerCase()))
      .reduce((s, c) => s + (parseInt(c.size, 10) || 0), 0);
    let bytesDone = totalDone;
    if (totalDone > 0) onLog(`断点续传: 已有 ${(totalDone / 1048576).toFixed(1)} MB，还需 ${pending.length} 个分块`);
    onProgress({ bytesDownloaded: bytesDone, totalSizeBytes: size });
  
    if (!pending.length) {
      try { fs.rmSync(partFile, { force: true }); } catch { /* ignore */ }
      return { resumed: totalDone > 0, bytes: totalDone };
    }
  
    // 按测速排序拿节点（开机那次测速的结果 + 运行时失败降级都在 src/cdn.js 里）
    const allServers = opts.servers && opts.servers.length
      ? opts.servers
      : await cdn.getOrderedServers(client, { onLog });
    if (!allServers.length) throw new Error('拿不到 Steam 内容服务器列表');
    const picker = new cdn.ServerPicker(allServers);
    // 上一轮遗留的 keep-alive 连接可能已经被对端静默丢弃，先清掉，免得首个请求撞死
    cdn.releaseIdleSockets();
  
    let saveTimer = null;
    let savePending = false;
    const saveState = () => {
      if (savePending) return;
      savePending = true;
      saveTimer = setTimeout(() => {
        savePending = false;
        try {
          fs.writeFileSync(partFile, JSON.stringify({ size, done: Array.from(doneShas) }));
        } catch { /* ignore */ }
      }, 400);
    };
  
    let next = 0;
    let failure = null;
  
    const writeChunk = (c, data) => new Promise((resolve, reject) => {
      fs.write(fd, data, 0, data.length, parseInt(c.offset, 10), (err) => (err ? reject(err) : resolve()));
    });
  
    const oneChunk = async (c) => {
      let lastErr = null;
      for (let attempt = 0; attempt < 8; attempt++) {
        const server = picker.next();
        if (!server) break;
        const res = await new Promise((resolve) => {
          client.downloadChunk(APP_ID, DEPOT_ID, c.sha, server, (err, data) => resolve({ err, data }));
        });
        if (!res.err && res.data) {
          await writeChunk(c, res.data);
          doneShas.add(String(c.sha).toLowerCase());
          bytesDone += res.data.length;
          onProgress({ bytesDownloaded: bytesDone, totalSizeBytes: size });
          saveState();
          return;
        }
        lastErr = res.err;
        // 任何失败（含 Request timed out）都算这台节点这一轮不行：换排序里的下一台，
        // 而不是对着同一个节点重试到整份文件失败。
        onLog(`分块重试：${server.Host || '?'} 失败（${(res.err && res.err.message) || '无数据'}），换下一台节点`);
        picker.fail(server);
        if (!picker.alive().length) await new Promise((r) => setTimeout(r, 300));
      }
      throw new Error(`分块 ${c.sha} 下载失败: ${lastErr ? lastErr.message : '未知错误'}`);
    };
  
    const worker = async () => {
      while (!failure) {
        const idx = next++;
        if (idx >= pending.length) return;
        try {
          await oneChunk(pending[idx]);
        } catch (e) {
          failure = e;
          return;
        }
      }
    };
  
    const workers = [];
    const parallel = Math.min(4, pending.length);
    for (let i = 0; i < parallel; i++) workers.push(worker());
    await Promise.all(workers);
  
    if (saveTimer) clearTimeout(saveTimer);
    try { fs.writeFileSync(partFile, JSON.stringify({ size, done: Array.from(doneShas) })); } catch { /* ignore */ }
  
    if (failure) throw failure;
  
    // 整体校验（steam-user 也这么做，能发现截断/错位）
    if (fileManifest.sha) {
      const actual = await sha1File(target);
      if (actual !== String(fileManifest.sha).toLowerCase()) {
        try { fs.rmSync(target, { force: true }); } catch { /* ignore */ }
        try { fs.rmSync(partFile, { force: true }); } catch { /* ignore */ }
        throw new Error('下载校验失败（文件 hash 不匹配），已删除重下');
      }
    }
    try { fs.rmSync(partFile, { force: true }); } catch { /* ignore */ }
    return { resumed: totalDone > 0, bytes: bytesDone };
  } finally {
    fs.closeSync(fd);
  }
}

function sha1File(file) {
  return new Promise((resolve, reject) => {
    const h = require('crypto').createHash('sha1');
    const rs = fs.createReadStream(file);
    rs.on('data', (d) => h.update(d));
    rs.on('error', reject);
    rs.on('end', () => resolve(h.digest('hex')));
  });
}

/**
 * 从指定节点取 manifest（steam-user 的 getManifest 内部会随机挑节点，
 * 这里临时把 getContentServers 固定成单台，就能强制它走我们选好的线路）。
 */
async function getManifestFrom(client, manifestId, server) {
  const orig = client.getContentServers;
  client.getContentServers = async () => ({ servers: [server] });
  try {
    return await invoke(client, 'getManifest', APP_ID, DEPOT_ID, String(manifestId), 'public');
  } finally {
    client.getContentServers = orig;
  }
}

/**
 * 取 manifest 时按测速顺序逐台重试：steam-user 默认只有一次机会、10 秒硬超时，
 * 国内链路一次抖动就整条任务判死（就是「第一个下载完后面全报 Request timed out」的病根）。
 */
async function getManifestWithFailover(client, manifestId, orderedServers, { onLog = () => {} } = {}) {
  const picker = new cdn.ServerPicker(orderedServers);
  const attempts = Math.min(4, Math.max(2, orderedServers.length));
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    const server = picker.next();
    if (!server) break;
    const t0 = Date.now();
    try {
      const m = await getManifestFrom(client, manifestId, server);
      onLog(`manifest 已取回（${server.Host}，${Date.now() - t0}ms）`);
      return m;
    } catch (err) {
      lastErr = err;
      onLog(`manifest 节点 ${server.Host} 失败（${Date.now() - t0}ms）：${err.message}，按测速顺序换下一台`);
      picker.fail(server);
    }
  }
  throw lastErr || new Error('取 manifest 失败：没有可用节点');
}

/**
 * 下载一个创意工坊条目到目录。
 */
async function downloadItem({ id, outDir, refreshToken, client: extClient, onLog = () => {}, onProgress = () => {} }) {
  ensureDirs();
  // 同一个进程里多条任务共用一条 CM 连接（同一 refresh token 同时两条会被 Steam 判 403），
  // 分块请求本身是并发的，所以多任务共用一个 client 仍然能跑满带宽。
  const client = extClient || await connect(refreshToken, { onLog });
  const ownsClient = !extClient;
  try {
    const details = await getPublishedFileDetails(client, [id]);
    if (!details.length) throw new Error(`条目 ${id} 不存在、不可见，或详情接口返回异常`);
    const d = details[0];
    onLog(`条目: ${d.title} | 体积 ${d.file_size} B`);

    const manifestId = d.hcontent_file;
    if (!manifestId) throw new Error('条目没有内容 manifest（可能不是标准工坊物品）');
    onLog(`内容 manifest: ${manifestId}`);

    // 按测速排序拿节点；manifest / 分块都走同一份顺序
    const orderedServers = await cdn.getOrderedServers(client, { onLog });
    if (!orderedServers.length) throw new Error('拿不到 Steam 内容服务器列表');

    let manifest;
    try {
      manifest = await getManifestWithFailover(client, manifestId, orderedServers, { onLog });
    } catch (err) {
      throw new Error(`取内容 manifest 失败（账号是否拥有 Wallpaper Engine 431960？）: ${err.message}`);
    }
    if (!manifest || !manifest.files) throw new Error('manifest 结构异常（没有 files 字段）');

    const files = (manifest.files || []).filter((f) => !(parseInt(f.flags, 10) & 64)); // 64 = Directory
    onLog(`manifest 内文件数: ${files.length}`);

    const root = path.resolve(outDir);
    fs.mkdirSync(root, { recursive: true });
    const written = [];
    const skipped = [];
    // 整个条目的进度：manifest 里所有文件大小的总和，按已完成文件 + 当前文件字节累计
    const grandTotal = files.reduce((s, f) => s + (Number(f.size) || 0), 0);
    let doneBytes = 0;
    const progressTo = (rel) => (p) => {
      const cur = Number(p.bytesDownloaded) || 0;
      const total = Number(p.totalSizeBytes) || 0;
      onProgress({
        bytesDownloaded: Math.min(grandTotal, doneBytes + cur),
        totalSizeBytes: grandTotal || total,
        currentFile: rel,
        fileBytes: cur,
        fileTotal: total,
      });
    };
    for (const f of files) {
      const rel = String(f.filename || '').replace(/\\/g, '/');
      if (!rel) continue;
      const target = path.resolve(root, rel);
      if (target !== root && !target.startsWith(root + path.sep)) throw new Error(`manifest 含非法路径: ${rel}`);
      fs.mkdirSync(path.dirname(target), { recursive: true });

      // 断点续传判断一律交给 downloadFileResumable：
      // 只看文件大小是不够的（预分配会把文件撑到完整长度，内容其实是空洞），
      // 它会在没有断点记录时用 sha1 校验，有断点记录时按 chunk 补齐。
      onLog(`下载 ${rel} (${f.size} B)…`);
      let r;
      try {
        r = await downloadFileResumable(client, f, target, { onLog, onProgress: progressTo(rel), servers: orderedServers });
      } catch (e) {
        throw new Error(`下载 ${rel} 失败: ${e.message}`);
      }
      doneBytes += Number(f.size) || 0;
      onProgress({ bytesDownloaded: Math.min(grandTotal, doneBytes), totalSizeBytes: grandTotal, currentFile: rel });
      if (r && r.skipped) skipped.push({ rel, size: Number(f.size) || 0 });
      else written.push(rel);
    }

    if (skipped.length) {
      onLog(`✔ 断点续传：跳过 ${skipped.length} 个已完成文件（${(skipped.reduce((s, x) => s + x.size, 0) / 1048576).toFixed(1)} MB）`);
    }
    onLog(`下载完成: ${written.length} 个文件（跳过 ${skipped.length} 个） → ${root}`);
    return { dir: root, files: written, skipped, title: d.title, fileSize: Number(d.file_size) || 0 };
  } finally {
    // 别把 Valve CDN 的 keep-alive 连接留到下一次任务：对端静默丢掉的连接被复用就会挂 10 秒
    cdn.releaseIdleSockets();
    if (ownsClient) { try { client.logOff(); } catch { /* ignore */ } }
  }
}

module.exports = {
  APP_ID, DEPOT_ID, TOKEN_FILE,
  readToken, saveToken, clearToken,
  qrLogin, passwordLogin, connect,
  createQrSession, awaitQrSession,
  createPasswordSession, finishSession,
  getPublishedFileDetails, downloadItem, downloadFileResumable,
  printQr,
};
