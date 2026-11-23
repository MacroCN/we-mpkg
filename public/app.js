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
    quality: '画质', qHigh: '高画质（原尺寸）', qBalanced: '均衡（1/2 尺寸）', qSmooth: '流畅（1/4 尺寸）',
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
    loginWaiting: '已打开 Steam，请在 Steam App 里确认登录…',
    loginDone: '已登录：{a}', loginFailed: '登录失败：', loginIdle: '未登录（可先用电脑导入凭据）',
    groupMisc: '其他特性', groupType: '类型', groupAge: '年龄分级', groupGenre: '题材',
    groupRes: '分辨率', groupCategory: '分类', groupAssetType: '素材类型',
    groupAssetGenre: '素材题材', groupScript: '脚本类型',
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
    quality: 'Quality', qHigh: 'High (native size)', qBalanced: 'Balanced (1/2)', qSmooth: 'Smooth (1/4)',
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
    loginWaiting: 'Waiting for confirmation in the Steam app…',
    loginDone: 'Signed in: {a}', loginFailed: 'Login failed: ', loginIdle: 'Not signed in', logout: 'Sign out',    groupMisc: 'Miscellaneous', groupType: 'Type', groupAge: 'Age Rating', groupGenre: 'Genre',
    groupRes: 'Resolution', groupCategory: 'Category', groupAssetType: 'Asset Type',
    groupAssetGenre: 'Asset Genre', groupScript: 'Script Type',
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
};

const $ = (id) => document.getElementById(id);

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
    const img = it.preview
      ? `<img class="thumb" src="${esc(it.preview)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">`
      : '<div class="thumb"></div>';
    card.innerHTML = `${img}
      <div class="card-body">
        <div class="card-title">${esc(it.title || it.id)}</div>
        <div class="card-meta"><span>${esc((it.tags || []).slice(0, 2).map(tagLabel).join(' · ') || '—')}</span><span>${human(it.fileSize)}</span></div>
      </div>`;
    card.onclick = () => openDetail(it.id, it);
    grid.appendChild(card);
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
  setDownloadLabel();

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

function showResultAction(jobId, result) {
  const el = $('p-file');
  const wepath = result && result.outPath;
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

function pollJob(jobId) {
  if (state.poll) clearTimeout(state.poll);
  const tick = async () => {
    try {
      const job = await api('/api/jobs/' + jobId);
      $('p-state').textContent = job.state + (job.state === 'done' ? ' ✔' : '');
      $('p-note').textContent = job.result ? `${human(job.result.size)} · ${job.result.type}` : '';
      const log = $('p-log');
      const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
      log.textContent = (job.log || []).join('\n');
      if (atBottom) log.scrollTop = log.scrollHeight;

      if (job.state === 'done') {
        const r = job.result || {};
        if (r.raw) {
          // 只下载模式：不产出 mpkg，直接把原始文件目录告诉用户（scene.pkg / mp4 原样保留）
          $('p-note').textContent = r.rawDir || '';
          $('p-log').textContent += '\n\n原始文件已保存在上面的目录里（未打包）。';
        } else {
          showResultAction(jobId, r);
        }
        setDownloadLabel();
        if (job.result && job.result.warnings && job.result.warnings.length) {
          $('p-log').textContent += '\n\n⚠ ' + job.result.warnings.join('\n⚠ ');
        }
        return;
      }
      if (job.state === 'failed') {
        $('p-note').textContent = job.error || '';
        setDownloadLabel();
        return;
      }
      state.poll = setTimeout(tick, 900);
    } catch (e) {
      state.poll = setTimeout(tick, 1500);
    }
  };
  tick();
}

// ---------------- 设置 / 登录 ----------------
async function openSettings() {
  $('modal').classList.remove('hidden');
  try {
    const s = await api('/api/settings');
    $('outputDir').value = s.outputDir || '';
    $('outputDir').dataset.default = s.defaultOutputDir || '';
    $('loginAccount').value = s.accountName || '';
    $('dirHint').textContent = tr('dirDefault', { d: s.defaultOutputDir });
    $('loginHint').textContent = s.accountName ? tr('loginDone', { a: s.accountName }) : tr('loginIdle');
  } catch (e) {
    $('dirHint').textContent = e.message;
  }
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

function openExternal(url) {
  if (window.Android && typeof window.Android.openExternal === 'function') {
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
  $('modalClose').onclick = () => {
    $('modal').classList.add('hidden');
    if (state.loginPoll) clearTimeout(state.loginPoll);
  };
  $('saveDir').onclick = saveDir;
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
