'use strict';
/**
 * Web 界面后端：浏览 / 详情 / 下载任务队列 / 成品下载
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { URL } = require('url');
const configMod = require('./config');
const { config, ensureDirs } = configMod;
const workshop = require('./workshop');
const packer = require('./pack');
const packjob = require('./packjob');
const dlhub = require('./dlhub');
const cdn = require('./cdn');
const guard = require('./guard');

function redactProxy(raw) {
  if (!raw) return '';
  return String(raw).split(';').map((entry) => {
    const eq = entry.indexOf('=');
    const prefix = eq > 0 && /^[a-z][a-z0-9+.-]*=$/i.test(entry.slice(0, eq + 1))
      ? entry.slice(0, eq + 1)
      : '';
    const endpoint = entry.slice(prefix.length).trim();
    try {
      const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(endpoint) ? endpoint : `http://${endpoint}`);
      return `${prefix}${url.host || '已配置'}`;
    } catch {
      return prefix ? `${prefix}已配置` : '已配置';
    }
  }).join(';');
}

function isLoopbackAddress(addr) {
  return /^(127\.|::1$|::ffff:127\.)/.test(String(addr || ''));
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

function requestToken(req, u) {
  const auth = String(req.headers.authorization || '');
  const bearer = /^Bearer\s+(.+)$/i.exec(auth);
  if (bearer) return bearer[1].trim();
  const cookie = String(req.headers.cookie || '');
  const hit = /(?:^|;\s*)we_mpkg_token=([^;]+)/.exec(cookie);
  if (hit) return decodeURIComponent(hit[1]);
  return u.searchParams.get('token') || '';
}

/**
 * 本机请求直接放行；局域网/远程请求必须带令牌。
 * 同时拒绝跨站写请求，防止任意网页通过表单/简单 POST 操控本地服务。
 * @returns {boolean} true 表示已经响应并应结束
 */
function guardRequest(req, res, u, pn) {
  // Host 白名单：DNS rebinding 下 Origin 可以和 Host 完全相同，只有 Host 本身能判断。
  // 本机服务只认 localhost / IP 字面量（远程模式的局域网 IP 也是 IP 字面量，照样能进）。
  const hc = guard.checkHost(req.headers.host);
  if (!hc.ok) {
    if (pn.startsWith('/api/')) json(res, 403, { error: `拒绝请求：${hc.reason}` });
    else {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`拒绝请求：${hc.reason}`);
    }
    return true;
  }
  const remote = !isLoopbackAddress(req.socket && req.socket.remoteAddress);
  if (remote) {
    if (!config.REMOTE_TOKEN) {
      json(res, 403, { error: '远程访问未启用：请先设置 WE_MPKG_TOKEN，再设置 WE_MPKG_HOST' });
      return true;
    }
    if (!safeEqual(requestToken(req, u), config.REMOTE_TOKEN)) {
      if (pn.startsWith('/api/')) json(res, 401, { error: '访问令牌无效' });
      else { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('访问令牌无效'); }
      return true;
    }
    if (u.searchParams.get('token')) {
      res.setHeader('Set-Cookie',
        `we_mpkg_token=${encodeURIComponent(config.REMOTE_TOKEN)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`);
    }
  }
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    const origin = req.headers.origin;
    if (origin) {
      let originHost = '';
      try { originHost = new URL(origin).host; } catch { /* invalid */ }
      if (!originHost || originHost !== req.headers.host) {
        json(res, 403, { error: '拒绝跨站写入' });
        return true;
      }
    }
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') {
      json(res, 403, { error: '拒绝跨站写入' });
      return true;
    }
  }
  return false;
}

/** CDN 测速状态（页面轮询用） */
let cdnTestState = { state: 'idle', startedAt: 0, finishedAt: 0, error: null, progress: null };

