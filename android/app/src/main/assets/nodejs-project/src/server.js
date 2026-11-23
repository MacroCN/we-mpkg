'use strict';
/**
 * Web 界面后端：浏览 / 详情 / 下载任务队列 / 成品下载
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const configMod = require('./config');
const { config, ensureDirs } = configMod;
const workshop = require('./workshop');
const steamcmd = require('./steamcmd');
const packer = require('./pack');

const JOBS = new Map();
let jobSeq = 0;
const QUEUE = [];
let running = false;
/** 手机端登录会话状态（/api/login/*） */
let pendingLogin = null;
/** 账号密码登录时保留的 LoginSession（提交 Steam Guard 验证码要用） */
let pendingSession = null;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 2 * 1024 * 1024) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const safe = path.normalize(path.join(config.PUBLIC_DIR, decodeURIComponent(rel)));
  if (!safe.startsWith(path.resolve(config.PUBLIC_DIR))) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.stat(safe, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not Found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(safe).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(safe).pipe(res);
  });
}

/** 登录 / 换账号后重新取一次社区站登录态（旧 cookie 属于旧账号，必须作废） */
function refreshWebLogin() {
  try {
    require('./webcookie').clear();
    workshop.resetWebLogin();
    workshop.ensureWebLogin((m) => console.log(`  ${m}`));
  } catch { /* ignore */ }
}

function createJob({ id, title, reference, raw, preset, preserveAudio, videoMagic }) {
  const jobId = `j${++jobSeq}`;
  const job = {
    id: jobId,
    itemId: String(id),
    title: title || `wallpaper_${id}`,
    raw: !!raw,
    preset: typeof preset === 'string' && preset ? preset : 'high',
    preserveAudio: !!preserveAudio,
    videoMagic: typeof videoMagic === 'string' ? videoMagic : '0020',
    state: 'queued',
    log: [],
    result: null,
    error: null,
    createdAt: Date.now(),
    push: (line) => {
      job.log.push(line);
      if (job.log.length > 3000) job.log.splice(0, job.log.length - 3000);
    },
  };
  JOBS.set(jobId, job);
  QUEUE.push(job);
  setImmediate(pump);
  return job;
}

/** 当前平台能用的下载引擎：steamcmd（x86）→ steamjs（纯 JS，需登录凭据） */
function activeEngine() {
  const forced = String(process.env.WE_MPKG_ENGINE || '').toLowerCase();
  const hasToken = () => {
    try {
      const t = require('./steamjs').readToken();
      return !!(t && t.refreshToken);
    } catch { return false; }
  };
  // 强制指定时按指定的来；steamcmd 跑不了的平台自动退回纯 JS 引擎
  if (forced === 'steamcmd') return steamcmd.platformSupported() ? 'steamcmd' : 'steamjs';
  if (forced === 'steamjs') return 'steamjs';
  // 有登录凭据就优先用纯 JS 引擎：它不依赖 SteamCMD，也不需要 SteamCMD 自己的登录态，
  // Windows / Linux / 安卓 表现一致（实测产物逐字节相同）
  if (hasToken()) return 'steamjs';
  if (steamcmd.platformSupported()) return 'steamcmd';
  // 跑不了 SteamCMD 的平台（安卓等）也报 steamjs：引擎本身可用，只是还没登录，
  // 让界面提示「先登录」而不是「平台不支持」
  return 'steamjs';
}

async function downloadWithEngine(itemId, onLog) {
  const engine = activeEngine();
  if (!engine) {
    throw new Error('还没有登录 Steam：请点右上角 ⚙ 填账号密码登录，或导入 Steam 凭据（get-token.bat 得到的那段 Base64）');
  }
  onLog(`[engine] ${engine}`);
  if (engine === 'steamjs') {
    const steamjs = require('./steamjs');
    const token = steamjs.readToken();
    if (!token || !token.refreshToken) {
      throw new Error('还没有登录 Steam：请点右上角 ⚙ 填账号密码登录，或导入 Steam 凭据（get-token.bat 得到的那段 Base64）');
    }
    const outDir = path.join(config.DOWNLOAD_DIR, `js-${itemId}`);
    const r = await steamjs.downloadItem({ id: itemId, outDir, refreshToken: token.refreshToken, onLog });
    return { ok: true, dir: r.dir };
  }
  return steamcmd.downloadWorkshopItem({ id: itemId, onLog });
}

