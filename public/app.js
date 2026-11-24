'use strict';

// ---------------- i18n ----------------
const I18N = {
  zh: {
    title: '创意工坊 → MPKG',
    subtitle: '浏览 Wallpaper Engine 创意工坊，下载并导出手机版容器',
    searchPh: '搜索壁纸名称、作者、关键词…',
    searchBtn: '搜索',
    sortTrend: '热门趋势', sortRecent: '最新发布', sortUpdated: '最近更新', sortTop: '订阅最多',
    filters: '筛选', clearFilters: '清空', prev: '上一页', next: '下一页',
    downloadPack: '下载并打包为 MPKG', steamPage: 'Steam 页面', saveMpkg: '保存 .mpkg', importWe: '导入壁纸引擎',
    needLogin: '先登录再下载', notLogged: '未登录，点右上角 ⚙ 登录',
    rawOnly: '只下载原始文件（不打包 mpkg）',
    hub: '下载中心', openHub: '在下载中心查看（独立进程，关页面也不中断）', cancelTask: '取消任务',
    hubHint: '独立进程运行，关掉本页面任务也会继续',
    openSetup: '启动页：本地 / 远程 / 导入凭据', setupHint: '想切换本地 / 远程服务，或粘贴电脑上的凭据导入，点这个按钮回启动页（页面状态不会丢）。',
    quality: '画质', qHigh: '高画质（原尺寸）', qBalanced: '均衡（1/2 尺寸）', qSmooth: '流畅（1/4 尺寸）',
    pickedN: '已选 {n} 项', batchStart: '打包下载', batchClear: '清空', batchConfirm: '把选中的 {n} 条加入下载中心？',
    batchQueued: '已加入下载中心：{n} 个任务（最多同时跑 3 条）', batchNone: '先勾选要下载的壁纸',
    batchFail: '批量提交失败：',
    deviceRec: '推荐画质：{q}（{d}）', deviceHint: '这个推荐只影响默认值，随时可以自己改',
    compatTitle: '打包前兼容性', compatOk: '兼容性良好', compatWarn: '需注意', compatBad: '大概率黑屏',
    compatMeta: '{t} · 纹理 {n} 张（视频 {v}）· 预计显存 {m} MB · 体积 {s}',
    compatNone: '暂无预检结果（任务开始打包后会显示）',
    updateTitle: '版本更新', updateCheck: '检查更新', updateDownload: '打开下载页',
    updateChecking: '正在检查 GitHub 最新版本…', updateLatest: '已是最新版本（{v}）',
    updateFound: '发现新版本 {v}（当前 {c}）', updateFail: '检查失败：',
    keepAudio: '保留壁纸自带音频',
    rawTip: '勾上后只把条目原始文件下到「下载目录/js-条目ID」：scene.pkg、mp4 等原样保留，适合自己再转换或用其他工具处理。',
    exitApp: '退出程序（关闭后台服务）',
    exitConfirm: '确定退出？后台服务会被关闭，本页随即失效。',
    exitDone: '已退出，后台服务已关闭，可以关掉这个页面了。',
    settingsTitle: '设置', outputDir: '下载目录（mpkg 保存位置）', save: '保存', resetDefault: '恢复默认',
    pickFolder: '选择文件夹…', pickDone: '已选择：{d}', pickUnsupported: '当前环境不支持系统选择器，请手动填写路径',
    pickFail: '没有拿到目录，请重试或手动填写路径',
    account: 'Steam 账号', accountField: 'Steam 账号', passField: '密码（仅本次登录用，不保存）',
    login: '登录', logout: '退出登录',
    loginTip: '有 Steam App 的账号会收到「确认登录」推送，直接在手机上点确认即可；也可以在电脑上运行 get-token.bat 取凭据再导入。',
    submitCode: '提交', codePh: 'Steam Guard 验证码', needCode: '需要 Steam Guard 验证码（Steam App 里那串字母数字）',
    loading: '正在获取创意工坊列表…', empty: '没有结果。可减少筛选条件，或配置代理（WE_MPKG_PROXY）。',
    total: '共 {n} 条 · 第 {p} 页 · 后端：{b}', backendHtml: '网页抓取', backendApi: 'QueryFiles API',
    scopeAccount: ' · 账号范围', scopeAnon: ' · 匿名范围（比客户端少）',
    totalDeep: '共 {n} 条 · 已取第 {a}-{b} 页（{m} 条）· 后端：{c}',
    depthLabel: '每次加载', depth1: '1 页（30 条）', depth3: '3 页（90 条）', depth5: '5 页（150 条）',
    daysLabel: '热门时间窗', days7: '最近 7 天', days30: '最近 30 天', days90: '最近 3 个月', days365: '最近 1 年',
    daysTip: '「热门趋势」在后台上默认只取最近 7 天，客户端是整个时间轴；想多看就把时间窗拉长或换排序。',
    pageN: '第 {p} 页', failed: '加载失败：', noDownload: '当前平台不能下载',
    vpnHint: '一直加载不出来？先打开加速器（VPN / 游戏加速器）再点搜索。',
    dirSaved: '已保存：{d}', dirFail: '保存失败：', dirDefault: '默认目录：{d}',
    proxyField: '代理（留空 = 跟随系统；下载时先直连，连不上才走它）',
    proxyTest: '测试连通性', proxySaved: '已保存：{p}', proxyDefault: '跟随系统：{p}', proxyNone: '当前直连，没有配置代理',
    proxyTesting: '测试中…', proxyOk: '代理可用：HTTP {s}，{m} ms', proxyFail: '代理不可用：', proxyCleared: '已恢复为跟随系统',
    loginWaiting: '已打开 Steam，请在 Steam App 里确认登录…',
    loginDone: '已登录：{a}', loginFailed: '登录失败：', loginIdle: '未登录（可先用电脑导入凭据）',
    groupMisc: '其他特性', groupType: '类型', groupAge: '年龄分级', groupGenre: '题材',
    groupRes: '分辨率', groupCategory: '分类', groupAssetType: '素材类型',
    groupAssetGenre: '素材题材', groupScript: '脚本类型',
    cdnTitle: '下载节点', cdnTest: '测速', cdnTesting: '正在测速…',
    cdnHint: '启动时会自动测一次；zip 下载按这里的延迟顺序走，节点失败自动换下一台。',
    cdnEmpty: '还没有测速结果，点「测速」开始。',
    cdnGeo: '你的出口地区：{c}', cdnRanked: '{n} 台可用 · 测于 {t}',
    cdnFail: '测速失败：', cdnNoLogin: '先登录 Steam 再测速。',
  },
  en: {
    title: 'Workshop → MPKG',
    subtitle: 'Browse Wallpaper Engine Workshop, download and export mobile containers',
    searchPh: 'Search title, author, keyword…',
    searchBtn: 'Search',
    sortTrend: 'Trending', sortRecent: 'Most recent', sortUpdated: 'Recently updated', sortTop: 'Most subscribed',
    filters: 'Filters', clearFilters: 'Clear', prev: 'Prev', next: 'Next',
    downloadPack: 'Download & pack MPKG', steamPage: 'Steam page', saveMpkg: 'Save .mpkg', importWe: 'Import to Wallpaper Engine',
    needLogin: 'Sign in first', notLogged: 'Not signed in — tap ⚙ to sign in',
    rawOnly: 'Download raw files only (no mpkg)',
    hub: 'Downloads', openHub: 'Open download center (separate process, closing this page won\'t stop it)',
    cancelTask: 'Cancel task', hubHint: 'runs in a separate process, safe to close this page',
    openSetup: 'Launcher: local / remote / import credential', setupHint: 'Use this to switch local / remote service or paste a desktop credential; page state is kept.',
    quality: 'Quality', qHigh: 'High (native size)', qBalanced: 'Balanced (1/2)', qSmooth: 'Smooth (1/4)',
    pickedN: '{n} selected', batchStart: 'Download selected', batchClear: 'Clear', batchConfirm: 'Queue {n} selected wallpapers?',
    batchQueued: 'Queued {n} jobs in download center (max 3 at once)', batchNone: 'Tick some wallpapers first',
    batchFail: 'Batch failed: ',
    deviceRec: 'Recommended: {q} ({d})', deviceHint: 'This only changes the default — you can override anytime',
    compatTitle: 'Pre-pack compatibility', compatOk: 'Looks good', compatWarn: 'Needs attention', compatBad: 'Likely black screen',
    compatMeta: '{t} · {n} textures ({v} video) · ~{m} MB VRAM · {s}',
    compatNone: 'No report yet (appears when packing starts)',
    updateTitle: 'Updates', updateCheck: 'Check for updates', updateDownload: 'Open download page',
    updateChecking: 'Checking the latest GitHub release…', updateLatest: 'You are up to date ({v})',
    updateFound: 'New version {v} available (current {c})', updateFail: 'Check failed: ',
    keepAudio: 'Keep wallpaper audio',
    rawTip: 'Downloads the original files into "download dir/js-<id>" (scene.pkg, mp4, …) untouched — handy for your own conversion or other tools.',
    exitApp: 'Quit (stop background service)',
    exitConfirm: 'Quit now? The background service will be stopped and this page will stop working.',
    exitDone: 'Quit. The service is stopped — you can close this page.',
    settingsTitle: 'Settings', outputDir: 'Download folder (where mpkg is saved)', save: 'Save', resetDefault: 'Reset default',
    pickFolder: 'Choose folder…', pickDone: 'Selected: {d}', pickUnsupported: 'System folder picker unavailable — type a path',
    pickFail: 'No folder returned. Try again or type a path',
    account: 'Steam account', accountField: 'Steam account', passField: 'Password (used once, not saved)',
    login: 'Sign in', loginTip: 'Accounts with the Steam app get a “confirm sign-in” prompt — just approve it on your phone. Or run get-token.bat on a PC and import the credential.',
    submitCode: 'Submit', codePh: 'Steam Guard code', needCode: 'Steam Guard code required',
    loading: 'Loading Workshop items…', empty: 'No results. Try fewer filters or set a proxy (WE_MPKG_PROXY).',
    total: '{n} items · page {p} · backend: {b}', backendHtml: 'HTML scrape', backendApi: 'QueryFiles API',
    scopeAccount: ' · account scope', scopeAnon: ' · anonymous scope (fewer than the client)',
    totalDeep: '{n} items · pages {a}-{b} ({m} loaded) · backend: {c}',
    depthLabel: 'Fetch', depth1: '1 page (30)', depth3: '3 pages (90)', depth5: '5 pages (150)',
    daysLabel: 'Trend window', days7: 'Last 7 days', days30: 'Last 30 days', days90: 'Last 3 months', days365: 'Last year',
    daysTip: 'Trending only covers the last 7 days by default; the client browses the whole timeline. Widen the window or change the sort.',
    pageN: 'Page {p}', failed: 'Failed: ', noDownload: 'Download not available on this platform',
    vpnHint: 'Still empty? Turn on a VPN / game accelerator, then search again.',
    dirSaved: 'Saved: {d}', dirFail: 'Failed: ', dirDefault: 'Default: {d}',
    proxyField: 'Proxy (blank = follow system; downloads try direct first, then fall back to it)',
    proxyTest: 'Test connection', proxySaved: 'Saved: {p}', proxyDefault: 'System proxy: {p}', proxyNone: 'Direct, no proxy configured',
    proxyTesting: 'Testing…', proxyOk: 'Proxy OK: HTTP {s}, {m} ms', proxyFail: 'Proxy failed: ', proxyCleared: 'Reset to follow system',
    loginWaiting: 'Waiting for confirmation in the Steam app…',
    loginDone: 'Signed in: {a}', loginFailed: 'Login failed: ', loginIdle: 'Not signed in', logout: 'Sign out',    groupMisc: 'Miscellaneous', groupType: 'Type', groupAge: 'Age Rating', groupGenre: 'Genre',
    groupRes: 'Resolution', groupCategory: 'Category', groupAssetType: 'Asset Type',
    groupAssetGenre: 'Asset Genre', groupScript: 'Script Type',
    cdnTitle: 'Download nodes', cdnTest: 'Speed test', cdnTesting: 'Testing…',
    cdnHint: 'Runs once at startup; downloads follow this latency order and fail over to the next node automatically.',
    cdnEmpty: 'No result yet — tap “Speed test”.',
    cdnGeo: 'Your region: {c}', cdnRanked: '{n} nodes OK · tested {t}',
    cdnFail: 'Speed test failed: ', cdnNoLogin: 'Sign in to Steam first.',
  },
};