/** 下载中心在跑就直接问它要（复用它的 CM 连接），否则本进程临时连一次 */
async function runCdnTest() {
  if (cdnTestState.state === 'running') return cdnTestState;
  const steamjs = require('./steamjs');
  const token = steamjs.readToken();
  if (!token || !token.refreshToken) throw new Error('还没有登录 Steam，无法测速');
  cdnTestState = { state: 'running', startedAt: Date.now(), finishedAt: 0, error: null, progress: null };
  try {
    let data = null;
    const alive = await dlhub.pingHub(HUB_PORT, 800);
    if (alive) {
      if ((alive.running || 0) > 0) throw new Error('有下载任务正在跑，等它结束再测速（同一个账号不能同时开两条 CM 会话）');
      try {
        const r = await dlhub.hubJson(HUB_PORT, 'POST', '/api/hub/cdn/test', {}, 120000);
        if (r.status === 200 && r.body && r.body.ok !== false) data = r.body;
        // 404 = 老版本下载中心还没有这个接口，下面退回本进程测
      } catch { /* 退回本进程 */ }
    }
    if (!data) {
      const client = await steamjs.connect(token.refreshToken, { onLog: () => {} });
      try {
        data = await cdn.testRanking(client, {
          onProgress: (p) => { cdnTestState.progress = p; },
        });
      } finally {
        try { client.logOff(); } catch { /* ignore */ }
        cdn.releaseIdleSockets();
      }
    }
    cdnTestState = {
      state: 'done',
      startedAt: cdnTestState.startedAt,
      finishedAt: Date.now(),
      error: null,
      progress: null,
      testedAt: data.testedAt,
      geo: data.geo,
      servers: data.servers,
    };
    return cdnTestState;
  } catch (e) {
    cdnTestState = { state: 'error', startedAt: cdnTestState.startedAt, finishedAt: Date.now(), error: e.message, progress: null };
    throw e;
  }
}

/** 当前的节点排序：优先内存测速结果，其次磁盘缓存 */
function currentRanking() {
  if (cdnTestState.servers) {
    return { testedAt: cdnTestState.testedAt, geo: cdnTestState.geo, servers: cdnTestState.servers };
  }
  const cached = cdn.loadCached();
  return cached ? { testedAt: cached.testedAt, geo: cached.geo, servers: cached.servers } : { testedAt: 0, geo: null, servers: [] };
}

/** 手机端登录会话状态（/api/login/*） */
let pendingLogin = null;
/** 账号密码登录时保留的 LoginSession（提交 Steam Guard 验证码要用） */
let pendingSession = null;
/** 下载中心端口（按需拉起，见 dlhub.ensureHub） */
const HUB_PORT = dlhub.DEFAULT_PORT;
/** 已解析出来的下载中心地址（懒加载） */
let hubReady = null;

/** 确保下载中心进程在跑；安卓端退回进程内 */
async function hub() {
  if (hubReady) {
    const alive = await dlhub.pingHub(hubReady.port, 1500);
    if (alive) return hubReady;
    hubReady = null;
  }
  hubReady = await dlhub.ensureHub({ port: HUB_PORT, logger: (m) => console.log(`  ${m}`) });
  return hubReady;
}

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

/**
 * 读并解析 JSON 请求体。畸形 JSON 抛 400 级错误（外层统一回 400），不再落到兜底的 500。
 * @param {import('http').IncomingMessage} req
 * @param {object} fallback 空 body 时返回的默认值
 */
