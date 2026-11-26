'use strict';
/**
 * 创意工坊检索：
 *  1) HTML 抓取 steamcommunity.com/workshop/browse/ —— 无需 API key（默认）
 *  2) IPublishedFileService/QueryFiles —— 需要 STEAM_API_KEY，api.steampowered.com 走通时更稳
 *  3) ISteamRemoteStorage/GetPublishedFileDetails —— 无需 key，批量拿元数据
 */
const net = require('./net');
const { config } = require('./config');

const APP_ID = config.APP_ID;

/** 排序别名 -> steamcommunity browsesort */
const SORT_MAP = {
  trend: 'trend',
  recent: 'mostrecent',
  updated: 'lastupdated',
  top: 'totaluniquesubscribers',
};

/** QueryFiles 的 query_type（经验值，官方文档未完整列出枚举） */
const QUERY_TYPE_MAP = { trend: 3, recent: 1, updated: 1, top: 0 };

/** Wallpaper Engine 创意工坊常见标签（界面筛选用）
 *  注意：`Application`（应用）类型官方已于 2025 年取消，列表里不再出现，
 *  旧缓存/旧页面若还带这个标签，getFilters() 会把它剔掉。
 */
const POPULAR_TAGS = [
  'Video', 'Scene', 'Web',
  'Abstract', 'Anime', 'Cartoon', 'CGI', 'Cyberpunk', 'Fantasy', 'Game', 'Girls', 'Guys',
  'Landscape', 'Medieval', 'Meme', 'Music', 'Nature', 'Pixel', 'Relaxing', 'Retro', 'Sci-Fi',
  'Sports', 'Technology', 'Television', 'Vehicle', 'Unspecified',
  '4K', '1080p', '720p', 'Ultrawide Resolution',
  'Audio Responsive', 'Adult',
];

/** 官方已下线的类型标签：出现即剔除（大小写不敏感） */
const REMOVED_TAGS = new Set(['application', '应用']);

function isRemovedTag(name) {
  return REMOVED_TAGS.has(String(name || '').trim().toLowerCase());
}

/**
 * 官方筛选语义（对齐 Wallpaper Engine 客户端）：
 *   • 同一分组内勾选多个 → 逻辑或（命中任意一个即可）
 *   • 不同分组之间       → 逻辑与（必须同时满足）
 *   • 某分组一个都不勾   → 该分组不过滤
 * Steam 的 requiredtags[] 本身只支持「与」，所以组内多选必须拆成多个
 * 「每组合一个标签」的请求，再对结果取并集，才是官方的行为。
 *
 * 返回 { combos: [[tag...], ...], truncated }
 *   truncated=true 表示组合数超过 MAX_TAG_COMBOS，已退化为「每组取第一个标签」。
 */
function normalizeTagGroups(groups) {
  return (Array.isArray(groups) ? groups : [])
    .map((g) => ({
      name: String((g && g.name) || '').trim(),
      tags: Array.from(new Set((Array.isArray(g && g.tags) ? g.tags : []).map((t) => String(t).trim())))
        .filter((t) => t && !isRemovedTag(t)),
    }))
    .filter((g) => g.name && g.tags.length);
}

function expandTagGroups(groups) {
  const norm = normalizeTagGroups(groups);
  if (!norm.length) return { combos: [[]], truncated: false };

  let combos = [[]];
  for (const g of norm) {
    const next = [];
    for (const base of combos) for (const t of g.tags) next.push(base.concat([t]));
    if (next.length > MAX_TAG_COMBOS) {
      // 组合爆炸：退化成「每组取第一个」——语义从并集收紧成交集，需要提示用户
      return { combos: norm.map((x) => [x.tags[0]]), truncated: true };
    }
    combos = next;
  }
  return { combos, truncated: false };
}


/** 组内「或」展开后允许的组合数上限（每个组合要发一次请求）：超过就退化 */
const MAX_TAG_COMBOS = 8;

/** 单次连续翻页的上限（页），防止误传参数把社区站刷爆 */
const MAX_DEEP_PAGES = 8;