const GROUP_LABEL_KEY = {
  Miscellaneous: 'groupMisc', Type: 'groupType', 'Age Rating': 'groupAge', Genre: 'groupGenre',
  Resolution: 'groupRes', Category: 'groupCategory', 'Asset Type': 'groupAssetType',
  'Asset Genre': 'groupAssetGenre', 'Script Type': 'groupScript',
};

// 标签中文名（拿不到就原样显示）
const TAG_ZH = {
  Video: '视频', Scene: '场景', Web: '网页',
  Everyone: '全年龄', Questionable: '内容待定', Mature: '成人',
  Abstract: '抽象', Animal: '动物', Anime: '动漫', Cartoon: '卡通', CGI: 'CG 渲染',
  Cyberpunk: '赛博朋克', Fantasy: '奇幻', Game: '游戏', Girls: '女性', Guys: '男性',
  Landscape: '风景', Medieval: '中世纪', Memes: '梗图', MMD: 'MMD', Music: '音乐',
  Nature: '自然', 'Pixel art': '像素', Relaxing: '治愈', Retro: '复古', 'Sci-Fi': '科幻',
  Sports: '运动', Technology: '科技', Television: '影视', Vehicle: '载具', Unspecified: '未指定',
  Approved: '已审核', 'Audio responsive': '音频响应', '3D': '3D', Customizable: '可定制',
  'Puppet Warp': '木偶变形', HDR: 'HDR', 'Media Integration': '媒体集成',
  'User Shortcut': '快捷键', 'Video Texture': '视频纹理', 'Asset Pack': '素材包',
  Wallpaper: '壁纸', Preset: '预设', Asset: '素材',
  'Standard Definition': '标清', 'Ultrawide Standard Definition': '超宽标清',
  'Other resolution': '其它分辨率', 'Dynamic resolution': '动态分辨率',
  'Ultrawide': '超宽', 'Dual': '双屏', 'Triple': '三屏', 'Portrait': '竖屏',
};

