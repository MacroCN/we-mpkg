'use strict';
/**
 * Steam 内容 CDN 节点优选（国内链路支持的核心）。
 *
 * 为什么要这一层：
 *  - Steam 的 GetServersForSteamPipe 会一次返回十几到二十台 CDN（阿里/Edgenext/Akamai/
 *    Fastly/Google，以及 cache*-hkg1、cache*-tpe 这类就近集群），但 steam-user 取 manifest
 *    是「随机挑一台、10 秒硬超时、失败不换源」，只要随机到一条抖动的线路整条任务就报
 *    Request timed out。国内到这些边缘节点的建连抖动很常见（实测同一主机首连 10s+，二连 0.2s）。
 *  - 所以这里做三件事：按客户端出口 IP 决定优先哪个地域的节点 → 开机测一遍延迟并排序 →
 *    下载时严格按这个顺序走，失败就换下一台（见 ServerPicker）。
 *
 * 产出的排序结果落到 .cache/cdn-ranking.json，dlhub 独立进程也能直接读。
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { config, ensureDirs } = require('./config');

const APP_ID = config.APP_ID || '431960';
const RANK_FILE = path.join(config.CACHE_DIR, 'cdn-ranking.json');
const DISK_TTL = 24 * 3600 * 1000; // 排序结果 24 小时内可直接用
const MEM_TTL = 10 * 60 * 1000;    // 进程内 10 分钟内不重复测
const FAIL_COOLDOWN = 5 * 60 * 1000; // 运行时判死的节点 5 分钟内排在最后

/** 集群代码 → 大致地域（只用于「是否就近」的判断，不求精确） */
const CLUSTER_REGION = {
  hkg: 'hk', tpe: 'tw', tyo: 'jp', osa: 'jp', seo: 'kr', sin: 'sg', sha: 'cn', can: 'cn',
  bj: 'cn', tsn: 'cn', chengdu: 'cn', ams: 'nl', lax: 'us', sea: 'us', iad: 'us', ord: 'us',
  dfw: 'us', fra: 'de', lon: 'gb', par: 'fr', syd: 'au', gru: 'br', bom: 'in', mad: 'es',
  sto: 'se', vie: 'at', waw: 'pl',
};

/** 国家 → 就近集群优先级（按顺序） */
const COUNTRY_CLUSTERS = {
  CN: ['cn', 'hk', 'tw', 'sg', 'jp', 'kr'],
  HK: ['hk', 'cn', 'tw', 'sg', 'jp'],
  MO: ['hk', 'cn', 'tw', 'sg', 'jp'],
  TW: ['tw', 'hk', 'cn', 'jp', 'sg'],
  JP: ['jp', 'kr', 'tw', 'hk', 'sg'],
  KR: ['kr', 'jp', 'tw', 'hk', 'sg'],
  SG: ['sg', 'hk', 'tw', 'jp', 'cn'],
  US: ['us', 'ca', 'br', 'gb', 'nl'],
  CA: ['us', 'ca', 'gb', 'nl', 'de'],
  GB: ['gb', 'nl', 'fr', 'de', 'us'],
  DE: ['de', 'nl', 'fr', 'gb', 'pl'],
  NL: ['nl', 'de', 'gb', 'fr', 'us'],
  FR: ['fr', 'gb', 'nl', 'de', 'es'],
  AU: ['au', 'sg', 'jp', 'us'],
  BR: ['br', 'us', 'gb'],
};

/** 国内可直接落地的 CDN 厂商（阿里/Edgenext 在国内有边缘节点） */
const CN_PROVIDERS = new Set(['alibaba', 'edgenext']);

/**
 * 从主机名判断厂商 / 边缘集群。
 * 例：cache10-hkg1.steamcontent.com → { provider:'steamcache', cluster:'hkg', region:'hk' }
 *     alibaba.cdn.steampipe.steamcontent.com → { provider:'alibaba', cluster:'cn', region:'cn' }
 */