async function readJsonBody(req, fallback = {}) {
  const raw = await readBody(req);
  if (!raw || !String(raw).trim()) return fallback;
  try {
    return JSON.parse(raw);
  } catch (e) {
    const err = new Error(`请求体不是合法 JSON：${e.message}`);
    err.statusCode = 400;
    err.code = 'BAD_JSON';
    throw err;
  }
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const safe = path.normalize(path.join(config.PUBLIC_DIR, decodeURIComponent(rel)));
  const publicRoot = path.resolve(config.PUBLIC_DIR);
  if (safe !== publicRoot && !safe.startsWith(publicRoot + path.sep)) {
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

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const pn = u.pathname;
  try {
    if (guardRequest(req, res, u, pn)) return;
    if (pn === '/api/tags') return json(res, 200, { tags: workshop.POPULAR_TAGS });
    if (pn === '/api/filters') {
      try {
        const groups = await workshop.getFilters({ force: u.searchParams.get('force') === '1' });
        // labels 是官方中英对照（只用于显示），拿不到就返回 null，前端会退回内置词表
        return json(res, 200, { groups, labels: workshop.getFilterLabels() });
      } catch (e) {
        return json(res, 502, { error: `筛选条件拉取失败：${e.message}` });
      }
    }
    if (pn === '/api/settings') {
      if (req.method === 'POST') {
        const body = await readJsonBody(req);
        const out = {};
        try {
          if (body.outputDir !== undefined) out.outputDir = configMod.setOutputDir(body.outputDir);
          if (body.proxy !== undefined) {
            out.proxy = redactProxy(configMod.setProxy(body.proxy));
            // 已连接的 Steam 客户端还带着旧代理，下次下载前重建
            try { packjob.resetSharedClient(); } catch { /* ignore */ }
          }
          return json(res, 200, Object.assign({ ok: true }, out));
        } catch (e) {
          return json(res, 400, { ok: false, error: e.message });
        }
      }
      const steamjs = require('./steamjs');
      const token = steamjs.readToken();
      return json(res, 200, {
        outputDir: config.OUTPUT_DIR,
        defaultOutputDir: configMod.DEFAULT_OUTPUT_DIR,
        proxy: redactProxy(config.PROXY),
        defaultProxy: redactProxy(config.PROXY_DEFAULT),
        accountName: token ? token.accountName || null : null,
        hasToken: !!token,
        platform: `${process.platform}/${process.arch}`,
        engine: packjob.activeEngine() || 'none',
      });
    }
    // 只走指定代理做一次连通性测试（不等同于“下载时先直连再回退”）
    if (pn === '/api/proxy/test' && req.method === 'POST') {
      const body = await readJsonBody(req);
      try {
        const r = await require('./net').testProxy(body.proxy || config.PROXY, undefined, 10000);
        return json(res, 200, { ok: true, status: r.status, ms: r.ms });
      } catch (e) {
        return json(res, 200, { ok: false, error: e.message });
      }
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
          pendingLogin = { state: 'failed', url, error: require('./errors').humanizeMessage(e), accountName: null };
        });
        return json(res, 200, { ok: true, url });
      } catch (e) {
        return json(res, 500, { ok: false, error: require('./errors').humanizeMessage(e) });
      }
    }
    // 账号密码登录（手机上没有第二块屏幕可扫二维码时的备选）
    if (pn === '/api/login/credentials' && req.method === 'POST') {
      const steamjs = require('./steamjs');
      let body;
      body = await readJsonBody(req);
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
            pendingLogin = { state: 'failed', error: require('./errors').humanizeMessage(e), accountName: null, codeType: null };
          }
          pendingSession = null;
        });
        session.on('error', (e) => {
          pendingLogin = { state: 'failed', error: require('./errors').humanizeMessage(e), accountName: null, codeType: null };
          pendingSession = null;
        });
        session.on('timeout', () => {
          pendingLogin = { state: 'failed', error: '登录超时，请重试', accountName: null, codeType: null };
          pendingSession = null;
        });
        return json(res, 200, { ok: true, state: pendingLogin.state, codeType: codeType || null });
      } catch (e) {
        pendingLogin = { state: 'failed', error: require('./errors').humanizeMessage(e), accountName: null, codeType: null };
        return json(res, 200, { ok: false, error: require('./errors').humanizeMessage(e) });
      }
    }
    if (pn === '/api/login/code' && req.method === 'POST') {
      let body;
      body = await readJsonBody(req);
      if (!pendingSession) return json(res, 400, { ok: false, error: '没有进行中的登录' });
      try {
        await pendingSession.submitSteamGuardCode(String(body.code || '').trim());
        pendingLogin = { state: 'pending', error: null, accountName: pendingLogin && pendingLogin.accountName, codeType: null };
        return json(res, 200, { ok: true });
      } catch (e) {
        return json(res, 200, { ok: false, error: require('./errors').humanizeMessage(e) });
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
        // 显式退出＝整套都停（下载中心也停，队列已落盘，下次启动接着排）
        dlhub.hubJson(HUB_PORT, 'POST', '/api/hub/shutdown', {}, 2000).catch(() => {});
        try { server.close(); } catch { /* ignore */ }
        setTimeout(() => process.exit(0), 600);
      }, 300);
      return;
    }
    if (pn === '/api/config') {
      const engine = packjob.activeEngine();
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
        proxy: redactProxy(config.PROXY),
        platform: `${process.platform}/${process.arch}`,
        engine: engine || 'none',
        loggedIn: hasToken,
        // 社区站登录态：有它网页抓到的条目才是「你账号」的范围（跟客户端一致）
        webLogin: (() => {
          try { return require('./webcookie').cachedStatus(); } catch { return { loggedIn: false, fresh: false }; }
        })(),
        // 引擎恒定可用（纯 JS）；没登录时仍允许点下载按钮，由前端引导去登录
        canDownload: true,
        canDownloadReason: '',
        version: require('./update').currentVersion(),
      });
    }
    // 自动更新：查 GitHub 最新 Release（默认 6 小时缓存，?force=1 强制刷新）
    if (pn === '/api/update/check') {
      try {
        const data = await require('./update').check({ force: u.searchParams.get('force') === '1' });
        return json(res, 200, data);
      } catch (e) {
        return json(res, 500, { error: e.message });
      }
    }
    if (pn === '/api/cdn/nodes') {
      const rank = currentRanking();
      return json(res, 200, {
        ...rank,
        state: cdnTestState.state,
        error: cdnTestState.error,
        progress: cdnTestState.progress,
      });
    }
    if (pn === '/api/cdn/test' && req.method === 'POST') {
      if (cdnTestState.state === 'running') return json(res, 202, { ok: true, running: true });
      try {
        const st = await runCdnTest();
        return json(res, 200, { ok: true, ...st });
      } catch (e) {
        return json(res, 500, { ok: false, error: e.message });
      }
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
      let id;
      try { id = guard.assertItemId(u.searchParams.get('id')); } catch (e) { return json(res, 400, { error: e.message }); }
      const item = await workshop.getItemDetail(id);
      return json(res, 200, item);
    }
    // 任务事件流：主服务按 SSE 转发下载中心的 /api/hub/events，页面用 EventSource 订阅，
    // 不再每秒轮询 /api/jobs。hub 断开时流会结束，浏览器 EventSource 自动重连。
    if (pn === '/api/events' && req.method === 'GET') {
      let h;
      try { h = await hub(); } catch (e) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' });
        res.write(`event: error\ndata: ${JSON.stringify({ error: `下载中心不可用：${e.message}` })}\n\n`);
        return res.end();
      }
      req.socket.setTimeout(0);
      if (req.socket.setNoDelay) req.socket.setNoDelay(true);
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write('retry: 2000\n\n');
      const upstream = http.get({
        host: '127.0.0.1',
        port: h.port,
        path: '/api/hub/events',
        headers: { Accept: 'text/event-stream', Host: `127.0.0.1:${h.port}` },
      }, (up) => {
        up.on('data', (c) => {
          if (res.writableEnded) return;
          try { res.write(c); } catch { /* 客户端已断 */ }
        });
        up.on('end', () => { try { res.end(); } catch { /* ignore */ } });
        up.on('error', () => { try { res.end(); } catch { /* ignore */ } });
      });
      upstream.on('error', () => {
        try {
          if (!res.writableEnded) res.write(`event: error\ndata: ${JSON.stringify({ error: '下载中心不可用' })}\n\n`);
          res.end();
        } catch { /* ignore */ }
      });
      const close = () => { try { upstream.destroy(); } catch { /* ignore */ } };
      req.on('close', close);
      res.on('close', close);
      return;
    }
    if (pn === '/api/jobs' && req.method === 'POST') {
      if (!packjob.activeEngine()) {
        return json(res, 400, {
          error: '还没有登录 Steam',
          hint: '点右上角 ⚙ 填账号密码登录，或把电脑上 get-token.bat 得到的那段凭据粘进去导入，即可下载；也可用「远程模式」连电脑。',
        });
      }
      const body = await readJsonBody(req);
      if (!body.id) return json(res, 400, { error: '缺少 id' });
      // id 会被拼进 downloads/js-<id>：必须纯数字，否则 "../evil" 能写到下载目录之外
      try { body.id = guard.assertItemId(body.id); } catch (e) { return json(res, 400, { error: e.message }); }
      try {
        const h = await hub();
        const r = await dlhub.hubJson(h.port, 'POST', '/api/hub/jobs', {
          id: body.id,
          title: body.title,
          reference: body.reference,
          raw: body.raw,
          preset: body.preset,
          preserveAudio: body.preserveAudio,
          videoMagic: body.videoMagic,
          // 让「暂停」按钮能按引擎区分：历史记录里的 steamcmd 任务（旧版本）不支持暂停
          engine: packjob.activeEngine(),
        });
        if (r.status !== 200 || !r.body.jobId) {
          return json(res, 502, { error: (r.body && r.body.error) || '下载中心拒绝了这条任务' });
        }
        return json(res, 200, { jobId: r.body.jobId, hub: h.url });
      } catch (e) {
        return json(res, 500, { error: `下载中心不可用：${e.message}` });
      }
    }
    // 下载中心信息（前端拿它拼「在下载中心查看」按钮）
    if (pn === '/api/hub') {
      try {
        const h = await hub();
        const st = await dlhub.pingHub(h.port, 1500);
        return json(res, 200, { ok: true, url: h.url, port: h.port, embedded: !!h.embedded, stats: st || null });
      } catch (e) {
        return json(res, 200, { ok: false, error: e.message });
      }
    }
    if (pn === '/api/jobs' && req.method === 'GET') {
      try {
        const h = await hub();
        const r = await dlhub.hubJson(h.port, 'GET', '/api/hub/jobs');
        return json(res, r.status, r.body);
      } catch (e) {
        return json(res, 502, { error: `下载中心不可用：${e.message}` });
      }
    }
    if (pn.startsWith('/api/jobs/')) {
      const jobId = pn.split('/')[3];
      const action = pn.split('/')[4];
      if (!guard.isValidJobId(jobId)) return json(res, 400, { error: '任务 id 不合法' });
      if (action && !guard.isValidJobAction(action)) return json(res, 400, { error: '不支持的任务动作' });
      try {
        const h = await hub();
        const pathname = action ? `/api/hub/jobs/${encodeURIComponent(jobId)}/${action}` : `/api/hub/jobs/${encodeURIComponent(jobId)}`;
        const r = await dlhub.hubJson(h.port, action ? 'POST' : 'GET', pathname);
        return json(res, r.status, r.body);
      } catch (e) {
        return json(res, 502, { error: `下载中心不可用：${e.message}` });
      }
    }
    // 成品下载：直接流式转发下载中心的文件接口（不在主服务里读整文件）
    if (pn.startsWith('/api/file/')) {
      const jobId = pn.split('/')[3];
      if (!guard.isValidJobId(jobId)) { res.writeHead(400); return res.end('Bad job id'); }
      try {
        const h = await hub();
        const target = new URL(`/api/hub/file/${encodeURIComponent(jobId)}`, h.url);
        const proxy = http.get({ host: '127.0.0.1', port: h.port, path: target.pathname, timeout: 5000 }, (up) => {
          if (up.statusCode !== 200) {
            up.resume();
            res.writeHead(up.statusCode === 404 ? 404 : 502);
            return res.end('Not Found');
          }
          res.writeHead(200, {
            'Content-Type': up.headers['content-type'] || 'application/octet-stream',
            'Content-Length': up.headers['content-length'] || '',
            'Content-Disposition': up.headers['content-disposition'] || 'attachment',
          });
          up.pipe(res);
        });
        proxy.on('timeout', () => { proxy.destroy(); if (!res.headersSent) { res.writeHead(504); res.end('下载中心响应超时'); } });
        proxy.on('error', (e) => { if (!res.headersSent) { res.writeHead(502); res.end(`下载中心不可用：${e.message}`); } });
        return;
      } catch (e) {
        res.writeHead(502);
        return res.end(`下载中心不可用：${e.message}`);
      }
    }
    // 桌面端「打开所在文件夹」：只允许在输出/下载目录里定位，避免被当成任意路径打开器
    if (pn === '/api/reveal' && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!body.path) return json(res, 400, { error: '缺少 path' });
      const target = path.resolve(String(body.path));
      const roots = [config.OUTPUT_DIR, config.DOWNLOAD_DIR].map((p) => path.resolve(p));
      const inside = roots.some((r) => target === r || target.startsWith(r + path.sep));
      if (!inside) return json(res, 403, { error: '只能打开输出目录里的文件' });
      if (!fs.existsSync(target)) return json(res, 404, { error: '文件不存在（可能已被移动或清理）' });
      const isDir = fs.statSync(target).isDirectory();
      try {
        if (process.platform === 'win32') {
          // explorer 的 /select 参数必须是一个整体字符串，指向文件时会在资源管理器里选中它
          const args = isDir ? [target] : [`/select,${target}`];
          spawn('explorer.exe', args, { detached: true, stdio: 'ignore' }).unref();
        } else if (process.platform === 'darwin') {
          spawn('open', isDir ? [target] : ['-R', target], { detached: true, stdio: 'ignore' }).unref();
        } else {
          spawn('xdg-open', [isDir ? target : path.dirname(target)], { detached: true, stdio: 'ignore' }).unref();
        }
        return json(res, 200, { ok: true, dir: isDir ? target : path.dirname(target) });
      } catch (e) {
        return json(res, 500, { error: `打开文件夹失败：${e.message}` });
      }
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
    // 下载中心页面：单独端口、单独进程，主页面关掉也不影响下载
    if (pn === '/downloads' || pn === '/downloads/') {
      try {
        const h = await hub();
        res.writeHead(302, { Location: `${h.url}/` });
        return res.end();
      } catch (e) {
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(`下载中心不可用：${e.message}`);
      }
    }
    return serveStatic(req, res, pn);
  } catch (e) {
    // 请求本身有问题（畸形 JSON、id 不合法等）回 400，别报成服务器错误
    if (e && e.statusCode === 400 && !res.headersSent) return json(res, 400, { error: e.message });
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
  // .cache / logs 治理：临时目录、续转计划、日志体积都在这里收口（失败不影响启动）
  try {
    require('./cachegc').run({ cacheDir: config.CACHE_DIR, logDir: config.LOG_DIR, logger: (m) => console.log(m) });
  } catch (e) {
    console.log(`  ⚠ 缓存治理跳过: ${e.message}`);
  }
  // 下载任务进行中不新建 CM 连接去换社区站 cookie（避免两条会话互相干扰）
  // 任务现在跑在下载中心进程里，因此查它的状态（查不到就不拦，最多是多一次 cookie 刷新）
  workshop.setLoginBusyCheck(async () => {
    try {
      const st = await dlhub.pingHub(HUB_PORT, 800);
      return !!(st && st.running > 0);
    } catch { return false; }
  });
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
  // 每次启动（打开客户端）测一遍 CDN 节点延迟，结果落 .cache/cdn-ranking.json 给下载层用
  (async () => {
    try {
      const steamjs = require('./steamjs');
      const token = steamjs.readToken();
      if (!token || !token.refreshToken) return;
      const cached = cdn.loadCached();
      // 两小时内测过就不重复测（避免反复重启也一直占带宽）
      if (cached && Date.now() - cached.testedAt < 2 * 3600 * 1000) {
        console.log(`  CDN 节点: 使用 ${Math.round((Date.now() - cached.testedAt) / 60000)} 分钟前的测速结果`);
        return;
      }
      console.log('  CDN 节点: 开始启动测速…');
      const st = await runCdnTest();
      console.log(`  CDN 节点: 测速完成（${(st.servers || []).filter((s) => s.ok).length}/${(st.servers || []).length} 可用）`);
    } catch (e) {
      console.log(`  CDN 节点: 测速失败 ${e.message}`);
    }
  })();

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    let host = config.LISTEN_HOST;
    const loopback = host === '127.0.0.1' || host === '::1' || host === 'localhost';
    if (!loopback && !config.REMOTE_TOKEN) {
      console.log('  ⚠ WE_MPKG_HOST 指向局域网，但没有设置 WE_MPKG_TOKEN；为避免局域网裸奔，本次只监听 127.0.0.1');
      host = '127.0.0.1';
    }
    server.listen(port, host, () => {
      console.log(`\n  we-mpkg 已启动: http://localhost:${port}`);
      if (host !== '127.0.0.1' && host !== '::1' && host !== 'localhost') {
        console.log(`  网络监听地址: ${host}（已启用访问令牌，请用带 ?token= 的地址打开）`);
      }
      console.log(`  输出目录: ${config.OUTPUT_DIR}`);
      if (!config.PROXY) console.log('  （可用 WE_MPKG_PROXY / HTTPS_PROXY 指定代理）\n');
      resolve(server);
    });
  });
}

module.exports = { start, server, redactProxy, readJsonBody };

if (require.main === module) {
  start().catch((e) => { console.error('启动失败:', e.message); process.exit(1); });
}