function tr(key, vars) {
  const dict = I18N[state.lang] || I18N.zh;
  let s = dict[key] != null ? dict[key] : (I18N.zh[key] || key);
  if (vars) for (const k of Object.keys(vars)) s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), vars[k]);
  return s;
}

function tagLabel(name) {
  if (state.lang !== 'zh') return name;
  if (TAG_ZH[name]) return TAG_ZH[name];
  // 分辨率这类纯数字/组合串做前缀翻译
  return String(name)
    .replace(/^Ultrawide /, '超宽 ')
    .replace(/^Dual /, '双屏 ')
    .replace(/^Triple /, '三屏 ')
    .replace(/^Portrait /, '竖屏 ')
    .replace(/Standard Definition$/, '标清');
}

function applyLang() {
  document.documentElement.lang = state.lang === 'zh' ? 'zh-CN' : 'en';
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    el.textContent = tr(key);
  });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => {
    el.placeholder = tr(el.getAttribute('data-i18n-ph'));
  });
  $('langBtn').textContent = state.lang === 'zh' ? 'EN' : '中文';
  // 重建筛选区（标签文案随语言变化）
  if (state.filterGroups.length) renderFilters();
  if (state.total || state.statusText) {
    $('status').textContent = state.statusText;
  }
  $('pageinfo').textContent = tr('pageN', { p: state.page });
  setDownloadLabel();
}

// ---------------- 状态 ----------------
const state = {
  currentJob: null,       // 正在展示进度的下载中心任务 id
  page: 1,
  perPage: 24,
  pages: 1,               // 一次连续抓几页（1/3/5），用于尽量接近客户端「无限滚动」
  days: 7,                // 热门趋势的时间窗（天）
  search: '',
  sort: 'trend',
  // 官方筛选语义：组内「或」、组间「与」、空组不过滤。
  // 所以选中态必须按分组保存，不能再把所有标签塞进同一个集合。
  sel: {},                  // { 组名: Set<标签英文名> }
  filterGroups: [],
  openGroups: null,        // Set：记得每组展开状态，重渲染不丢
  filtersOpen: true,       // 手机默认收起筛选区，先把列表露出来
  total: 0,
  current: null,
  poll: null,
  canDownload: true,
  canDownloadReason: '',
  loggedIn: false,
  webLogin: null,          // 社区站登录态 {loggedIn,fresh,accountName}
  rawOnly: false,
  statusText: '',
  lang: 'zh',
  loginPoll: null,
  picked: new Map(),      // 批量下载：id -> 条目对象
  batchBusy: false,
  device: null,           // 设备画像与推荐画质
};

const $ = (id) => document.getElementById(id);

// 顶栏、搜索栏都是 sticky，后面吸顶层的 top 偏移必须跟着它们的真实高度走，
// 写死 57/105 在不同字号、换行、安全区下会互相遮盖。
function syncStickyLayout() {
  const root = document.documentElement;
  const topbar = document.querySelector('.topbar');
  const searchbar = document.querySelector('.searchbar');
  if (topbar) root.style.setProperty('--topbar-h', `${Math.round(topbar.getBoundingClientRect().height)}px`);
  if (searchbar) root.style.setProperty('--search-h', `${Math.round(searchbar.getBoundingClientRect().height)}px`);
}

function watchStickyLayout() {
  syncStickyLayout();
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => syncStickyLayout());
    for (const el of [document.querySelector('.topbar'), document.querySelector('.searchbar')]) {
      if (el) ro.observe(el);
    }
  }
  window.addEventListener('resize', syncStickyLayout);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncStickyLayout).catch(() => {});
}