function classifyHost(host) {
  const h = String(host || '').toLowerCase();
  let provider = 'other';
  if (/^alibaba\./.test(h) || /alibaba\.cdn\./.test(h)) provider = 'alibaba';
  else if (/^edgenext\./.test(h) || /edgenext\.cdn\./.test(h)) provider = 'edgenext';
  else if (/akamaized\.net$/i.test(h) || /akamai/i.test(h)) provider = 'akamai';
  else if (/^fastly\./.test(h)) provider = 'fastly';
  else if (/^google\d*\./.test(h)) provider = 'google';
  else if (/^cache\d*-/i.test(h)) provider = 'steamcache';

  let cluster = '';
  const m = h.match(/^cache\d+-([a-z]{2,5})(?:\d)?[-.]/);
  if (m && CLUSTER_REGION[m[1]]) cluster = m[1];
  if (!cluster) {
    if (provider === 'alibaba' || provider === 'edgenext') cluster = 'cn';
  }
  const region = CLUSTER_REGION[cluster] || (cluster === 'cn' ? 'cn' : '');
  return { provider, cluster, region, domestic: CN_PROVIDERS.has(provider) || cluster === 'cn' };
}

/** 根据客户端国家给出候选集群的优先级顺序 */
function preferredClusters(countryCode) {
  const cc = String(countryCode || '').toUpperCase();
  return COUNTRY_CLUSTERS[cc] || [];
}

/**
 * 给节点打 tier：越小越优先。
 *  - 客户端在国内：国内厂商/国内集群 = 0，港台新日韩 = 1，其它 = 2，欧美远端 = 3
 *  - 其它地区：按客户端国家对应的就近集群顺序排，越靠前越小
 *  - 拿不到国家时：只按延迟排（tier 全 0）
 */
function tierOf(server, countryCode) {
  const cls = classifyHost(server.Host || server.host);
  const region = cls.region; // 'hk' / 'tw' / 'cn' / 'us' …（cluster 是 hkg / tpe 这类机器码）
  const pref = preferredClusters(countryCode);
  if (!pref.length) return 0;
  if (String(countryCode).toUpperCase() === 'CN') {
    if (cls.domestic) return 0;
    if (region === 'hk' || region === 'tw') return 1; // 港台离得近，抖动通常比日韩小
    if (pref.includes(region)) return 2;
    return 3;
  }
  const idx = pref.indexOf(region);
  if (cls.domestic && pref.includes('cn')) return Math.max(1, idx < 0 ? pref.length : idx);
  if (idx >= 0) return idx;
  return pref.length + 1;
}