/**
 * 删除下载缓存目录，但只在 config.DOWNLOAD_DIR 之内动手：
 * 传进来的目录若是其它地方（比如 Steam 自己的 steamapps），一律不碰。
 */
function purgeDownloadDir(dir, onLog) {
  if (!dir) return null;
  if (config.KEEP_DOWNLOAD) {
    if (onLog) onLog(`下载缓存保留（WE_MPKG_KEEP_DOWNLOAD=1）: ${dir}`);
    return null;
  }
  try {
    const base = path.resolve(config.DOWNLOAD_DIR);
    const abs = path.resolve(dir);
    const rel = path.relative(base, abs);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
    fs.rmSync(abs, { recursive: true, force: true });
    if (onLog) onLog(`✔ 已清理下载缓存: ${abs}`);
    return abs;
  } catch (e) {
    if (onLog) onLog(`⚠ 清理下载缓存失败: ${e.message}`);
    return null;
  }
}

async function pump() {
  if (running) return;
  const job = QUEUE.shift();
  if (!job) return;
  running = true;
  job.state = 'downloading';
  let dlDir = null;
  try {
    job.push(`开始处理条目 ${job.itemId}`);
    const dl = await downloadWithEngine(job.itemId, job.push);
    if (!dl.ok) {
      job.state = 'failed';
      job.error = dl.reason || '下载失败（匿名与账号尝试均未产出文件）';
      job.push(`✘ ${job.error}`);
      return;
    }
    dlDir = dl.dir || null;
    // 只下载原始文件（保留 scene.pkg / mp4 等原样，不打包成 mpkg）
    if (job.raw) {
      job.result = { rawDir: dl.dir, raw: true, files: [] };
      try {
        job.result.files = require('./pack').analyze(dl.dir).files || [];
      } catch { /* ignore */ }
      job.state = 'done';
      job.push(`✔ 已下载到: ${dl.dir}（未打包）`);
      return;
    }
    job.state = 'packing';
    let reference = null;
    if (job.reference) reference = job.reference;
    const refGuess = path.join(config.ROOT, 'refs', `${job.itemId}.mpkg`);
    if (!reference && fs.existsSync(refGuess)) {
      reference = refGuess;
      job.push(`发现参考 mpkg: ${refGuess}`);
    }
    const res = await packer.packFromItemDir(dl.dir, {
      id: job.itemId,
      title: job.title,
      reference,
      preset: job.preset,
      preserveAudio: job.preserveAudio,
      videoMagic: job.videoMagic,
      onLog: job.push,
    });
    job.result = res;
    job.state = 'done';
    job.push('全部完成');
    // 打包成功 → 原始下载缓存（解包出来的几百个文件）没用了，删掉防止空间无限增长
    purgeDownloadDir(dlDir, job.push);
    dlDir = null;   // 已经删过，finally 里不用再来一次
  } catch (e) {
    job.state = 'failed';
    job.error = e.message;
    job.push(`✘ ${e.message}`);
  } finally {
    // 只下载模式的结果就是那个目录本身，不能删；
    // 失败/中断的任务保留下来，下次重试可以按文件断点续传。
    if (job.raw && job.state === 'done') { /* 保留 */ }
    else if (job.state === 'done') purgeDownloadDir(dlDir, job.push);
    else if (dlDir) job.push(`下载缓存已保留，重试可断点续传: ${dlDir}`);
    running = false;
    setImmediate(pump);
  }
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const pn = u.pathname;
  try {
    if (pn === '/api/tags') return json(res, 200, { tags: workshop.POPULAR_TAGS });
    if (pn === '/api/filters') {
      try {
        const groups = await workshop.getFilters({ force: u.searchParams.get('force') === '1' });
        return json(res, 200, { groups });
      } catch (e) {
        return json(res, 502, { error: `筛选条件拉取失败：${e.message}` });
      }
    }
    if (pn === '/api/settings') {
      if (req.method === 'POST') {
        const body = JSON.parse((await readBody(req)) || '{}');
        try {
          const dir = configMod.setOutputDir(body.outputDir);
          return json(res, 200, { ok: true, outputDir: dir });
        } catch (e) {
          return json(res, 400, { ok: false, error: `目录不可写：${e.message}` });
        }
      }
      const steamjs = require('./steamjs');
      const token = steamjs.readToken();
      return json(res, 200, {
        outputDir: config.OUTPUT_DIR,
        defaultOutputDir: configMod.DEFAULT_OUTPUT_DIR,
        accountName: token ? token.accountName || null : null,
        hasToken: !!token,
        platform: `${process.platform}/${process.arch}`,
        engine: activeEngine() || 'none',
      });
    }
    // 手机端免扫码登录：把 Steam 扫码地址交给手机上的 Steam App 确认
    if (pn === '/api/login/start' && req.method === 'POST') {
      const steamjs = require('./steamjs');
      try {
        const { session, url } = await steamjs.createQrSession();
        pendingLogin = { state: 'pending', url, error: null, accountName: null };
        steamjs.awaitQrSession(session).then((r) => {
          pendingLogin = { state: 'done', url, error: null, accountName: r.accountName };
          refreshWebLogin();
        }).catch((e) => {
          pendingLogin = { state: 'failed', url, error: e.message, accountName: null };
        });
        return json(res, 200, { ok: true, url });
      } catch (e) {
        return json(res, 500, { ok: false, error: e.message });
      }
    }
    // 账号密码登录（手机上没有第二块屏幕可扫二维码时的备选）
    if (pn === '/api/login/credentials' && req.method === 'POST') {
      const steamjs = require('./steamjs');
      let body;
      try { body = JSON.parse((await readBody(req)) || '{}'); } catch { body = {}; }
      try {
        const { session, needsCode, codeType } = await steamjs.createPasswordSession({
          user: String(body.accountName || '').trim(),
          pass: String(body.password || ''),
        });
        pendingSession = session;
        pendingLogin = {
          state: needsCode ? 'needCode' : 'pending',
          error: null,
          accountName: body.accountName || null,
          codeType: codeType || null,
        };
        session.on('authenticated', () => {
          try {
            const r = steamjs.finishSession(session, body.accountName);
            pendingLogin = { state: 'done', error: null, accountName: r.accountName, codeType: null };
            refreshWebLogin();
          } catch (e) {
            pendingLogin = { state: 'failed', error: e.message, accountName: null, codeType: null };
          }
          pendingSession = null;
        });
        session.on('error', (e) => {
          pendingLogin = { state: 'failed', error: (e && e.message) || String(e), accountName: null, codeType: null };
          pendingSession = null;
        });
        session.on('timeout', () => {
          pendingLogin = { state: 'failed', error: '登录超时，请重试', accountName: null, codeType: null };
          pendingSession = null;
        });
        return json(res, 200, { ok: true, state: pendingLogin.state, codeType: codeType || null });
      } catch (e) {
        pendingLogin = { state: 'failed', error: e.message, accountName: null, codeType: null };
        return json(res, 200, { ok: false, error: e.message });
      }
    }
    if (pn === '/api/login/code' && req.method === 'POST') {
      let body;
      try { body = JSON.parse((await readBody(req)) || '{}'); } catch { body = {}; }
      if (!pendingSession) return json(res, 400, { ok: false, error: '没有进行中的登录' });
      try {
        await pendingSession.submitSteamGuardCode(String(body.code || '').trim());
        pendingLogin = { state: 'pending', error: null, accountName: pendingLogin && pendingLogin.accountName, codeType: null };
        return json(res, 200, { ok: true });
      } catch (e) {
        return json(res, 200, { ok: false, error: e.message });
      }
    }
    if (pn === '/api/login/status') {
      const steamjs = require('./steamjs');
      const token = steamjs.readToken();
      return json(res, 200, pendingLogin || { state: 'idle', url: null, accountName: token ? token.accountName : null });
    }
    if (pn === '/api/logout' && req.method === 'POST') {
      require('./steamjs').clearToken();
      require('./webcookie').clear();   // 登录态 cookie 也要一起作废
      workshop.resetWebLogin();
      pendingLogin = null;
      pendingSession = null;
      return json(res, 200, { ok: true });
    }
    // 退出程序：只接受本机（网页/安卓 WebView）发来的关闭请求，避免局域网别人关你的服务
    if (pn === '/api/shutdown' && req.method === 'POST') {
      const ra = (req.socket && req.socket.remoteAddress) || '';
      const isLoopback = /^(127\.|::1|::ffff:127\.)/.test(ra);
      if (!isLoopback) return json(res, 403, { ok: false, error: '只允许本机关闭服务' });
      json(res, 200, { ok: true });
      setTimeout(() => {
        try { server.close(); } catch { /* ignore */ }
        process.exit(0);
      }, 300);
      return;
    }
    if (pn === '/api/config') {
      const engine = activeEngine();
      const hasToken = (() => {
        try {
          const t = require('./steamjs').readToken();
          return !!(t && t.refreshToken);
        } catch { return false; }
      })();
      return json(res, 200, {
        appId: config.APP_ID,
        outputDir: config.OUTPUT_DIR,
        downloadDir: config.DOWNLOAD_DIR,
        hasApiKey: !!config.API_KEY,
        hasAccount: !!(config.ACCOUNT_USER && config.ACCOUNT_PASS),
        proxy: config.PROXY || '',
        platform: `${process.platform}/${process.arch}`,
        engine: engine || 'none',
        loggedIn: hasToken,
        // 社区站登录态：有它网页抓到的条目才是「你账号」的范围（跟客户端一致）
        webLogin: (() => {
          try { return require('./webcookie').cachedStatus(); } catch { return { loggedIn: false, fresh: false }; }
        })(),
        canDownload: !!engine,
        canDownloadReason: engine
          ? ''
          : '还没有登录 Steam：请点右上角 ⚙ 填账号密码登录，或导入 Steam 凭据（get-token.bat 得到的那段 Base64）。',
      });
    }
    if (pn === '/api/browse') {
      const tags = (u.searchParams.get('tags') || '').split(',').map((s) => s.trim()).filter(Boolean);
      // groups：[{ name, tags }]，官方语义的载体（组内或 / 组间与 / 空组不过滤）
      let groups = null;
      const rawGroups = u.searchParams.get('groups');
      if (rawGroups) {
        try {
          const parsed = JSON.parse(rawGroups);
          if (Array.isArray(parsed)) groups = parsed;
        } catch { groups = null; }
      }
      try {
        const out = await workshop.browse({
          search: u.searchParams.get('search') || '',
          sort: u.searchParams.get('sort') || 'trend',
          tags,
          groups,
          page: parseInt(u.searchParams.get('page') || '1', 10),
          perPage: Math.min(100, parseInt(u.searchParams.get('perPage') || '24', 10)),
          // pages：一次连续抓多少页（网页模式一页 30 条，客户端是无限滚动，服务端替它把后面的页抓回来）
          pages: Math.max(1, Math.min(workshop.MAX_DEEP_PAGES, parseInt(u.searchParams.get('pages') || '1', 10))),
          days: Math.max(0, parseInt(u.searchParams.get('days') || '0', 10)),
          // 诊断用：anon=1 强制按匿名范围抓（对比「匿名 vs 账号」差多少）
          anon: u.searchParams.get('anon') === '1',
        });
        return json(res, 200, out);
      } catch (e) {
        return json(res, 502, {
          error: `创意工坊检索失败：${e.message}`,
          hint: 'steamcommunity.com 在国内常被阻断。请设置代理（WE_MPKG_PROXY=http://127.0.0.1:7890）后重启，或配置 STEAM_API_KEY 走 api.steampowered.com。',
        });
      }
    }
    if (pn === '/api/item') {
      const id = u.searchParams.get('id');
      if (!id) return json(res, 400, { error: '缺少 id' });
      const item = await workshop.getItemDetail(id);
      return json(res, 200, item);
    }
    if (pn === '/api/jobs' && req.method === 'POST') {
      if (!activeEngine()) {
        return json(res, 400, {
          error: '还没有登录 Steam',
          hint: '点右上角 ⚙ 填账号密码登录，或把电脑上 get-token.bat 得到的那段凭据粘进去导入，即可下载；也可用「远程模式」连电脑。',
        });
      }
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}');
      if (!body.id) return json(res, 400, { error: '缺少 id' });
      const job = createJob({
        id: body.id,
        title: body.title,
        reference: body.reference,
        raw: body.raw,
        preset: body.preset,
        preserveAudio: body.preserveAudio,
        videoMagic: body.videoMagic,
      });
      return json(res, 200, { jobId: job.id });
    }
    if (pn.startsWith('/api/jobs/')) {
      const jobId = pn.split('/')[3];
      const job = JOBS.get(jobId);
      if (!job) return json(res, 404, { error: '任务不存在' });
      return json(res, 200, {
        id: job.id,
        itemId: job.itemId,
        title: job.title,
        state: job.state,
        error: job.error,
        log: job.log.slice(-400),
        result: job.result ? (job.result.raw ? {
          raw: true,
          rawDir: job.result.rawDir,
          files: job.result.files,
        } : {
          outFile: path.basename(job.result.outFile),
          outPath: job.result.outFile,
          size: job.result.size,
          type: job.result.type,
          magic: job.result.magic,
          preset: job.result.preset,
          tex: job.result.tex,
          shader: job.result.shader ? {
            total: job.result.shader.total,
            rewritten: job.result.shader.rewritten,
            literals: job.result.shader.literals,
            structural: job.result.shader.structural,
          } : null,
          audio: job.result.audio,
          warnings: job.result.warnings,
          entryCount: job.result.entryCount,
        }) : null,
      });
    }
    if (pn.startsWith('/api/file/')) {
      const jobId = pn.split('/')[3];
      const job = JOBS.get(jobId);
      if (!job || !job.result || !job.result.outFile) { res.writeHead(404); return res.end('Not Found'); }
      const file = job.result.outFile;
      const st = fs.statSync(file);
      const name = encodeURIComponent(path.basename(file));
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(st.size),
        'Content-Disposition': `attachment; filename="${name}"; filename*=UTF-8''${name}`,
      });
      return fs.createReadStream(file).pipe(res);
    }
    if (pn === '/api/outputs') {
      ensureDirs();
      const files = fs.readdirSync(config.OUTPUT_DIR)
        .filter((f) => f.toLowerCase().endsWith('.mpkg'))
        .map((f) => ({ name: f, size: fs.statSync(path.join(config.OUTPUT_DIR, f)).size, mtime: fs.statSync(path.join(config.OUTPUT_DIR, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      return json(res, 200, { files });
    }
    if (pn.startsWith('/api/download-local/')) {
      const name = decodeURIComponent(pn.slice('/api/download-local/'.length));
      const file = path.join(config.OUTPUT_DIR, path.basename(name));
      if (!fs.existsSync(file)) { res.writeHead(404); return res.end('Not Found'); }
      const st = fs.statSync(file);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(st.size),
        'Content-Disposition': `attachment; filename="${encodeURIComponent(path.basename(file))}"`,
      });
      return fs.createReadStream(file).pipe(res);
    }
    return serveStatic(req, res, pn);
  } catch (e) {
    return json(res, 500, { error: e.message });
  }
});