function human(bytes) {
  if (!bytes) return '—';
  if (bytes > 1024 ** 3) return (bytes / 1024 ** 3).toFixed(2) + ' GB';
  if (bytes > 1024 ** 2) return (bytes / 1024 ** 2).toFixed(1) + ' MB';
  if (bytes > 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return bytes + ' B';
}

function dateStr(ts) {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ---------------- 筛选区 ----------------
// 官方语义：同一分组内多选 = 或；不同分组之间 = 与；某组一个不选 = 该组不过滤。
// 选中态按分组存（state.sel），提交给后端时序列化成 [{name, tags}]。

function groupSet(name) {
  if (!state.sel[name]) state.sel[name] = new Set();
  return state.sel[name];
}

function selectedCount() {
  let n = 0;
  for (const k of Object.keys(state.sel)) n += state.sel[k].size;
  return n;
}

function selectedGroups() {
  const out = [];
  for (const k of Object.keys(state.sel)) {
    const tags = Array.from(state.sel[k]);
    if (tags.length) out.push({ name: k, tags });
  }
  return out;
}

function renderFilters() {
  const box = $('filterGroups');
  if (!state.openGroups) {
    // 首次渲染：只展开「类型」和「年龄分级」，其余折叠，手机上一屏能看全
    state.openGroups = new Set(['Type', 'Age Rating']);
  }
  box.innerHTML = '';
  for (const g of state.filterGroups) {
    // 官方客户端里每个分组都允许多选（组内「或」）；Steam 页面上的 htmlelement
    // 是 select 还是 checkbox 只影响它的网页渲染，不代表筛选语义是单选。
    const set = groupSet(g.name);
    const el = document.createElement('div');
    el.className = 'fgroup' + (state.openGroups.has(g.name) ? ' open' : '');

    const head = document.createElement('div');
    head.className = 'fgroup-head';
    // 筛选一律用 Steam 的原始英文名：翻译过的标签名拿去请求会筛不到东西
    const label = g.name;
    const cnt = set.size;
    head.innerHTML = `<span>${esc(label)}${cnt ? `<span class="cnt">${esc(Array.from(set).join(' / '))}</span>` : ''}</span><span class="caret">›</span>`;
    head.onclick = () => {
      if (state.openGroups.has(g.name)) state.openGroups.delete(g.name);
      else state.openGroups.add(g.name);
      el.classList.toggle('open');
    };

    const body = document.createElement('div');
    body.className = 'fgroup-body';
    for (const t of g.tags) {
      const chip = document.createElement('span');
      chip.className = 'chip' + (set.has(t.name) ? ' on' : '');
      chip.textContent = t.name;
      chip.onclick = () => {
        if (set.has(t.name)) set.delete(t.name);
        else set.add(t.name);
        renderFilters();
        state.page = 1;
        load();
      };
      body.appendChild(chip);
    }

    el.appendChild(head);
    el.appendChild(body);
    box.appendChild(el);
  }
  applyFiltersOpen();
  updateFilterSummary();
}

function updateFilterSummary() {
  const n = selectedCount();
  $('filterSummary').textContent = n ? `${tr('filters')} (${n})` : tr('filters');
}

function applyFiltersOpen() {
  $('filterGroups').classList.toggle('hidden', !state.filtersOpen);
  $('filterToggle').classList.toggle('closed', !state.filtersOpen);
}

async function loadFilters() {
  try {
    const data = await api('/api/filters');
    state.filterGroups = data.groups || [];
    renderFilters();
  } catch (e) {
    $('filterGroups').innerHTML = `<p class="status err">${esc(e.message)}</p>`;
  }
}

// ---------------- 列表 ----------------
function skeleton(n) {
  const grid = $('grid');
  grid.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const c = document.createElement('div');
    c.className = 'card';
    c.innerHTML = '<div class="thumb"></div><div class="card-body"><div class="card-title">…</div><div class="card-meta"><span></span><span></span></div></div>';
    grid.appendChild(c);
  }
}

function renderItems(items) {
  const grid = $('grid');
  grid.innerHTML = '';
  if (!items.length) {
    grid.innerHTML = `<p class="status err">${esc(tr('empty'))}</p>`;
    return;
  }
  for (const it of items) {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.id = it.id;
    const img = it.preview
      ? `<img class="thumb" src="${esc(it.preview)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">`
      : '<div class="thumb"></div>';
    card.innerHTML = `${img}
      <label class="pick" title="选择">
        <input type="checkbox" ${state.picked.has(String(it.id)) ? 'checked' : ''} aria-label="选择" />
      </label>
      <div class="card-body">
        <div class="card-title">${esc(it.title || it.id)}</div>
        <div class="card-meta"><span>${esc((it.tags || []).slice(0, 2).map(tagLabel).join(' · ') || '—')}</span><span>${human(it.fileSize)}</span></div>
      </div>`;
    if (state.picked.has(String(it.id))) card.classList.add('selected');
    const box = card.querySelector('input[type=checkbox]');
    box.onclick = (ev) => {
      ev.stopPropagation();
      togglePick(it, box.checked);
    };
    card.onclick = () => openDetail(it.id, it);
    grid.appendChild(card);
  }
  updateBatchBar();
}

function togglePick(it, on) {
  const id = String(it.id);
  if (on) state.picked.set(id, it);
  else state.picked.delete(id);
  const card = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
  if (card) card.classList.toggle('selected', on);
  updateBatchBar();
}

function updateBatchBar() {
  const bar = $('batchBar');
  if (!bar) return;
  const n = state.picked.size;
  bar.classList.toggle('hidden', n === 0);
  $('batchCount').textContent = tr('pickedN', { n });
}

/** 批量下载：逐条提交到下载中心，队列由下载中心限流（最多 3 条同时跑） */
async function startBatch() {
  if (state.batchBusy) return;
  const items = [...state.picked.values()];
  if (!items.length) {
    $('status').textContent = tr('batchNone');
    return;
  }
  if (!state.loggedIn) {
    openSettings();
    $('loginHint').textContent = tr('notLogged');
    return;
  }
  if (!confirm(tr('batchConfirm', { n: items.length }))) return;
  state.batchBusy = true;
  $('batchStart').disabled = true;
  const preset = ($('batchQuality') || {}).value || (state.device ? state.device.preset : 'high');
  let ok = 0;
  const errors = [];
  for (const it of items) {
    try {
      await api('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: it.id,
          title: it.title,
          raw: state.rawOnly,
          preset,
          preserveAudio: !!($('d-audio') && $('d-audio').checked),
        }),
      });
      ok++;
    } catch (e) {
      errors.push(`${it.title || it.id}: ${e.message}`);
    }
  }
  state.batchBusy = false;
  $('batchStart').disabled = false;
  state.picked.clear();
  document.querySelectorAll('.card').forEach((c) => {
    c.classList.remove('selected');
    const b = c.querySelector('input[type=checkbox]');
    if (b) b.checked = false;
  });
  updateBatchBar();
  if (window.WE_DLC) window.WE_DLC.notifyJobAdded();
  if (errors.length) {
    $('status').className = 'status err';
    $('status').textContent = tr('batchFail') + errors.join('；');
  } else {
    $('status').className = 'status';
    $('status').textContent = tr('batchQueued', { n: ok });
  }
}

async function load() {
  const st = $('status');
  st.className = 'status';
  state.statusText = tr('loading');
  st.textContent = state.statusText;
  skeleton(window.innerWidth <= 640 ? 6 : 8);
  try {
    const params = new URLSearchParams({
      page: state.page,
      perPage: state.perPage,
      pages: state.pages,
      sort: state.sort,
      search: state.search,
    });
    // 分组后的筛选条件：组内「或」、组间「与」由后端按组合展开
    const groups = selectedGroups();
    if (groups.length) params.set('groups', JSON.stringify(groups));
    // 时间窗只对「热门趋势」有意义
    if (state.sort === 'trend' && state.days) params.set('days', state.days);
    const data = await api('/api/browse?' + params.toString());
    state.total = data.total || 0;
    renderItems(data.items || []);
    const backend = data.backend === 'api' ? tr('backendApi') : tr('backendHtml');
    const deep = (data.pagesFetched || 1) > 1;
    state.statusText = (deep
      ? tr('totalDeep', {
        n: state.total.toLocaleString(), a: data.pageStart || state.page,
        b: data.pageEnd || (state.page + state.pages - 1), m: (data.items || []).length, c: backend,
      })
      : tr('total', { n: state.total.toLocaleString(), p: state.page, b: backend }))
      // 让用户一眼看出这次抓到的是「你账号的范围」还是「匿名范围」
      + (data.scope ? (data.scope === 'account' ? tr('scopeAccount') : tr('scopeAnon'))
        : (state.webLogin && state.webLogin.loggedIn ? tr('scopeAccount') : tr('scopeAnon')))
      + (data.warning ? ' · ' + data.warning : '');
    st.textContent = state.statusText;
    if (data.warning) st.className = 'status err';
    $('pageinfo').textContent = tr('pageN', { p: state.page });
    $('prev').disabled = state.page <= 1;
    $('next').disabled = (data.items || []).length < state.perPage;
  } catch (e) {
    st.className = 'status err';
    // 国内网络下创意工坊页面/接口经常直接被墙，明确提示先开加速器
    st.innerHTML = esc(tr('failed') + e.message)
      + '<br><span class="hint">' + esc(tr('vpnHint')) + '</span>';
    state.statusText = tr('failed') + e.message;
  }
}

async function checkUpdate() {
  const hint = $('updateHint');
  const link = $('updateLink');
  hint.textContent = tr('updateChecking');
  try {
    const d = await api('/api/update/check?force=1');
    if (d.error) throw new Error(d.error);
    if (d.hasUpdate) {
      hint.textContent = tr('updateFound', { v: d.latest, c: d.current });
      if (d.release && d.release.url) {
        link.href = d.release.url;
        link.classList.remove('hidden');
      }
    } else {
      hint.textContent = tr('updateLatest', { v: d.current });
      link.classList.add('hidden');
    }
  } catch (e) {
    hint.textContent = tr('updateFail') + e.message;
  }
}