/** 单台节点测延迟：TLS/TCP 建连 + 首个响应字节。返回 { ok, latencyMs, error } */
function probeServer(server, { timeoutMs = 5000 } = {}) {
  const host = server.Host || server.host;
  if (!host) return Promise.resolve({ ok: false, error: 'no host' });
  const secure = server.https_support === 'mandatory';
  const mod = secure ? https : http;
  const headers = {
    Host: server.vhost || host,
    'User-Agent': 'Valve/Steam HTTP Client 1.0',
    Connection: 'close',
    Range: 'bytes=0-1023',
  };
  return new Promise((resolve) => {
    let settled = false;
    const t0 = process.hrtime.bigint();
    const done = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    let req;
    try {
      req = mod.request({
        hostname: host,
        port: secure ? 443 : 80,
        path: '/',
        method: 'GET',
        headers,
        agent: false,
      }, (res) => {
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        res.resume();
        done({ ok: true, latencyMs: Math.round(ms), status: res.statusCode });
      });
    } catch (e) {
      return done({ ok: false, error: e.message });
    }
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout ${timeoutMs}ms`)));
    req.on('error', (e) => done({ ok: false, error: e.message }));
    req.end();
  });
}

/** 并发测一整批节点；失败的会再补一次（抖动很强，一次失败不代表节点废了） */
async function probeAll(servers, { timeoutMs = 5000, concurrency = 6, onProgress } = {}) {
  const results = [];
  let idx = 0;
  let finished = 0;
    const worker = async () => {
    while (idx < servers.length) {
      const s = servers[idx++];
      let r = await probeServer(s, { timeoutMs });
      // 抖动很常见：失败补一次，慢得离谱（>3s）也补一次取更小的
      if (!r.ok || r.latencyMs > 3000) {
        const r2 = await probeServer(s, { timeoutMs });
        if (r2.ok && (!r.ok || r2.latencyMs < r.latencyMs)) r = r2;
      }
      results.push({ server: s, ...r });
      finished++;
      if (onProgress) onProgress({ finished, total: servers.length, host: s.Host, ok: r.ok, latencyMs: r.latencyMs });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return results;
}

/** tier 折算成毫秒惩罚：同等延迟下就近/国内节点优先，但慢太多就不该排前面 */
const TIER_PENALTY_MS = 1200;

/** 按 tier + 延迟排序，失败节点排最后 */
function rankResults(results, countryCode) {
  return results
    .map((r) => {
      const cls = classifyHost(r.server.Host || r.server.host);
      const tier = tierOf(r.server, countryCode);
      return {
        host: r.server.Host || r.server.host,
        vhost: r.server.vhost || '',
        type: r.server.type || '',
        https_support: r.server.https_support || '',
        ok: !!r.ok,
        latencyMs: r.ok ? r.latencyMs : null,
        error: r.ok ? null : (r.error || 'fail'),
        provider: cls.provider,
        cluster: cls.cluster,
        region: cls.region,
        domestic: cls.domestic,
        tier,
        score: r.ok ? tier * TIER_PENALTY_MS + r.latencyMs : Number.MAX_SAFE_INTEGER,
      };
    })
    .sort((a, b) => a.score - b.score);
}

/** 把 Steam 接口返回的原始节点对象统一成 steam-user 用的形状（Host / vhost / https_support …） */
function normalizeServer(srv) {
  return {
    type: srv.type,
    sourceid: srv.source_id,
    cell: srv.cell_id,
    load: srv.load,
    preferred_server: srv.preferred_server,
    weightedload: srv.weighted_load,
    NumEntriesInClientList: srv.num_entries_in_client_list,
    Host: srv.host || srv.Host,
    vhost: srv.vhost,
    https_support: srv.https_support,
  };
}

async function fetchServers(client, { cellId } = {}) {
  const cell = Number.isFinite(cellId) ? cellId : (Number.isFinite(client.cellID) ? client.cellID : 0);
  let list = [];
  try {
    const res = await client._apiRequest('GET', 'IContentServerDirectoryService', 'GetServersForSteamPipe', 1, { cell_id: cell });
    const raw = (((res || {}).response || {}).servers) || [];
    const arr = Array.isArray(raw) ? raw : Object.keys(raw).map((k) => raw[k]);
    list = arr.map(normalizeServer).filter((s) => s.Host);
    if (list.length) return list;
  } catch { /* 退回公开方法 */ }
  const r = await client.getContentServers(APP_ID);
  return ((r && r.servers) || []).slice();
}

/** 直接（不走代理）请求一个 JSON 接口，用来判断客户端出口 IP 的国家 */
function getJsonDirect(urlStr, timeoutMs = 6000) {
  const u = new URL(urlStr);
  const mod = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: 'GET',
      headers: { 'User-Agent': 'we-mpkg/2.0 (geo lookup)', Accept: 'application/json' },
      agent: false,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); }
      });
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

/**
 * 判断客户端所在国家（决定优先测哪个地域的节点）。
 * 先用 IP 归属接口（直连，不走代理，反映真实出口），都失败就退回配置里的 STEAM_COUNTRY。
 */
async function detectGeo({ timeoutMs = 6000 } = {}) {
  // 手动指定优先：WE_MPKG_CDN_COUNTRY=CN / US / JP …（IP 接口不可用时也能定地域）
  const forced = String(process.env.WE_MPKG_CDN_COUNTRY || '').trim().toUpperCase();
  if (forced) return { countryCode: forced, source: 'env' };
  const probes = [
    {
      url: 'https://ipinfo.io/json',
      parse: (j) => ({ countryCode: j.country, country: j.country, city: j.city, region: j.region, isp: j.org, ip: j.ip }),
    },
    {
      url: 'http://ip-api.com/json/?fields=status,countryCode,country,regionName,city,isp,query&lang=zh-CN',
      parse: (j) => (j && j.status === 'success'
        ? { countryCode: j.countryCode, country: j.country, city: j.city, region: j.regionName, isp: j.isp, ip: j.query }
        : null),
    },
  ];
  for (const p of probes) {
    try {
      const j = await getJsonDirect(p.url, timeoutMs);
      const g = p.parse(j);
      if (g && g.countryCode) return { ...g, source: 'ip' };
    } catch { /* 换下一个 */ }
  }
  const fallback = String(config.COUNTRY || '').toUpperCase();
  return { countryCode: fallback || '', source: fallback ? 'config' : 'unknown' };
}

// ---------------- 排序结果的读写 ----------------

let memory = null; // { at, geo, servers, testedAt }
const runtimeFailed = new Map(); // host → 时间戳

function isFresh(file, ttl) {
  if (!file || !file.testedAt) return false;
  return Date.now() - file.testedAt < ttl;
}

function readRankingFile() {
  try {
    const j = JSON.parse(fs.readFileSync(RANK_FILE, 'utf8'));
    if (!j || !Array.isArray(j.servers) || !j.testedAt) return null;
    return j;
  } catch {
    return null;
  }
}

function writeRankingFile(data) {
  try {
    ensureDirs();
    fs.writeFileSync(RANK_FILE, JSON.stringify(data, null, 2));
  } catch { /* 写不进去也不影响本次运行 */ }
}

/** 运行时把某台节点判定为失败（5 分钟内排到最后） */
function markFailed(host) {
  if (!host) return;
  runtimeFailed.set(String(host), Date.now());
}

function isRuntimeFailed(host) {
  const t = runtimeFailed.get(String(host));
  if (!t) return false;
  if (Date.now() - t > FAIL_COOLDOWN) {
    runtimeFailed.delete(String(host));
    return false;
  }
  return true;
}

/** 清掉 Node 全局 agent 里闲置的 keep-alive 连接（Valve CDN 会静默丢弃，复用它就会挂 10 秒） */
function releaseIdleSockets() {
  for (const agent of [http.globalAgent, https.globalAgent]) {
    try {
      const free = agent.freeSockets || {};
      for (const key of Object.keys(free)) {
        for (const sock of free[key] || []) {
          try { sock.destroy(); } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
  }
}

/**
 * steam-user 的 cdn.download() 在 10 秒超时后只 reject、不 abort 底层请求，
 * 那些悬挂的 socket 会一直占着连接（实测一条 17MB 的任务结束后残留 7~8 个），
 * 越积越多会让后面的请求更难拿到响应。这里给 CDN 的底层请求加一层 15 秒空闲兜底：
 * 比 steam-user 自己的 10 秒晚，不改变它的行为，只是把「它已经放弃的请求」真正关掉。
 */
const GUARD_IDLE_MS = 15000;
let guardInstalled = false;

function installCdnGuard() {
  if (guardInstalled) return;
  guardInstalled = true;
  for (const mod of [http, https]) {
    const orig = mod.request;
    const wrapped = function (...args) {
      const req = orig.apply(mod, args);
      let opts = args[0];
      if (typeof opts === 'string') {
        try { opts = new URL(opts); } catch { opts = {}; }
      }
      const host = String((opts && (opts.host || opts.hostname)) || '');
      const p = String((opts && opts.path) || '');
      if (!/steamcontent|akamaized|steamcdn/i.test(host) && !p.startsWith('/depot/')) return req;
      let timer = null;
      const bump = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          try { req.destroy(new Error(`CDN 请求 ${GUARD_IDLE_MS}ms 无数据（wempkg 兜底关闭）`)); } catch { /* ignore */ }
        }, GUARD_IDLE_MS);
        if (timer.unref) timer.unref();
      };
      req.on('socket', (s) => {
        bump();
        s.on('data', bump);
      });
      req.on('response', (res) => {
        bump();
        res.on('data', bump);
        res.on('end', () => { if (timer) clearTimeout(timer); });
      });
      req.on('close', () => { if (timer) clearTimeout(timer); });
      bump();
      return req;
    };
    wrapped.__wempkgGuard = true;
    mod.request = wrapped;
  }
}

installCdnGuard();

/**
 * 测速并排序。返回 { testedAt, geo, servers }。
 * @param {object} client 已登录的 steam-user 实例
 */
async function testRanking(client, { onLog = () => {}, onProgress = null, countryCode = null } = {}) {
  const geo = countryCode
    ? Object.assign({ countryCode: String(countryCode).toUpperCase(), source: 'manual' }, await detectGeo().catch(() => ({})))
    : await detectGeo();
  const servers = await fetchServers(client);
  if (!servers.length) throw new Error('拿不到 Steam 内容服务器列表');
  onLog(`节点测速：${servers.length} 台，客户端地区 ${geo.countryCode || '未知'}`);
  const probes = await probeAll(servers, { onProgress });
  const ranked = rankResults(probes, geo.countryCode);
  const okCount = ranked.filter((s) => s.ok).length;
  onLog(`节点测速完成：${okCount}/${ranked.length} 可用，最快 ${ranked.find((s) => s.ok) ? `${ranked.find((s) => s.ok).host} ${ranked.find((s) => s.ok).latencyMs}ms` : '无'}`);
  const data = { testedAt: Date.now(), geo, servers: ranked };
  writeRankingFile(data);
  memory = { at: Date.now(), geo: data.geo, servers: data.servers, testedAt: data.testedAt };
  return data;
}

/**
 * 拿排序结果：内存 → 磁盘（24h 内）→ 现测。
 */
async function getRanking(client, { force = false, onLog = () => {} } = {}) {
  if (force) return testRanking(client, { onLog });
  if (memory && Date.now() - memory.at < MEM_TTL) return memory;
  const disk = readRankingFile();
  if (disk && isFresh(disk, DISK_TTL)) {
    memory = { at: Date.now(), geo: disk.geo || {}, servers: disk.servers, testedAt: disk.testedAt };
    return memory;
  }
  return testRanking(client, { onLog });
}

/**
 * 给下载层用：返回「已登录 client 现取的真实 server 对象」，按排序结果重排。
 * 用现取对象而不是磁盘里的副本，是为了保留 steam-user 需要的字段（vhost/type/cell 等）。
 */
async function getOrderedServers(client, { onLog = () => {} } = {}) {
  const ranking = await getRanking(client, { onLog });
  const servers = await fetchServers(client);
  const order = new Map((ranking.servers || []).map((s, i) => [s.host, i]));
  const sorted = servers.slice().sort((a, b) => {
    const ia = order.has(a.Host) ? order.get(a.Host) : 9999;
    const ib = order.has(b.Host) ? order.get(b.Host) : 9999;
    if (ia !== ib) return ia - ib;
    return 0;
  });
  // 运行时判死的挪到最后，但仍留在候选里（全挂了还能兜底）
  const dead = sorted.filter((s) => isRuntimeFailed(s.Host));
  const alive = sorted.filter((s) => !isRuntimeFailed(s.Host));
  return alive.concat(dead);
}

/** 下载用的节点选择器：严格按排序走，失败自动换下一台，全挂一轮后重置再来 */
class ServerPicker {
  constructor(servers) {
    this.servers = (servers || []).slice();
    this.failed = new Set();
    this.cursor = 0;
    this.rounds = 0;
  }

  alive() {
    return this.servers.filter((s) => !this.failed.has(s.Host));
  }

  /** 取下一台可用节点；全部判死后自动重置一轮 */
  next() {
    if (!this.servers.length) return null;
    const alive = this.alive();
    if (!alive.length) {
      this.failed.clear();
      this.rounds++;
      return this.servers[this.cursor++ % this.servers.length];
    }
    for (let i = 0; i < this.servers.length; i++) {
      const s = this.servers[(this.cursor++) % this.servers.length];
      if (!this.failed.has(s.Host)) return s;
    }
    return alive[0];
  }

  /** 本轮失败：标记该节点，后面的请求自然落到下一台 */
  fail(server) {
    if (!server || !server.Host) return;
    this.failed.add(String(server.Host));
    markFailed(server.Host);
  }

  reset() {
    this.failed.clear();
  }
}

module.exports = {
  APP_ID, RANK_FILE,
  classifyHost, preferredClusters, tierOf, rankResults, probeServer, probeAll,
  detectGeo, fetchServers, testRanking, getRanking, getOrderedServers,
  loadCached: readRankingFile, save: writeRankingFile,
  markFailed, isRuntimeFailed, releaseIdleSockets,
  ServerPicker,
};