/**
 * 启动时清掉 24 小时以前的下载缓存目录。
 * 失败任务会保留缓存以便断点续传，但一直留着会占空间，过一天就自动回收。
 */
function pruneStaleDownloads(maxAgeMs = 24 * 3600 * 1000) {
  if (config.KEEP_DOWNLOAD) return;
  const base = config.DOWNLOAD_DIR;
  let entries = [];
  try { entries = fs.readdirSync(base); } catch { return; }
  const now = Date.now();
  for (const name of entries) {
    if (!/^js-/.test(name)) continue;
    const p = path.join(base, name);
    try {
      const st = fs.statSync(p);
      if (now - st.mtimeMs > maxAgeMs) {
        fs.rmSync(p, { recursive: true, force: true });
        console.log(`  已回收过期下载缓存: ${p}`);
      }
    } catch { /* ignore */ }
  }
}

function start(port = config.PORT) {
  ensureDirs();
  pruneStaleDownloads();
  // 下载任务进行中不新建 CM 连接去换社区站 cookie（避免两条会话互相干扰）
  workshop.setLoginBusyCheck(() => QUEUE.length > 0 || Array.from(JOBS.values()).some((j) => j.state === 'running'));
  // 启动时预热一次社区站登录态：有凭据就能让创意工坊抓取走「账号范围」，和客户端一致
  (async () => {
    try {
      const webcookie = require('./webcookie');
      const c = await webcookie.getLoginCookie({ onLog: (m) => console.log(`  ${m}`) });
      if (c && c.cookie) {
        require('./net').setLoginCookie(c.cookie);
        console.log(`  社区站登录态就绪：${c.accountName || c.steamId}（创意工坊按账号内容返回）`);
      } else {
        console.log('  社区站登录态：未启用（按匿名范围抓取，条目会比客户端少）');
      }
    } catch { /* 保持匿名态 */ }
  })();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => {
      console.log(`\n  we-mpkg 已启动: http://localhost:${port}`);
      console.log(`  输出目录: ${config.OUTPUT_DIR}`);
      if (!config.PROXY) console.log('  （可用 WE_MPKG_PROXY / HTTPS_PROXY 指定代理）\n');
      resolve(server);
    });
  });
}

module.exports = { start, server };

if (require.main === module) {
  start().catch((e) => { console.error('启动失败:', e.message); process.exit(1); });
}