// ---------------- 设备画像 / 画质推荐 ----------------
function detectDevice() {
  const memGB = Number(navigator.deviceMemory || 0);
  const cores = Number(navigator.hardwareConcurrency || 0);
  let renderer = '';
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) || '');
      gl.getExtension('WEBGL_lose_context') && gl.getExtension('WEBGL_lose_context').loseContext();
    }
  } catch { /* ignore */ }

  let preset = 'high';
  let why = '配置看起来够用';
  if (/Mali-4|Mali-T[0-7]|Adreno [23]\d\d|Intel.*HD Graphics [3-6]\d\d|PowerVR (SGX|G6)/i.test(renderer)) {
    preset = 'smooth'; why = 'GPU 偏老，优先流畅';
  } else if ((memGB && memGB <= 4) || (cores && cores <= 4)) {
    preset = 'smooth'; why = '内存/核心数偏少';
  } else if ((memGB && memGB < 8) || /Mali-G[0-9]{2}|Adreno 5\d\d|Adreno 6[0-4]\d/i.test(renderer)) {
    preset = 'balanced'; why = '中端配置，均衡更稳';
  }
  const memText = memGB ? `${memGB} GB 内存` : (cores ? `${cores} 核` : '配置未知');
  return { preset, label: QUALITY_LABEL[preset] || preset, renderer, memGB, cores, why, desc: `${memText}${renderer ? ' · ' + renderer : ''}` };
}

const QUALITY_LABEL = { high: '高画质', balanced: '均衡', smooth: '流畅' };

function applyDeviceHint() {
  if (!state.device) state.device = detectDevice();
  const hint = $('d-device');
  if (!hint) return;
  hint.textContent = tr('deviceRec', { q: QUALITY_LABEL[state.device.preset] || state.device.preset, d: state.device.desc });
  hint.title = tr('deviceHint');
  const sel = $('d-quality');
  const override = localStorage.getItem('qualityOverride');
  if (sel) {
    if (override) sel.value = override;
    else sel.value = state.device.preset;
  }
}

function renderCompat(c) {
  const el = $('d-compat');
  if (!el || !c) return;
  el.classList.remove('hidden', 'ok', 'warn', 'bad');
  el.classList.add(c.level === 'bad' ? 'bad' : (c.level === 'warn' ? 'warn' : 'ok'));
  const head = c.level === 'bad' ? tr('compatBad') : (c.level === 'warn' ? tr('compatWarn') : tr('compatOk'));
  const t = c.textures || {};
  const meta = tr('compatMeta', {
    t: c.type || 'unknown', n: t.files || 0, v: t.video || 0,
    m: t.estimatedRgbaMB || 0, s: c.totalText || '',
  });
  const warn = (c.warnings || []).map((w) => `<li>⚠ ${esc(w)}</li>`).join('');
  const note = (c.notes || []).map((w) => `<li>· ${esc(w)}</li>`).join('');
  el.innerHTML = `<h4>${esc(tr('compatTitle'))} · ${esc(head)}</h4>
    <div class="meta">${esc(meta)}</div>
    ${warn || note ? `<ul>${warn}${note}</ul>` : ''}`;
}

// ---------------- 详情 ----------------
function setDownloadLabel() {
  const btn = $('d-download');
  if (!state.canDownload) {
    btn.disabled = true;
    btn.textContent = tr('noDownload');
    return;
  }
  // 能下载但没登录：按钮仍然可点，点了直接引导去登录
  btn.disabled = false;
  btn.textContent = state.loggedIn ? tr('downloadPack') : tr('needLogin');
}

function openDetail(id, seed) {
  state.current = { id, seed };
  $('drawer').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  $('d-title').textContent = seed.title || id;
  $('d-preview').src = seed.preview || '';
  $('d-meta').textContent = `${human(seed.fileSize)} · ${seed.subscriptions || 0}`;
  $('d-tags').innerHTML = (seed.tags || []).map((t) => `<span class="chip">${esc(tagLabel(t))}</span>`).join('');
  $('d-desc').textContent = seed.description || '';
  $('d-open').href = `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`;
  $('d-progress').classList.add('hidden');
  $('p-file').classList.add('hidden');
  $('p-log').textContent = '';
  if ($('d-compat')) $('d-compat').classList.add('hidden');
  setDownloadLabel();
  applyDeviceHint();

  api('/api/item?id=' + encodeURIComponent(id)).then((d) => {
    if (!state.current || state.current.id !== id) return;
    $('d-title').textContent = d.title || id;
    if (d.preview) $('d-preview').src = d.preview;
    $('d-meta').textContent = `${human(d.fileSize)} · ${d.subscriptions || 0} · ${dateStr(d.timeUpdated)}${d.author ? ' · ' + d.author : ''}`;
    $('d-tags').innerHTML = (d.tags || []).map((t) => `<span class="chip">${esc(tagLabel(t))}</span>`).join('');
    $('d-desc').textContent = d.description || '';
  }).catch(() => { /* 保留卡片信息 */ });
}

function closeDetail() {
  $('drawer').classList.add('hidden');
  document.body.style.overflow = '';
  if (state.poll) clearTimeout(state.poll);
}

/** 安卓返回键：先关抽屉/弹窗，返回 true 表示已在页面内消费掉这次返回 */
window.__androidBack = function () {
  const modal = $('modal');
  if (modal && !modal.classList.contains('hidden')) {
    modal.classList.add('hidden');
    if (state.loginPoll) clearTimeout(state.loginPoll);
    return true;
  }
  const drawer = $('drawer');
  if (drawer && !drawer.classList.contains('hidden')) {
    closeDetail();
    return true;
  }
  return false;
};

async function startDownload() {
  const cur = state.current;
  if (!cur) return;
  if (!state.loggedIn) {
    // 没登录就直接把用户带去登录，不要先建一个必然失败的任务
    openSettings();
    $('loginHint').textContent = tr('notLogged');
    return;
  }
  const btn = $('d-download');
  btn.disabled = true;
  $('d-progress').classList.remove('hidden');
  $('p-file').classList.add('hidden');
  $('p-state').textContent = '…';
  $('p-log').textContent = '';
  if ($('p-bar')) $('p-bar').style.width = '0%';
  if ($('p-sub')) $('p-sub').textContent = '';
  if ($('p-cancel')) $('p-cancel').classList.remove('hidden');

  try {
    const { jobId } = await api('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: cur.id,
        title: cur.seed.title,
        raw: state.rawOnly,
        preset: ($('d-quality') || {}).value || 'high',
        preserveAudio: !!($('d-audio') && $('d-audio').checked),
      }),
    });
    // 任务跑在独立进程（下载中心）里：网页关掉也会继续下，进度在浮层里看
    $('p-log').textContent = `已加入下载中心（${tr('hubHint')}）`;
    if (window.WE_DLC) window.WE_DLC.notifyJobAdded();
    pollJob(jobId);
  } catch (e) {
    $('p-state').textContent = '✘ ' + e.message;
    btn.disabled = false;
  }
}