function cleanText(v) {
  return String(v || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function parseTotal(html) {
  const m1 = html.match(/Showing\s+[\d,]+-[\d,]+\s+of\s+([\d,]+)/i);
  if (m1) return parseInt(m1[1].replace(/,/g, ''), 10);
  const m2 = html.match(/共\s*([\d,]+)\s*(?:项|条|个)/);
  if (m2) return parseInt(m2[1].replace(/,/g, ''), 10);
  const m3 = html.match(/workshopBrowsePagingInfo[^>]*>([\s\S]{0,200}?)<\/div>/i);
  if (m3) {
    const n = m3[1].match(/([\d,]+)\s*(entries|项|条)/i);
    if (n) return parseInt(n[1].replace(/,/g, ''), 10);
  }
  return 0;
}

/** 递归下钻：在任意嵌套结构/JSON 字符串里找到 results 数组 */
function deepFindResults(node, depth = 0) {
  if (depth > 10 || node === null || node === undefined) return null;
  if (typeof node === 'string') {
    const t = node.trim();
    if (t.length > 2 && (t[0] === '{' || t[0] === '[')) {
      try {
        return deepFindResults(JSON.parse(t), depth + 1);
      } catch {
        return null;
      }
    }
    return null;
  }
  if (Array.isArray(node)) {
    if (node.length && node[0] && typeof node[0] === 'object' && node[0].publishedfileid) {
      return { results: node, total: 0 };
    }
    for (const v of node) {
      const r = deepFindResults(v, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (typeof node === 'object') {
    if (Array.isArray(node.results) && node.results.length && node.results[0] && node.results[0].publishedfileid) {
      return { results: node.results, total: parseInt(node.total_count, 10) || 0 };
    }
    for (const v of Object.values(node)) {
      const r = deepFindResults(v, depth + 1);
      if (r) return r;
    }
  }
  return null;
}

/**
 * 新版创意工坊页面把 SSR 状态放在
 * <script type="application/json" id="valve-ssr-data">，里面 loaderData 是嵌套 JSON 字符串，
 * 最深处才有 results 数组（publishedfileid / title / preview_url / tags / file_size）。
 */
function parseSsrResults(html) {
  const blocks = [];
  const preferred = html.match(/<script[^>]*id="valve-ssr-data"[^>]*>([\s\S]*?)<\/script>/i);
  if (preferred) blocks.push(preferred[1]);
  for (const m of html.matchAll(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (!blocks.includes(m[1])) blocks.push(m[1]);
  }
  for (const raw of blocks) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const found = deepFindResults(parsed);
    if (found && found.results.length) return found;
  }
  return null;
}

/** 把内嵌结果的字段归一化 */
function normalizeSsrItem(d) {
  const tags = (d.tags || []).map((t) => (typeof t === 'string' ? t : (t.display_name || t.tag))).filter(Boolean);
  return {
    id: String(d.publishedfileid),
    title: d.title || `壁纸 ${d.publishedfileid}`,
    preview: d.preview_url || '',
    author: '',
    creator: d.creator || '',
    description: d.short_description || '',
    subscriptions: d.subscriptions || d.lifetime_subscriptions || 0,
    favorited: d.favorited || d.lifetime_favorited || 0,
    views: d.views || 0,
    fileSize: parseInt(d.file_size, 10) || 0,
    timeUpdated: d.time_updated || 0,
    timeCreated: d.time_created || 0,
    tags,
    appId: d.consumer_appid || APP_ID,
  };
}

/** 从 browse 页面 HTML 里提取条目卡片（新结构优先，旧结构兜底） */
function parseBrowseHtml(html) {
  const ssr = parseSsrResults(html);
  if (ssr) {
    return { items: ssr.results.map(normalizeSsrItem), total: ssr.total, legacy: false };
  }
  const items = [];
  const seen = new Set();
  const re = /data-publishedfileid="(\d+)"/g;
  const marks = [];
  let m;
  while ((m = re.exec(html))) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    marks.push({ id: m[1], index: m.index });
  }
  for (let i = 0; i < marks.length; i++) {
    const cur = marks[i];
    const end = i + 1 < marks.length ? marks[i + 1].index : Math.min(html.length, cur.index + 3400);
    // 条目内容一定在 data-publishedfileid 之后，避免把上一条的标题读进来
    const block = html.slice(cur.index, Math.max(end, cur.index + 400));
    const title = block.match(/class="workshopItemTitle[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const img = block.match(/class="workshopItemPreviewImage[^"]*"[^>]*src="([^"]+)"/i)
      || block.match(/src="(https:\/\/images\.steamusercontent\.com[^"]+)"/i)
      || block.match(/src="([^"]+\.(?:jpg|png|gif|jpeg))"/i);
    const author = block.match(/class="workshopItemAuthorName[^"]*"[\s\S]{0,1000}?<a[^>]*>([\s\S]*?)<\/a>/i);
    items.push({
      id: cur.id,
      title: title ? cleanText(title[1]) : '',
      preview: img ? cleanText(img[1]) : '',
      author: author ? cleanText(author[1]) : '',
    });
  }
  return { items, total: parseTotal(html), legacy: true };
}

/** 批量取详情（无需 API key） */
async function getFileDetails(ids) {
  // 只会拼进表单参数，但仍统一按数字过滤：避免调用方把任意串塞进请求
  const uniq = Array.from(new Set((ids || []).map((v) => String(v).trim()).filter(require('./guard').isValidItemId)));
  if (!uniq.length) return [];
  const parts = [`itemcount=${uniq.length}`];
  uniq.forEach((id, i) => parts.push(`publishedfileids[${i}]=${id}`));
  const text = await net.postForm(
    'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/',
    parts,
    { timeout: 15000, retries: 0 }
  );
  const data = JSON.parse(text);
  const list = (data && data.response && data.response.publishedfiledetails) || [];
  return list.filter((d) => d && d.result === 1);
}

function normalizeDetail(d, hint = {}) {
  return {
    id: String(d.publishedfileid || hint.id || ''),
    title: d.title || hint.title || `壁纸 ${d.publishedfileid}`,
    preview: d.preview_url || hint.preview || '',
    author: hint.author || '',
    creator: d.creator || '',
    description: d.short_description || '',
    subscriptions: d.lifetime_subscriptions || d.subscriptions || 0,
    favorited: d.lifetime_favorited || d.favorited || 0,
    views: d.views || 0,
    fileSize: d.file_size || 0,
    timeUpdated: d.time_updated || 0,
    timeCreated: d.time_created || 0,
    tags: (d.tags || []).map((t) => (typeof t === 'string' ? t : t.tag)).filter(Boolean),
    appId: d.consumer_appid || d.appid || APP_ID,
  };
}

/** 单条详情（含社区页面上的描述/作者） */
async function getItemDetail(id) {
  // id 会被拼进社区页 URL，只接受纯数字
  id = require('./guard').assertItemId(id);
  await ensureWebLogin();
  let base = null;
  try {
    const list = await getFileDetails([id]);
    base = list[0] || null;
  } catch { /* ignore */ }

  let html = '';
  try {
    html = await net.getText(`https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`, {
      timeout: 12000,
      retries: 0,
      headers: { Cookie: net.steamCookie(), 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' },
    });
  } catch { /* 国内网络常失败，忽略 */ }

  const fromHtml = {};
  if (html) {
    const t = html.match(/<div class="workshopItemTitle">([^<]+)<\/div>/);
    if (t) fromHtml.title = cleanText(t[1]);
    const img = html.match(/id="previewImageMain"[^>]+src="([^"]+)"/) || html.match(/id="previewImage"[^>]+src="([^"]+)"/);
    if (img) fromHtml.preview = img[1];
    const desc = html.match(/id="highlightContent"[^>]*>([\s\S]*?)<\/div>/) || html.match(/class="workshopItemDescription[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    if (desc) fromHtml.description = cleanText(desc[1]);
    const author = html.match(/class="friendBlockContent"[^>]*>\s*([\s\S]*?)<br/i) || html.match(/class="workshopItemAuthorName[^"]*"[\s\S]{0,600}?<a[^>]*>([\s\S]*?)<\/a>/i);
    if (author) fromHtml.author = cleanText(author[1]);
    const tags = [];
    for (const [, tag] of html.matchAll(/class="[^"]*workshopTagFilterItem[^"]*"[^>]*>\s*([^<]+)\s*<\/a>/g)) {
      const v = cleanText(tag);
      if (v && !tags.includes(v)) tags.push(v);
    }
    fromHtml.tags = tags;
  }

  const merged = normalizeDetail(
    Object.assign({ publishedfileid: id }, base || {}),
    { id, title: fromHtml.title, preview: fromHtml.preview }
  );
  if (fromHtml.description) merged.description = fromHtml.description;
  if (fromHtml.author) merged.author = fromHtml.author;
  if (fromHtml.tags && fromHtml.tags.length) merged.tags = fromHtml.tags;
  return merged;
}

function buildBrowseUrl({ search = '', sort = 'trend', tags = [], page = 1, perPage = 30, days = 0 }) {
  const browsesort = SORT_MAP[sort] || 'trend';
  const qs = [
    `appid=${APP_ID}`,
    `browsesort=${browsesort}`,
    'section=readytouseitems',
    `actualsort=${browsesort}`,
    `p=${page}`,
    `numperpage=${perPage}`,
  ];
  if (search) qs.push(`searchtext=${encodeURIComponent(search)}`);
  // trend 的 days 是「最近 N 天」，客户端默认覆盖全部时间，网页默认只有最近一周
  if (days && browsesort === 'trend') qs.push(`days=${days}`);
  const tagList = (Array.isArray(tags) ? tags : [tags]).filter((t) => t && !isRemovedTag(t));
  // 标签过多时 Steam 常返回空结果，超过 8 个就放弃过滤
  if (tagList.length && tagList.length <= 8) {
    for (const t of tagList) qs.push(`requiredtags%5B%5D=${encodeURIComponent(t)}`);
  }
  return `https://steamcommunity.com/workshop/browse/?${qs.join('&')}`;
}

/** 确保爬到的是「登录态」的内容范围（有凭据时自动启用；失败就继续匿名） */
let loginChecked = false;
let loginBusyCheck = null;
/** 由 server 注入：下载任务进行中就别再建第二条 CM 连接去换 cookie */
function setLoginBusyCheck(fn) {
  loginBusyCheck = typeof fn === 'function' ? fn : null;
}
async function ensureWebLogin(onLog) {
  if (loginChecked) return;
  try {
    const webcookie = require('./webcookie');
    const busy = loginBusyCheck ? !!(await loginBusyCheck()) : false;
    const c = await webcookie.getLoginCookie({ onLog, allowFetch: !busy });
    if (c && c.cookie) {
      net.setLoginCookie(c.cookie);
      loginChecked = true;
    }
  } catch { /* 保持匿名态 */ }
}

/** 换账号 / 重新登录后重新取一次登录态 */
function resetWebLogin() {
  loginChecked = false;
  net.setLoginCookie('');
}
async function browseHtmlOnce(opts) {
  const url = buildBrowseUrl(opts);
  const html = await net.getText(url, {
    timeout: 20000,
    retries: 0,
    headers: {
      Cookie: net.steamCookie({ anon: !!opts.anon }),
      'Accept-Language': opts.lang === 'en' ? 'en-US,en;q=0.9' : 'zh-CN,zh;q=0.9,en;q=0.8',
    },
  });
  const parsed = parseBrowseHtml(html);
  const hints = parsed.items;
  if (!hints.length) {
    return { items: [], total: 0, backend: 'html', url, warning: '页面未解析到任何条目（可能被网络/风控拦截，或没有匹配结果）' };
  }
  // 新版页面内嵌结果已包含标题/预览/标签/体积，无需再调详情接口
  if (!parsed.legacy) {
    // Steam 现在固定一页返回 30 条，这里按请求的 perPage 截断，保证翻页逻辑正确
    const items = hints.slice(0, opts.perPage || 30);
    return { items, total: parsed.total || hints.length, backend: 'html-ssr', url };
  }
  let details = [];
  try {
    details = await getFileDetails(hints.map((h) => h.id));
  } catch { /* 详情接口失败时退回卡片信息 */ }
  const map = new Map(details.map((d) => [String(d.publishedfileid), d]));
  const items = hints.map((h) => normalizeDetail(Object.assign({ publishedfileid: h.id }, map.get(h.id) || {}), h));
  return { items, total: parsed.total || items.length, backend: 'html', url };
}

/**
 * HTML 抓取模式（连续多页）
 * 社区页面一页固定 30 条、没有「无限滚动」，客户端却能一直滚到底，
 * 所以这里按 pages 连续翻页并合并去重（单次上限 MAX_DEEP_PAGES 页）。
 */
async function browseHtml(opts) {
  const pages = Math.max(1, Math.min(MAX_DEEP_PAGES, parseInt(opts.pages, 10) || 1));
  const firstPage = Math.max(1, parseInt(opts.page, 10) || 1);
  const perPage = opts.perPage || 30;
  if (pages === 1) return browseHtmlOnce({ ...opts, page: firstPage, perPage });

  const seen = new Set();
  const items = [];
  let total = 0;
  let backend = 'html-ssr';
  let warning = '';
  let fetched = 0;
  for (let i = 0; i < pages; i++) {
    const p = firstPage + i;
    let once;
    try {
      once = await browseHtmlOnce({ ...opts, page: p, perPage: perPage * pages });
    } catch (e) {
      warning = warning || `第 ${p} 页抓取失败（${e.message}）`;
      break;
    }
    if (once.backend) backend = once.backend;
    if (once.total) total = Math.max(total, once.total);
    if (once.warning && !warning) warning = once.warning;
    fetched++;
    for (const it of once.items) {
      if (!it || !it.id || seen.has(it.id)) continue;
      seen.add(it.id);
      items.push(it);
    }
    if (once.items.length < 30) break; // 已经到最后一页
    if (i < pages - 1) await new Promise((r) => setTimeout(r, 600)); // 别把社区站请求打太急
  }
  return {
    items: items.slice(0, perPage * pages),
    total: total || items.length,
    backend,
    url: buildBrowseUrl({ ...opts, page: firstPage }),
    warning,
    pagesFetched: fetched,
    pageStart: firstPage,
    pageEnd: firstPage + fetched - 1,
  };
}

/** QueryFiles 模式（需要 key） */
async function browseApi(opts) {
  const { search = '', sort = 'trend', tags = [], page = 1, perPage = 30, days = 0 } = opts;
  // Steam 的 numperpage 上限是 100，网页模式只有 30
  const numperpage = Math.max(1, Math.min(100, parseInt(perPage, 10) || 30));
  const pages = Math.max(1, Math.min(MAX_DEEP_PAGES, parseInt(opts.pages, 10) || 1));
  const startPage = Math.max(1, parseInt(page, 10) || 1);
  const tagList = (Array.isArray(tags) ? tags : [tags]).filter((t) => t && !isRemovedTag(t));

  const items = [];
  const seen = new Set();
  let total = 0;
  for (let i = 0; i < pages; i++) {
    const fields = [`key=${encodeURIComponent(config.API_KEY)}`, `appid=${APP_ID}`,
      `query_type=${QUERY_TYPE_MAP[sort] || 3}`, `page=${startPage + i}`, `numperpage=${numperpage}`,
      'return_metadata=1', 'return_short_description=1'];
    if (search) fields.push(`search_text=${encodeURIComponent(search)}`);
    if (days) fields.push(`days=${days}`);
    for (const t of tagList) fields.push(`requiredtags[]=${encodeURIComponent(t)}`);

    const text = await net.postForm('https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/', fields, { timeout: 25000, retries: 0 });
    const data = JSON.parse(text);
    const resp = (data && data.response) || {};
    if (resp.total) total = Math.max(total, resp.total);
    for (const d of resp.publishedfiledetails || []) {
      const id = String(d.publishedfileid);
      if (seen.has(id)) continue;
      seen.add(id);
      items.push({
        id,
        title: d.title || `壁纸 ${id}`,
        preview: d.preview_url || '',
        author: '',
        creator: d.creator || '',
        description: d.short_description || '',
        subscriptions: d.lifetime_subscriptions || d.subscriptions || 0,
        favorited: d.lifetime_favorited || d.favorited || 0,
        views: d.views || 0,
        fileSize: d.file_size || 0,
        timeUpdated: d.time_updated || 0,
        timeCreated: d.time_created || 0,
        tags: (d.tags || []).map((t) => t.tag).filter((t) => t && !isRemovedTag(t)),
        appId: d.consumer_appid || APP_ID,
      });
    }
    if ((resp.publishedfiledetails || []).length < numperpage) break;
  }
  return {
    items,
    total: total || items.length,
    backend: 'api',
    pagesFetched: pages,
    pageStart: startPage,
    pageEnd: startPage + pages - 1,
  };
}

/** 单个组合的实际抓取（含 API 模式与回退），不含筛选语义 */
async function browseOne(merged) {
  let out;
  if (config.API_KEY) {
    try {
      out = await browseApi(merged);
    } catch (e) {
      const fallback = await browseHtml(merged).catch((e2) => { throw e2; });
      fallback.warning = `QueryFiles 失败（${e.message}），已回退到 HTML 抓取`;
      out = fallback;
    }
  } else {
    out = await browseHtml(merged);
  }
  return out;
}

/** 统一入口
 *  opts: { search, sort, tags, groups, page, perPage, pages, days }
 *  tags   = 旧参数，等价于「所有标签同属一个分组」（全 AND，保留兼容）
 *  groups = [{ name, tags: [] }]，按官方语义解释：组内「或」、组间「与」、空组不过滤
 *  pages  = 一次连续抓多少页（合并去重后返回），用于对齐客户端「一直往下滚」的效果
 */
async function browse(opts = {}) {
  const merged = Object.assign({ search: '', sort: 'trend', tags: [], groups: null, page: 1, perPage: 30, pages: 1, days: 0 }, opts);
  merged.tags = (merged.tags || []).filter((t) => t && !isRemovedTag(t));
  // anon:true 只用于对比「匿名 vs 账号」抓到的数量差，正常浏览不要传
  if (!merged.anon) await ensureWebLogin(merged.onLog);
  const scope = merged.anon || !net.hasLoginCookie() ? 'anon' : 'account';

  const { combos, truncated } = expandTagGroups(merged.groups);
  const notes = [];
  if (truncated) notes.push(`同组勾选过多（超过 ${MAX_TAG_COMBOS} 种组合），已改为每组只取第一个标签`);

  if (combos.length === 1) {
    // 只有一个组合：就是纯交集，走原来的整段连续翻页
    const tags = merged.groups ? combos[0] : merged.tags;
    const out = await browseOne(Object.assign({}, merged, { tags }));
    out.scope = scope; // 让前端明确显示这次抓到的是「账号范围」还是「匿名范围」
    if (notes.length) out.warning = [out.warning, notes.join('；')].filter(Boolean).join(' · ');
    return out;
  }

  // 组内多选 → 每个组合单独请求一次，再对结果取并集（官方的「组内或」）
  const seen = new Set();
  const items = [];
  let total = 0;
  let backend = '';
  let warning = '';
  let pageStart = merged.page;
  let pageEnd = merged.page;
  if ((parseInt(merged.pages, 10) || 1) > 1) {
    notes.push('多选组合模式下每次只抓 1 页（每个组合各一页）');
  }
  for (const combo of combos) {
    let once;
    try {
      once = await browseOne(Object.assign({}, merged, { tags: combo, pages: 1 }));
    } catch (e) {
      warning = warning || `组合 ${combo.join(' / ')} 抓取失败（${e.message}）`;
      continue;
    }
    if (once.backend) backend = once.backend;
    if (once.total) total = Math.max(total, once.total); // 并集后的真实总值拿不到，用最大组合估
    if (once.warning && !warning) warning = once.warning;
    if (once.pageStart) pageStart = Math.min(pageStart, once.pageStart);
    if (once.pageEnd) pageEnd = Math.max(pageEnd, once.pageEnd);
    for (const it of once.items || []) {
      if (!it || !it.id || seen.has(it.id)) continue;
      seen.add(it.id);
      items.push(it);
    }
  }
  return {
    items,
    total,
    backend: backend || 'html-ssr',
    pageStart,
    pageEnd,
    pagesFetched: 1,
    scope,
    unionCombos: combos.length,
    warning: [`已按官方「组内或 / 组间与」合并 ${combos.length} 个筛选组合`, ...notes, warning]
      .filter(Boolean).join(' · '),
  };
}

/**
 * 从创意工坊页面 SSR 状态里读出官方筛选分组（Type / Age Rating / Genre / Resolution …）。
 * Steam 只在页面状态里给这套定义，没有独立接口，所以解析后缓存。
 */
let filtersCache = { at: 0, data: null, labels: null };
const FILTERS_TTL = 30 * 60 * 1000;
/** 中文对照表拉取失败时，隔一会儿再补，不用等满 30 分钟 */
const LABEL_RETRY_MS = 5 * 60 * 1000;

/**
 * 官方英文页和中文页的筛选分组/标签是同构的（标签 id 是稳定的数字 id），
 * 用它生成「英文名 → 官方中文名」对照表：译名来自官方，不依赖机翻，也不用维护词表。
 * 只用于显示；请求筛选时仍然传英文原名（requiredtags[] 只认规范 tag 名）。
 */
function sharedTagIds(a, b) {
  const ids = new Set(((a && a.tags) || []).filter((t) => t && t.id).map((t) => String(t.id)));
  if (!ids.size) return 0;
  let n = 0;
  for (const t of ((b && b.tags) || [])) {
    if (t && t.id && ids.has(String(t.id))) n++;
  }
  return n;
}

/**
 * 把英、中两组分组配对：优先按「共同 tag id 数量」找最佳匹配，不依赖两边顺序；
 * 完全没有 id 交集的分组退回按剩余顺序配对。
 * 之前按下标硬对齐，中文页分组数量/顺序一变，后面的分组（Asset Type / Asset Genre /
 * Script Type 这几个排在最后的）就整体错位，标签全部对不上。
 */
function pairGroups(enGroups, zhGroups) {
  const pairs = [];
  const usedZh = new Set();
  for (const en of enGroups) {
    let pick = -1;
    let best = 0;
    zhGroups.forEach((zh, i) => {
      if (usedZh.has(i)) return;
      const score = sharedTagIds(en, zh);
      if (score > best) { best = score; pick = i; }
    });
    if (pick >= 0 && best > 0) {
      usedZh.add(pick);
      pairs.push([en, zhGroups[pick]]);
    } else {
      pairs.push([en, null]);
    }
  }
  for (const p of pairs) {
    if (p[1]) continue;
    const idx = zhGroups.findIndex((_, i) => !usedZh.has(i));
    if (idx >= 0) { usedZh.add(idx); p[1] = zhGroups[idx]; }
  }
  return pairs;
}

function buildFilterLabels(enGroups, zhGroups) {
  if (!Array.isArray(enGroups) || !Array.isArray(zhGroups) || !enGroups.length || !zhGroups.length) return null;
  const groups = {};
  const tags = {};
  for (const [en, zh] of pairGroups(enGroups, zhGroups)) {
    if (!en || !zh) continue;
    if (en.name && zh.name && en.name !== zh.name) groups[en.name] = zh.name;
    const enTags = en.tags || [];
    const zhTags = zh.tags || [];
    const zhById = new Map(zhTags.filter((t) => t && t.id).map((t) => [String(t.id), t.name]));
    const sameOrder = zhTags.length === enTags.length;
    for (let j = 0; j < enTags.length; j++) {
      const t = enTags[j];
      if (!t || !t.name) continue;
      // 优先按稳定的 tag id 对齐；没有 id 时退回按顺序对齐（长度一致才敢用）
      let zhName = t.id ? zhById.get(String(t.id)) : null;
      if (!zhName && sameOrder && zhTags[j]) zhName = zhTags[j].name;
      if (zhName && zhName !== t.name) tags[t.name] = zhName;
    }
  }
  if (!Object.keys(groups).length && !Object.keys(tags).length) return null;
  return { groups, tags };
}

async function fetchFilterPage(lang) {
  await ensureWebLogin(undefined);
  const cookie = net.steamCookie().replace(/Steam_Language=[^;]*/, `Steam_Language=${lang}`);
  const html = await net.getText(
    `https://steamcommunity.com/app/${APP_ID}/workshop/?l=${lang}`,
    {
      timeout: 25000,
      retries: 1,
      headers: {
        Cookie: cookie,
        'Accept-Language': lang === 'english' ? 'en-US,en;q=0.9' : 'zh-CN,zh;q=0.9',
      },
    },
  );
  return extractFilterGroups(html);
}

async function getFilters({ force = false } = {}) {
  const fresh = filtersCache.data && Date.now() - filtersCache.at < FILTERS_TTL;
  if (!force && fresh) {
    // 分组有了但中文对照表还没拿到（上次中文页抓失败）：过几分钟再补一次
    if (!filtersCache.labels && Date.now() - filtersCache.at > LABEL_RETRY_MS) {
      refreshLabels(filtersCache.data).catch(() => {});
    }
    return filtersCache.data;
  }
  // 先串行确保登录态，避免两个请求同时去取凭据
  await ensureWebLogin(undefined);
  // 英文页拿规范 tag 名；中文页只用来生成显示用的对照表，抓不到不影响筛选本身
  const [groups, zhGroups] = await Promise.all([
    fetchFilterPage('english'),
    fetchFilterPage('schinese').catch(() => null),
  ]);
  if (!groups) throw new Error('创意工坊页面结构变化，未能解析出筛选分组');
  filtersCache = { at: Date.now(), data: groups, labels: buildFilterLabels(groups, zhGroups) };
  return groups;
}

/** 单独补抓中文页，不阻塞筛选返回 */
async function refreshLabels(groups) {
  try {
    const zhGroups = await fetchFilterPage('schinese');
    const labels = buildFilterLabels(groups || [], zhGroups);
    if (labels) {
      filtersCache.labels = labels;
      filtersCache.at = Date.now();
    }
  } catch { /* 中文页抓不到就继续用内置词表兜底 */ }
}

function getFilterLabels() {
  return filtersCache.labels || null;
}

function extractFilterGroups(html) {
  const m = html.match(/<script[^>]*id="valve-ssr-data"[^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  let data;
  try { data = JSON.parse(m[1]); } catch { return null; }

  // queryData 本身是 JSON 字符串，第 8 个 query 是「可立即使用的物品」这一页
  let qd = data.renderContext && data.renderContext.queryData;
  if (typeof qd === 'string') { try { qd = JSON.parse(qd); } catch { return null; } }
  const queries = (qd && qd.queries) || [];
  for (const q of queries) {
    const d = q.state && q.state.data;
    if (d && Array.isArray(d.readytouse_tags) && d.readytouse_tags.length) {
      return d.readytouse_tags
        .filter((g) => g && g.name && Array.isArray(g.tags) && g.tags.length)
        .map((g) => ({
          name: g.name,
          element: g.htmlelement === 'checkbox' ? 'checkbox' : 'select',
          // 官方已取消「应用」类型：即使旧页面/缓存里还带着也剔掉
          tags: g.tags
            .filter((t) => t && t.name && !isRemovedTag(t.name))
            .map((t) => ({ name: t.name, id: String(t.id || '') })),
        }))
        .filter((g) => g.tags.length);
    }
  }
  return null;
}


module.exports = {
  APP_ID,
  POPULAR_TAGS,
  SORT_MAP,
  MAX_DEEP_PAGES,
  MAX_TAG_COMBOS,
  expandTagGroups,
  normalizeTagGroups,
  REMOVED_TAGS,
  isRemovedTag,
  ensureWebLogin,
  setLoginBusyCheck,
  resetWebLogin,
  browse,
  browseHtml,
  browseApi,
  getFilters,
  getFilterLabels,
  buildFilterLabels,
  getItemDetail,
  getFileDetails,
  parseBrowseHtml,
  buildBrowseUrl,
  extractFilterGroups,
  cleanText,
};