/** 安卓外壳里点了「保存 .mpkg」其实什么都发生不了（WebView 没有下载监听），
 *  所以原生桥在的时候改成「导入壁纸引擎」，直接把成品路径交给 App 拉起 WE。 */
function androidBridge() {
  if (window.Android && typeof window.Android.openMpkg === 'function') return window.Android;
  return null;
}

function showResultAction(jobId, result, job) {
  const el = $('p-file');
  // 优先用任务顶层的 outPath，再退回 result 里的（两个接口字段都要能认）
  const wepath = (job && job.outPath) || (result && result.outPath);
  if (androidBridge() && wepath) {
    // 原生直接拿绝对路径，用 content:// 授权给壁纸引擎，不需要走网页下载
    el.removeAttribute('href');
    el.dataset.action = 'import';
    delete el.dataset.i18n;   // 免得切换语言时被 applyLang 改回「保存 .mpkg」
    el.textContent = tr('importWe');
    el.onclick = (ev) => {
      ev.preventDefault();
      try {
        const msg = androidBridge().openMpkg(wepath);
        $('p-log').textContent += '\n' + (msg || '正在打开壁纸引擎…');
      } catch (e) {
        $('p-log').textContent += '\n✘ 拉起壁纸引擎失败: ' + e.message;
      }
    };
  } else {
    el.dataset.action = 'save';
    el.dataset.i18n = 'saveMpkg';
    el.textContent = tr('saveMpkg');
    el.href = '/api/file/' + jobId;
    el.onclick = null;
  }
  el.classList.remove('hidden');
}

// 任务阶段文案（下载中心返回的 phase）
const PHASE_LABEL = { prepare: '解包检查', download: '下载', convert: '纹理转换', shader: '着色器适配', reference: '替换资源', write: '写入 mpkg', done: '完成' };

/** 把下载中心的进度写进详情页的进度条 */
function applyProgress(job) {
  const p = job.progress || {};
  const bar = $('p-bar');
  const wrap = bar ? bar.parentElement : null;
  const running = job.state === 'downloading' || job.state === 'packing' || job.state === 'queued';
  const percent = job.state === 'done' ? 100 : (p.percent === undefined ? null : p.percent);
  if (wrap) {
    wrap.classList.toggle('indeterminate', percent === null && running);
    bar.style.width = percent === null ? '' : `${Math.max(1, Math.min(100, percent))}%`;
  }
  const stateText = { queued: '排队中', downloading: '下载中', packing: '打包中', done: '完成', failed: '失败', cancelled: '已取消' }[job.state] || job.state;
  $('p-state').textContent = stateText + (job.state === 'done' ? ' ✔' : '');
  const late = PHASE_LABEL[p.phase] ? ` · ${PHASE_LABEL[p.phase]}` : '';
  const parts = [];
  if (p.total) parts.push(`${human(p.bytes || 0)} / ${human(p.total)}`);
  if (running && p.speed) parts.push(`${human(p.speed)}/s`);
  if (running && p.eta) parts.push(`剩 ${p.eta}s`);
  if (p.phase === 'convert' && p.total) parts.push(`${p.done || 0}/${p.total} 张`);
  const sub = $('p-sub');
  if (sub) sub.textContent = (percent === null ? '' : `${percent}%`) + (parts.length ? `  ${parts.join(' · ')}` : '');
  $('p-note').textContent = (p.detail || '') + late;
  if (p.compat) renderCompat(p.compat);
  const cancel = $('p-cancel');
  if (cancel) cancel.classList.toggle('hidden', !running);
}

function pollJob(jobId) {
  if (state.poll) clearTimeout(state.poll);
  state.currentJob = jobId;
  const tick = async () => {
    try {
      const job = await api('/api/jobs/' + jobId);
      if (state.currentJob !== jobId) return;
      applyProgress(job);
      const log = $('p-log');
      const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
      log.textContent = (job.log || []).join('\n');
      if (atBottom) log.scrollTop = log.scrollHeight;

      if (job.state === 'done') {
        const r = job.result || {};
        if (r.compat) renderCompat(r.compat);
        if (r.raw) {
          // 只下载模式：不产出 mpkg，直接把原始文件目录告诉用户（scene.pkg / mp4 原样保留）
          $('p-note').textContent = r.rawDir || '';
          $('p-log').textContent += '\n\n原始文件已保存在上面的目录里（未打包）。';
        } else {
          showResultAction(jobId, r, job);
        }
        setDownloadLabel();
        $('p-cancel').classList.add('hidden');
        if (job.result && job.result.warnings && job.result.warnings.length) {
          $('p-log').textContent += '\n\n⚠ ' + job.result.warnings.join('\n⚠ ');
        }
        return;
      }
      if (job.state === 'failed' || job.state === 'cancelled') {
        $('p-note').textContent = job.error || '已取消';
        setDownloadLabel();
        $('p-cancel').classList.add('hidden');
        return;
      }
      state.poll = setTimeout(tick, 900);
    } catch (e) {
      state.poll = setTimeout(tick, 1500);
    }
  };
  tick();
}

/** 取消按钮：只发请求，实际停在下个阶段边界（下载缓存保留，可续传） */
async function cancelCurrentJob() {
  const id = state.currentJob;
  if (!id) return;
  try {
    await api('/api/jobs/' + id + '/cancel', { method: 'POST' });
  } catch (e) {
    $('p-note').textContent = '取消失败：' + e.message;
  }
}

// ---------------- 设置 / 登录 ----------------
async function openSettings() {
  $('modal').classList.remove('hidden');
  // 安卓壳里才有「回启动页」入口（本地/远程、导入凭据都在那边）
  const hasSetup = !!(window.Android && typeof window.Android.openSetup === 'function');
  if ($('setupRow')) $('setupRow').classList.toggle('hidden', !hasSetup);
  if ($('setupHint')) $('setupHint').classList.toggle('hidden', !hasSetup);
  try {
    const s = await api('/api/settings');
    $('outputDir').value = s.outputDir || '';
    $('outputDir').dataset.default = s.defaultOutputDir || '';
    $('loginAccount').value = s.accountName || '';
    $('dirHint').textContent = tr('dirDefault', { d: s.defaultOutputDir });
    $('loginHint').textContent = s.accountName ? tr('loginDone', { a: s.accountName }) : tr('loginIdle');
    if ($('proxyInput')) {
      $('proxyInput').value = s.proxy || '';
      $('proxyInput').placeholder = s.defaultProxy || 'http://127.0.0.1:7890';
      $('proxyHint').textContent = s.proxy
        ? tr('proxySaved', { p: s.proxy })
        : (s.defaultProxy ? tr('proxyDefault', { p: s.defaultProxy }) : tr('proxyNone'));
    }
  } catch (e) {
    $('dirHint').textContent = e.message;
  }
  loadCdnNodes();
}

/** 调起系统目录选择器（安卓端），选完由原生回填 __folderPicked */
function pickFolder() {
  if (window.Android && typeof window.Android.pickFolder === 'function') {
    $('dirHint').textContent = '…';
    try {
      window.Android.pickFolder();
    } catch (e) {
      $('dirHint').textContent = tr('pickFail') + ' ' + e.message;
    }
    return;
  }
  $('dirHint').textContent = tr('pickUnsupported');
}

// 原生选择器回调：拿到真实文件系统路径后回填并直接保存
window.__folderPicked = function (path) {
  if (!path) {
    $('dirHint').textContent = tr('pickFail');
    return;
  }
  $('outputDir').value = path;
  $('dirHint').textContent = tr('pickDone', { d: path });
  saveDir();
};

async function saveDir() {  try {
    const r = await api('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outputDir: $('outputDir').value.trim() }),
    });
    $('dirHint').textContent = tr('dirSaved', { d: r.outputDir });
    $('cfg').textContent = '→ ' + r.outputDir;
  } catch (e) {
    $('dirHint').textContent = tr('dirFail') + e.message;
  }
}

async function saveProxy() {
  const v = $('proxyInput').value.trim();
  try {
    const r = await api('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proxy: v }),
    });
    $('proxyInput').value = r.proxy || '';
    $('proxyHint').textContent = r.proxy ? tr('proxySaved', { p: r.proxy }) : tr('proxyCleared');
  } catch (e) {
    $('proxyHint').textContent = tr('proxyFail') + e.message;
  }
}

async function testProxyConn() {
  $('proxyHint').textContent = tr('proxyTesting');
  try {
    const r = await api('/api/proxy/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proxy: $('proxyInput').value.trim() }),
    });
    $('proxyHint').textContent = r.ok
      ? tr('proxyOk', { s: r.status, m: r.ms })
      : tr('proxyFail') + (r.error || '');
  } catch (e) {
    $('proxyHint').textContent = tr('proxyFail') + e.message;
  }
}

async function resetProxy() {
  $('proxyInput').value = '';
  await saveProxy();
}

// ---------------- CDN 节点测速 ----------------
const CDN_REGION_LABEL = {
  cn: '国内', hk: '香港', tw: '台湾', jp: '日本', kr: '韩国', sg: '新加坡',
  us: '美国', de: '德国', gb: '英国', fr: '法国', nl: '荷兰', au: '澳洲', br: '巴西',
};

function cdnTag(s) {
  if (s.domestic) return CDN_REGION_LABEL.cn;
  if (s.region && CDN_REGION_LABEL[s.region]) return CDN_REGION_LABEL[s.region];
  if (s.provider === 'akamai') return 'Akamai';
  if (s.provider === 'fastly') return 'Fastly';
  if (s.provider === 'google') return 'Google';
  return s.provider || '—';
}

function cdnTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())} ${p(d.getMonth() + 1)}/${p(d.getDate())}`;
}

function renderCdn(data) {
  const list = $('cdnList');
  if (!list) return;
  const servers = (data && data.servers) || [];
  if (!servers.length) {
    list.innerHTML = `<div class="cdn-empty">${esc(tr('cdnEmpty'))}</div>`;
  } else {
    list.innerHTML = servers.map((s) => `<div class="cdn-row${s.ok ? '' : ' bad'}">
  <span class="cdn-host">${esc(s.host || '')}</span>
  <span class="cdn-tag">${esc(cdnTag(s))}</span>
  <span class="cdn-ms">${s.ok ? `${s.latencyMs} ms` : '✘'}</span>
</div>`).join('');
  }
  const geo = $('cdnGeo');
  if (geo) {
    const g = (data && data.geo) || {};
    geo.textContent = servers.length
      ? `${tr('cdnGeo', { c: g.region || g.country || g.countryCode || '—' })} · ${tr('cdnRanked', { n: servers.filter((s) => s.ok).length, t: cdnTime(data.testedAt) })}`
      : '';
  }
  const btn = $('cdnTest');
  if (btn) {
    btn.disabled = !!(data && data.state === 'running');
    btn.textContent = data && data.state === 'running' ? tr('cdnTesting') : tr('cdnTest');
  }
}

async function loadCdnNodes() {
  try {
    renderCdn(await api('/api/cdn/nodes'));
  } catch (e) {
    const g = $('cdnGeo');
    if (g) g.textContent = tr('cdnFail') + e.message;
  }
}

async function testCdnNodes() {
  const btn = $('cdnTest');
  const geo = $('cdnGeo');
  if (btn) { btn.disabled = true; btn.textContent = tr('cdnTesting'); }
  if (geo) geo.textContent = tr('cdnTesting');
  try {
    const r = await api('/api/cdn/test', { method: 'POST' });
    if (!r.ok) throw new Error(r.error || 'failed');
    renderCdn(r);
  } catch (e) {
    if (geo) geo.textContent = tr('cdnFail') + e.message;
  }
}

function openExternal(url) {  if (window.Android && typeof window.Android.openExternal === 'function') {
    window.Android.openExternal(url);
    return true;
  }
  window.open(url, '_blank');
  return false;
}

async function startLogin() {
  const accountName = $('loginAccount').value.trim();
  const password = $('loginPass').value;
  if (!accountName || !password) {
    $('loginHint').textContent = '请填写账号和密码';
    return;
  }
  $('loginHint').textContent = '…';
  $('codeRow').classList.add('hidden');
  try {
    const r = await api('/api/login/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountName, password }),
    });
    if (!r.ok) {
      $('loginHint').textContent = tr('loginFailed') + (r.error || '');
      return;
    }
    // 密码只用于这一次登录，不在页面里留着
    $('loginPass').value = '';
    if (r.state === 'needCode') {
      $('codeRow').classList.remove('hidden');
      $('loginHint').textContent = tr('needCode') + (r.codeType ? ` (${r.codeType})` : '');
    } else {
      $('loginHint').textContent = tr('loginWaiting');
    }
    pollLogin();
  } catch (e) {
    $('loginHint').textContent = tr('loginFailed') + e.message;
  }
}

async function submitCode() {
  const code = $('guardCode').value.trim();
  if (!code) return;
  try {
    const r = await api('/api/login/code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (r.ok) {
      $('guardCode').value = '';
      $('codeRow').classList.add('hidden');
      $('loginHint').textContent = tr('loginWaiting');
    } else {
      $('loginHint').textContent = tr('loginFailed') + (r.error || '');
    }
  } catch (e) {
    $('loginHint').textContent = tr('loginFailed') + e.message;
  }
}

function pollLogin() {
  if (state.loginPoll) clearTimeout(state.loginPoll);
  const tick = async () => {
    try {
      const s = await api('/api/login/status');
      if (s.state === 'done') {
        $('loginHint').textContent = tr('loginDone', { a: s.accountName || '?' });
        $('loginAccount').value = s.accountName || '';
        state.canDownload = true;
        state.loggedIn = true;
        setDownloadLabel();
        api('/api/config').then((cfg) => {
          $('cfg').textContent = `${cfg.engine} · ${cfg.outputDir}`;
        }).catch(() => {});
        return;
      }
      if (s.state === 'needCode') {
        $('codeRow').classList.remove('hidden');
        $('loginHint').textContent = tr('needCode');
        state.loginPoll = setTimeout(tick, 3000);
        return;
      }
      if (s.state === 'failed') {
        $('loginHint').textContent = tr('loginFailed') + (s.error || '');
        return;
      }
      state.loginPoll = setTimeout(tick, 2000);
    } catch (e) {
      state.loginPoll = setTimeout(tick, 3000);
    }
  };
  tick();
}

async function logout() {
  await api('/api/logout', { method: 'POST' });
  $('loginAccount').value = '';
  $('loginHint').textContent = tr('loginIdle');
}

// ---------------- 事件绑定 ----------------
/** 时间窗选择只在「热门趋势」下有意义 */
function toggleDays() {
  const wrap = $('daysWrap');
  if (wrap) wrap.classList.toggle('hidden', state.sort !== 'trend');
}

function wire() {
  $('go').onclick = () => { state.search = $('search').value.trim(); state.page = 1; load(); };
  $('search').addEventListener('keydown', (e) => { if (e.key === 'Enter') { $('search').blur(); $('go').click(); } });
  $('sort').onchange = (e) => {
    state.sort = e.target.value;
    state.page = 1;
    toggleDays();
    load();
  };
  $('depth').onchange = (e) => {
    state.pages = parseInt(e.target.value, 10) || 1;
    localStorage.setItem('depth', String(state.pages));
    state.page = 1;
    load();
  };
  $('days').onchange = (e) => {
    state.days = parseInt(e.target.value, 10) || 7;
    localStorage.setItem('days', String(state.days));
    state.page = 1;
    load();
  };
  $('prev').onclick = () => { if (state.page > 1) { state.page = Math.max(1, state.page - state.pages); load(); } };
  $('next').onclick = () => { state.page += state.pages; load(); };
  $('close').onclick = closeDetail;
  $('d-download').onclick = startDownload;
  if ($('batchStart')) $('batchStart').onclick = startBatch;
  if ($('batchClear')) $('batchClear').onclick = () => {
    state.picked.clear();
    document.querySelectorAll('.card').forEach((c) => {
      c.classList.remove('selected');
      const b = c.querySelector('input[type=checkbox]');
      if (b) b.checked = false;
    });
    updateBatchBar();
  };
  if ($('d-quality')) $('d-quality').onchange = (e) => localStorage.setItem('qualityOverride', e.target.value);
  if ($('p-cancel')) $('p-cancel').onclick = cancelCurrentJob;
  // 下载中心改成页内浮层：不跳页、不重载主界面
  const openDlCenter = () => { if (window.WE_DLC) window.WE_DLC.open(); };
  if ($('hubBtn')) $('hubBtn').onclick = openDlCenter;
  if ($('p-hub')) $('p-hub').onclick = openDlCenter;
  $('filterToggle').onclick = () => {
    state.filtersOpen = !state.filtersOpen;
    applyFiltersOpen();
  };
  $('clearFilters').onclick = () => {
    state.sel = {};
    renderFilters();
    state.page = 1;
    load();
  };
  $('langBtn').onclick = () => {
    state.lang = state.lang === 'zh' ? 'en' : 'zh';
    localStorage.setItem('lang', state.lang);
    applyLang();
  };
  $('settingsBtn').onclick = openSettings;
  if ($('openSetupBtn')) {
    $('openSetupBtn').onclick = () => {
      if (window.Android && typeof window.Android.openSetup === 'function') {
        $('modal').classList.add('hidden');
        window.Android.openSetup();
      }
    };
  }
  $('modalClose').onclick = () => {
    $('modal').classList.add('hidden');
    if (state.loginPoll) clearTimeout(state.loginPoll);
  };
  $('saveDir').onclick = saveDir;
  if ($('saveProxy')) $('saveProxy').onclick = saveProxy;
  if ($('testProxy')) $('testProxy').onclick = testProxyConn;
  if ($('resetProxy')) $('resetProxy').onclick = resetProxy;
  if ($('checkUpdate')) $('checkUpdate').onclick = checkUpdate;
  if ($('cdnTest')) $('cdnTest').onclick = testCdnNodes;
  if ($('pickDir')) $('pickDir').onclick = pickFolder;
  $('rawOnly').checked = state.rawOnly;
  $('rawOnly').onchange = (e) => {
    state.rawOnly = !!e.target.checked;
    localStorage.setItem('rawOnly', state.rawOnly ? '1' : '0');
  };
  $('resetDir').onclick = async () => {
    const d = $('outputDir').dataset.default;
    if (!d) return;
    $('outputDir').value = d;
    await saveDir();
  };
  $('loginBtn').onclick = startLogin;
  $('codeBtn').onclick = submitCode;
  $('logoutBtn').onclick = logout;
  $('exitApp').onclick = async () => {
    if (!confirm(tr('exitConfirm'))) return;
    $('exitHint').textContent = '…';
    try {
      await fetch('/api/shutdown', { method: 'POST' });
      $('exitHint').textContent = tr('exitDone');
      $('d-download').disabled = true;
    } catch (e) {
      $('exitHint').textContent = e.message;
    }
  };

  // 点击遮罩关闭
  $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) $('modal').classList.add('hidden'); });

  // 手机：下拉返回键 / 侧滑关闭抽屉
  window.addEventListener('popstate', () => { if (!$('drawer').classList.contains('hidden')) closeDetail(); });
  let touchY = null;
  $('drawer').addEventListener('touchstart', (e) => {
    if ($('drawer').querySelector('.drawer-body').scrollTop <= 0) touchY = e.touches[0].clientY;
  }, { passive: true });
  $('drawer').addEventListener('touchend', (e) => {
    if (touchY != null && e.changedTouches[0].clientY - touchY > 90) closeDetail();
    touchY = null;
  }, { passive: true });
}

async function init() {
  state.lang = localStorage.getItem('lang') || (/^zh/i.test(navigator.language || '') ? 'zh' : 'en');
  state.rawOnly = localStorage.getItem('rawOnly') === '1';
  state.filtersOpen = window.innerWidth > 640;
  wire();
  applyLang();
  watchStickyLayout();
  state.device = detectDevice();
  // 恢复上次的抓取深度与时间窗
  state.pages = Math.max(1, Math.min(5, parseInt(localStorage.getItem('depth') || '1', 10) || 1));
  state.days = parseInt(localStorage.getItem('days') || '7', 10) || 7;
  if ($('depth')) $('depth').value = String(state.pages);
  if ($('days')) $('days').value = String(state.days);
  toggleDays();
  try {
    const cfg = await api('/api/config');
    state.canDownload = cfg.canDownload !== false;
    state.canDownloadReason = cfg.canDownloadReason || '';
    state.loggedIn = !!cfg.loggedIn;
    state.webLogin = cfg.webLogin || null;
    $('cfg').textContent = state.loggedIn
      ? `${cfg.engine} · ${cfg.outputDir}`
      : tr('notLogged');
    if (!state.canDownload) {
      $('cfg').textContent = '⚠ ' + cfg.platform + ' — ' + state.canDownloadReason;
    }
    setDownloadLabel();
  } catch (e) {
    $('cfg').textContent = e.message;
  }
  setDownloadLabel();
  load();
  loadFilters();
}

init();
