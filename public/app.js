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
    rawDownload: '下载原始资源',
    rawDownloadTip: '不打包 mpkg：video / 场景 / 网页都直接导出原始资源并压成 zip（场景先解包 scene.pkg，网页附带触屏适配与 PWA），原始音频原样保留',
    rawDownloadBtn: '下载原始资源（打包 zip）',
    saveRaw: '保存原始资源 .zip', openFile: '打开文件',
    webNoMpkg: 'Web 类型不支持下载 MPKG（勾选「下载原始资源」可导出网页）',
    needLogin: '先登录再下载', notLogged: '未登录，点右上角 ⚙ 登录',
    hub: '下载中心', openHub: '在下载中心查看（独立进程，关页面也不中断）', cancelTask: '取消任务',
    hubHint: '独立进程运行，关掉本页面任务也会继续',
    tabAccount: '账号', tabNetwork: '网络', tabOutput: '输出', tabDisplay: '显示', tabAbout: '关于',
    displayTitle: '界面外观', themeAuto: '跟随系统', themeLight: '浅色', themeDark: '深色',
    themeHint: '只影响这台设备的界面颜色，不影响打包结果。', themeBtn: '当前：{m}，点击切换深浅色',
    outputTip: 'mpkg 和「下载原始资源」的 zip 都存到这里。',
    aboutMeta: 'AppID 431960 · PKGM0020 · 壁纸来源 Wallpaper Engine 创意工坊',
    projectTitle: '项目', projectIssues: '问题反馈 / Issues',
    projectDesc: '开源 MIT 许可。抓取创意工坊 → 纯 JS 分块下载 → 转成安卓可用的 .mpkg；安卓端内置 Node 运行时，离线也能在手机上打包。',
    ptrPull: '下拉刷新', ptrRelease: '松开刷新', ptrBusy: '刷新中…',
    recommended: '推荐', quickAdd: '＋ 加选', quickPicked: '✓ 已选',
    quickDownload: '⬇ 直接下载', quickDownloadTip: '按推荐画质（{q}）直接加入下载中心，不用打开详情',
    quickQueued: '已加入下载中心：{t}（{q}）', quickBusy: '这个条目已有任务在跑',
    typeWeb: '网页', typeVideo: '视频', typeScene: '场景', typeApp: '应用', typeOther: '壁纸',
    typeTip: '类型：{t}',
    openSetup: '启动页：本地 / 远程 / 导入凭据', setupHint: '想切换本地 / 远程服务，或粘贴电脑上的凭据导入，点这个按钮回启动页（页面状态不会丢）。',
    quality: '画质', qHigh: '高画质（原尺寸）', qBalanced: '均衡（1/2 尺寸）', qSmooth: '流畅（1/4 尺寸）',
    pickedN: '已选 {n} 项', batchStart: '打包下载', batchClear: '清空', batchConfirm: '把选中的 {n} 条加入下载中心？',
    batchQueued: '已加入下载中心：{n} 个任务（最多同时跑 3 条）', batchNone: '先勾选要下载的壁纸',
    batchFail: '批量提交失败：',
    deviceRec: '推荐画质：{q}（{d}）', deviceHint: '这个推荐只影响默认值，随时可以自己改',
    compatTitle: '打包前兼容性', compatOk: '兼容性良好', compatWarn: '需注意', compatBad: '大概率黑屏',
    compatMeta: '{t} · 纹理 {n} 张（视频 {v}）· 预计显存 {m} MB · 体积 {s}',
    compatNone: '暂无预检结果（任务开始打包后会显示）',
    updateTitle: '版本更新', updateCheck: '检查更新', updateDownload: '打开下载页', updateDownloadApk: '直接下载 APK',
    updateChecking: '正在检查 GitHub 最新版本…', updateLatest: '已是最新版本（{v}）',
    updateFound: '发现新版本 {v}（当前 {c}）', updateFail: '检查失败：',
    aboutVersionLabel: '当前版本 {v}', updateGo: '去更新',
    onboardText: '首次使用：先在「设置 → 账号」登录 Steam 账号；国内网络建议先打开加速器（如 Watt Toolkit / Steam++），否则创意工坊和下载容易连不上。',
    onboardGo: '去登录',
    updateBannerText: '发现新版本 {v}（当前 {c}）', updateBannerDismissed: '已忽略本次更新提示',
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
    proxyField: '代理（留空 = 自动跟随系统代理/VPN，不用填端口）',
    proxyTest: '测试连通性', proxySaved: '已保存：{p}', proxyDefault: '自动跟随系统：{p}',
    proxyNone: '自动：未检测到系统代理，直连（VPN 模式下流量由系统路由进 VPN）',
    proxyVpn: '自动：已检测到 VPN，直连即走 VPN',
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
    rawDownload: 'Download raw assets',
    rawDownloadTip: 'No mpkg: video / scene / web items are exported as a zip of the original assets (scene.pkg is unpacked first; web gets touch support + PWA); original audio is kept',
    rawDownloadBtn: 'Download raw assets (zip)',
    saveRaw: 'Save raw assets .zip', openFile: 'Open file',
    webNoMpkg: 'Web wallpapers cannot be packed as MPKG (tick “Download raw assets” to export the page)',
    needLogin: 'Sign in first', notLogged: 'Not signed in — tap ⚙ to sign in',
    hub: 'Downloads', openHub: 'Open download center (separate process, closing this page won\'t stop it)',
    cancelTask: 'Cancel task', hubHint: 'runs in a separate process, safe to close this page',
    tabAccount: 'Account', tabNetwork: 'Network', tabOutput: 'Output', tabDisplay: 'Display', tabAbout: 'About',
    displayTitle: 'Appearance', themeAuto: 'Follow system', themeLight: 'Light', themeDark: 'Dark',
    themeHint: 'Affects this device only — packing results are unchanged.', themeBtn: 'Current: {m} — tap to switch',
    outputTip: 'Both .mpkg files and raw-asset .zip files are saved here.',
    aboutMeta: 'AppID 431960 · PKGM0020 · Wallpapers from the Wallpaper Engine Workshop',
    projectTitle: 'Project', projectIssues: 'Issues / Feedback',
    projectDesc: 'Open source, MIT licensed. Workshop crawl → pure-JS chunked download → Android-ready .mpkg; ships a bundled Node runtime so packing works fully offline.',
    ptrPull: 'Pull to refresh', ptrRelease: 'Release to refresh', ptrBusy: 'Refreshing…',
    recommended: 'Recommended', quickAdd: '＋ Select', quickPicked: '✓ Selected',
    quickDownload: '⬇ Download', quickDownloadTip: 'Queue it at the recommended quality ({q}) without opening the details',
    quickQueued: 'Queued: {t} ({q})', quickBusy: 'This item already has a running task',
    typeWeb: 'Web', typeVideo: 'Video', typeScene: 'Scene', typeApp: 'App', typeOther: 'Wallpaper',
    typeTip: 'Type: {t}',
    openSetup: 'Launcher: local / remote / import credential', setupHint: 'Use this to switch local / remote service or paste a desktop credential; page state is kept.',
    quality: 'Quality', qHigh: 'High (native size)', qBalanced: 'Balanced (1/2)', qSmooth: 'Smooth (1/4)',
    pickedN: '{n} selected', batchStart: 'Download selected', batchClear: 'Clear', batchConfirm: 'Queue {n} selected wallpapers?',
    batchQueued: 'Queued {n} jobs in download center (max 3 at once)', batchNone: 'Tick some wallpapers first',
    batchFail: 'Batch failed: ',
    deviceRec: 'Recommended: {q} ({d})', deviceHint: 'This only changes the default — you can override anytime',
    compatTitle: 'Pre-pack compatibility', compatOk: 'Looks good', compatWarn: 'Needs attention', compatBad: 'Likely black screen',
    compatMeta: '{t} · {n} textures ({v} video) · ~{m} MB VRAM · {s}',
    compatNone: 'No report yet (appears when packing starts)',
    updateTitle: 'Updates', updateCheck: 'Check for updates', updateDownload: 'Open download page', updateDownloadApk: 'Download APK',
    updateChecking: 'Checking the latest GitHub release…', updateLatest: 'You are up to date ({v})',
    updateFound: 'New version {v} available (current {c})', updateFail: 'Check failed: ',
    aboutVersionLabel: 'Current version {v}', updateGo: 'Update',
    updateBannerText: 'New version {v} available (current {c})', updateBannerDismissed: 'Update notice dismissed',
    exitApp: 'Quit (stop background service)',
    exitConfirm: 'Quit now? The background service will be stopped and this page will stop working.',
    exitDone: 'Quit. The service is stopped — you can close this page.',
    settingsTitle: 'Settings', outputDir: 'Download folder (where mpkg is saved)', save: 'Save', resetDefault: 'Reset default',
    pickFolder: 'Choose folder…', pickDone: 'Selected: {d}', pickUnsupported: 'System folder picker unavailable — type a path',
    pickFail: 'No folder returned. Try again or type a path',
    account: 'Steam account', accountField: 'Steam account', passField: 'Password (used once, not saved)',
    onboardText: 'First run: sign in with your Steam account under Settings → Account. In mainland China, turn on an accelerator (e.g. Watt Toolkit / Steam++) first — the Workshop often fails to load otherwise.',
    onboardGo: 'Sign in',
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
    proxyField: 'Proxy (blank = follow the system proxy / VPN automatically, no port needed)',
    proxyTest: 'Test connection', proxySaved: 'Saved: {p}', proxyDefault: 'Follow system: {p}',
    proxyNone: 'Auto: no system proxy detected, direct (VPN mode routes traffic into the VPN)',
    proxyVpn: 'Auto: VPN detected, direct connections go through it',
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

  // 素材类型（Asset Type）：Steam 中文页不翻译这套 WE 自有术语，只能走内置词表
  Particle: '粒子', Image: '图像', Sound: '声音', Model: '模型', Text: '文字',
  Sprite: '序列帧', Fullscreen: '全屏', Composite: '合成', Script: '脚本',
  Effect: '特效', 'Scripted Layer': '脚本图层', '3D Model': '3D 模型',
  'Audio Visualizer': '音频可视化',

  // 素材题材（Asset Genre）
  Background: '背景', Character: '角色', Clock: '时钟', Fire: '火焰',
  Interactive: '交互', Magic: '魔法', 'Post Processing': '后处理', Smoke: '烟雾',
  Space: '太空', Rain: '雨', Water: '水', Snow: '雪', Lightning: '闪电',
  Forest: '森林', City: '城市', Dark: '暗黑', Minimal: '极简', Underwater: '水下',
  Star: '星空', Ocean: '海洋', Clouds: '云', Sunset: '日落', Night: '夜晚',
  Daylight: '白天',

  // 脚本类型（Script Type）：Boolean / Number / Vec2 / Vec3 / Vec4 / String 是数据类型，保持英文不译
  'No Animation': '无动画', Oversized: '超大尺寸',
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
  // 画质选项的「推荐」标记是动态拼出来的，切语言后要重拼
  syncQualityOptions();
  if (state.device) applyDeviceHint();
  // 版本号 / 更新提示条是动态文案，切语言后要重拼
  if (state.version) renderAboutVersion(state.version);
  const bar = $('updateBanner');
  if (state.update && bar && !bar.classList.contains('hidden')) {
    $('updateBannerText').textContent = tr('updateBannerText', { v: state.update.latest, c: state.update.current });
  }
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
  loadSeq: 0,
  loadAbort: null,
  canDownload: true,
  canDownloadReason: '',
  loggedIn: false,
  webLogin: null,          // 社区站登录态 {loggedIn,fresh,accountName}
  statusText: '',
  lang: 'zh',
  loginPoll: null,
  loginPollSeq: 0,
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

/** 只接受 http/https 链接，防止接口返回 javascript:/file: 等危险协议 */
function safeHttpUrl(raw) {
  try {
    const u = new URL(String(raw || ''), location.href);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.toString() : '';
  } catch {
    return '';
  }
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

/** 分组名：优先用官方中文页对照，其次内置词表，最后原样英文 */
function filterGroupLabel(name) {
  const map = state.filterLabels && state.filterLabels.groups;
  if (state.lang === 'zh' && map && map[name]) return map[name];
  return state.lang === 'zh' && GROUP_LABEL_KEY[name] ? tr(GROUP_LABEL_KEY[name]) : name;
}

/** 标签名：同上。注意只影响显示，请求依然用英文原名 */
function filterTagLabel(name) {
  const map = state.filterLabels && state.filterLabels.tags;
  if (state.lang === 'zh' && map && map[name]) return map[name];
  return tagLabel(name);
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
    // 只改显示：分组名走 GROUP_LABEL_KEY 翻译，标签走 tagLabel；
    // 请求里仍然用 Steam 原始英文名（g.name / t.name），翻译过的名字发过去会筛不到东西
    const label = filterGroupLabel(g.name);
    const cnt = set.size;
    const picked = Array.from(set).map(filterTagLabel).join(' / ');
    head.innerHTML = `<span>${esc(label)}${cnt ? `<span class="cnt">${esc(picked)}</span>` : ''}</span><span class="caret">›</span>`;
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
      chip.textContent = filterTagLabel(t.name);
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
    // 官方中英对照（启动时抓官方中文页生成）；没有就用内置词表
    state.filterLabels = data.labels || null;
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

/** 卡片右上角的类型徽标：浏览时就能分清 静态 / 视频 / 网页，不必点进详情 */
const TYPE_META = {
  web: { key: 'typeWeb', cls: 't-web' },
  video: { key: 'typeVideo', cls: 't-video' },
  scene: { key: 'typeScene', cls: 't-scene' },
  app: { key: 'typeApp', cls: 't-app' },
  other: { key: 'typeOther', cls: 't-other' },
};

function typeOf(item) {
  const tags = (item && item.tags) || [];
  const names = tags.map((t) => String(t && (t.label || t.name) ? (t.label || t.name) : t).trim().toLowerCase());
  if (names.some((n) => /^(web|网页)$/.test(n))) return TYPE_META.web;
  if (names.some((n) => /^(video|视频|视频纹理)$/.test(n))) return TYPE_META.video;
  if (names.some((n) => /^(scene|场景)$/.test(n))) return TYPE_META.scene;
  if (names.some((n) => /^(application|应用|程序)$/.test(n))) return TYPE_META.app;
  return TYPE_META.other;
}

function renderItems(items) {
  const grid = $('grid');
  grid.innerHTML = '';
  // 退出登录后会再调一次（不传列表），这种情况只清空、不报「没有结果」
  if (!Array.isArray(items)) return;
  if (!items.length) {
    grid.innerHTML = `<p class="status err">${esc(tr('empty'))}</p>`;
    return;
  }
  for (const it of items) {
    const id = String(it.id);
    const picked = state.picked.has(id);
    const type = typeOf(it);
    const card = document.createElement('div');
    card.className = 'card' + (picked ? ' selected' : '');
    card.dataset.id = id;
    const img = it.preview
      ? `<img class="thumb" src="${esc(it.preview)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">`
      : '<div class="thumb"></div>';
    card.innerHTML = `${img}
      <span class="type-badge ${type.cls}" title="${esc(tr('typeTip', { t: tr(type.key) }))}">${esc(tr(type.key))}</span>
      <div class="card-body">
        <div class="card-title">${esc(it.title || it.id)}</div>
        <div class="card-meta"><span>${esc((it.tags || []).slice(0, 2).map(tagLabel).join(' · ') || '—')}</span><span>${human(it.fileSize)}</span></div>
        <div class="card-quick">
          <button type="button" class="qbtn pick-btn${picked ? ' on' : ''}" data-act="pick">${esc(picked ? tr('quickPicked') : tr('quickAdd'))}</button>
          <button type="button" class="qbtn dl-btn" data-act="quickdl" title="${esc(tr('quickDownloadTip', { q: tr(QUALITY_KEY[state.device ? state.device.preset : 'high']) }))}">${esc(tr('quickDownload'))}</button>
        </div>
      </div>`;
    card.querySelector('[data-act="pick"]').onclick = (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      togglePick(it, !state.picked.has(id));
    };
    card.querySelector('[data-act="quickdl"]').onclick = (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      quickDownload(it, ev.currentTarget);
    };
    card.onclick = () => openDetail(it.id, it);
    grid.appendChild(card);
  }
  updateBatchBar();
}

/** 卡片的加选按钮同时当选中态指示灯，批量栏清空时也要跟着复位 */
function setCardPicked(card, on) {
  if (!card) return;
  card.classList.toggle('selected', on);
  const btn = card.querySelector('[data-act="pick"]');
  if (btn) {
    btn.classList.toggle('on', on);
    btn.textContent = on ? tr('quickPicked') : tr('quickAdd');
  }
}

/** 卡片上的「直接下载」：按设备推荐画质入队，不必先打开详情抽屉 */
async function quickDownload(it, btn) {
  if (!state.loggedIn && !(await ensureLoggedIn())) return;
  const preset = state.device ? state.device.preset : 'high';
  if (btn) btn.disabled = true;
  try {
    await api('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: it.id,
        title: it.title,
        // Web 条目没有 mpkg，直接按原始资源导出（卡片上没法勾选，这里替用户决定）
        raw: isWebItem(it),
        preset,
        // 原始资源原样保留音频；打包 mpkg 默认去音频（有音频交互的场景后端会自动保留）
        preserveAudio: isWebItem(it),
      }),
    });
    $('status').className = 'status';
    $('status').textContent = tr('quickQueued', { t: it.title || it.id, q: qualityShort(preset) });
    if (window.WE_DLC && typeof window.WE_DLC.notifyQueued === 'function') window.WE_DLC.notifyQueued();
    else if (window.WE_DLC) window.WE_DLC.refresh();
  } catch (e) {
    $('status').className = 'status err';
    $('status').textContent = tr('batchFail') + e.message;
  } finally {
    if (btn) btn.disabled = false;
  }
}

function togglePick(it, on) {
  const id = String(it.id);
  if (on) state.picked.set(id, it);
  else state.picked.delete(id);
  setCardPicked(document.querySelector(`.card[data-id="${CSS.escape(id)}"]`), on);
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
  if (!state.loggedIn && !(await ensureLoggedIn())) return;
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
          raw: isWebItem(it),
          preset,
          preserveAudio: isWebItem(it),
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
  document.querySelectorAll('.card').forEach((c) => setCardPicked(c, false));
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

/** 滚动收放：上滑（内容往下走）隐藏顶栏和搜索栏，下滑回来再出现 */
function wireAutoHideHead() {
  let lastY = window.scrollY;
  let acc = 0;
  let hidden = false;
  const setHidden = (v) => {
    if (v && document.body.classList.contains('searching')) return;   // 正在输入时不要收
    if (hidden === v) return;
    hidden = v;
    document.body.classList.toggle('head-hidden', v);
  };
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    if (y < 8) { setHidden(false); lastY = y; acc = 0; return; }
    const d = y - lastY;
    lastY = y;
    if (Math.abs(d) < 6) return;
    // 同方向累计一段距离再切，避免列表抖动时架子来回跳
    acc += d;
    if (acc > 24 && !hidden) { setHidden(true); acc = 0; }
    else if (acc < -24 && hidden) { setHidden(false); acc = 0; }
  }, { passive: true });
  // 点输入框时一定把头部放出来，否则搜不了
  const search = $('search');
  if (search) search.addEventListener('focus', () => { setHidden(false); acc = 0; });
}

/** 回到顶部悬浮按钮：滚过一屏出现，点击平滑回顶 */
function wireScrollTop() {
  const btn = $('toTop');
  if (!btn) return;
  const sync = () => { btn.classList.toggle('hidden', window.scrollY < 400); };
  window.addEventListener('scroll', sync, { passive: true });
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  sync();
}

/** 手机端聚焦搜索框：整行弹出到顶部（带拉伸动画），桌面保持原样 */
function wireSearchFocus() {
  const bar = document.querySelector('.searchbar');
  const input = $('search');
  if (!bar || !input) return;
  input.addEventListener('focus', () => {
    // 只放大输入框本身，不做整行位移
    document.body.classList.remove('head-hidden');
    bar.classList.add('searching');
    document.body.classList.add('searching');
  });
  const close = () => {
    bar.classList.remove('searching');
    document.body.classList.remove('searching');
  };
  input.addEventListener('blur', () => setTimeout(close, 120));
}

/** 首页下拉刷新：列表已在顶部时继续下拉，松手刷新当前筛选 */
function wirePullToRefresh() {
  const ptr = $('ptr');
  const label = $('ptrLabel');
  if (!ptr) return;
  let startY = null;
  let dy = 0;
  let armed = false;
  let busy = false;
  const OPEN = 44;
  const THRESHOLD = 72;
  const setY = (v) => {
    ptr.style.transform = `translateY(${v}px)`;
    ptr.style.opacity = v > 0 ? '1' : '0';
  };
  const reset = () => { startY = null; dy = 0; armed = false; setY(-OPEN); };

  window.addEventListener('touchstart', (e) => {
    if (busy || e.touches.length !== 1) return;
    if (window.scrollY > 0) return;
    if (!$('drawer').classList.contains('hidden') || !$('modal').classList.contains('hidden')) return;
    // 手指落在自己的滚动容器里（筛选栏、日志等）时交给它们自己滚，别被下拉刷新吃掉
    if (e.target && e.target.closest && e.target.closest('.filters, .log, .drawer-body, .modal-body')) return;
    startY = e.touches[0].clientY;
    dy = 0;
    armed = false;
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (startY == null || busy) return;
    dy = e.touches[0].clientY - startY;
    if (dy <= 0 || window.scrollY > 0) { reset(); return; }
    if (e.cancelable) e.preventDefault();   // 顶部下拉时不要触发系统的 overscroll
    armed = dy >= THRESHOLD;
    const pull = Math.min(dy * 0.6, 96);
    label.textContent = armed ? tr('ptrRelease') : tr('ptrPull');
    setY(pull);
  }, { passive: false });

  window.addEventListener('touchend', async () => {
    if (startY == null) return;
    const trigger = armed;
    startY = null;
    armed = false;
    if (!trigger) { setY(-OPEN); return; }
    busy = true;
    label.textContent = tr('ptrBusy');
    setY(46);
    try { await load(); } finally { busy = false; setTimeout(() => setY(-OPEN), 600); }
  });
  window.addEventListener('touchcancel', reset);
}

async function load() {
  const seq = ++state.loadSeq;
  if (state.loadAbort) state.loadAbort.abort();
  const ac = new AbortController();
  state.loadAbort = ac;
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
    const data = await api('/api/browse?' + params.toString(), { signal: ac.signal });
    if (seq !== state.loadSeq) return;
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
    if (e && (e.name === 'AbortError' || seq !== state.loadSeq)) return;
    st.className = 'status err';
    // 国内网络下创意工坊页面/接口经常直接被墙，明确提示先开加速器
    st.innerHTML = esc(tr('failed') + e.message)
      + '<br><span class="hint">' + esc(tr('vpnHint')) + '</span>';
    state.statusText = tr('failed') + e.message;
  }
}

// ---------------- 深浅色 ----------------
const THEME_ICONS = {
  // 图标用内联 SVG：◐ 这类符号在部分安卓字体里会变成豆腐块
  auto: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>',
  light: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.8"/><g stroke="currentColor" stroke-width="1.6"><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6"/></g></svg>',
  dark: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M20 14.5a8 8 0 1 1-9.9-9.6 6.5 6.5 0 0 0 9.9 9.6z" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
};


const THEME_MODE_KEY = 'themeMode';

/**
 * 系统当前是不是深色。
 * 安卓壳里必须问原生：应用主题固定，WebView 的 prefers-color-scheme 恒为浅色，
 * 只看 matchMedia 的话「跟随系统」永远不会生效。浏览器里（没有桥）才走 matchMedia。
 */
function systemPrefersDark() {
  if (window.Android && typeof window.Android.isNightMode === 'function') {
    try { return !!window.Android.isNightMode(); } catch { /* 桥异常时退回 matchMedia */ }
  }
  if (!window.matchMedia) return true;
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch { return true; }
}

/** auto → 跟随系统；light/dark → 用户显式选择 */
function resolveTheme(mode) {
  return mode === 'auto' ? (systemPrefersDark() ? 'dark' : 'light') : mode;
}

function themeModeLabel(mode) {
  return tr(mode === 'auto' ? 'themeAuto' : (mode === 'dark' ? 'themeDark' : 'themeLight'));
}

/**
 * 把模式落到 DOM：data-theme 决定配色，data-theme-mode 只记录用户选择。
 * persist=false 用于「跟随系统变化」和语言切换时的重绘，不覆盖本地存储。
 */
function applyTheme(mode, opts = {}) {
  const persist = opts.persist !== false;
  if (!/^(auto|light|dark)$/.test(mode)) mode = 'auto';
  state.themeMode = mode;
  const eff = resolveTheme(mode);
  const root = document.documentElement;
  root.setAttribute('data-theme', eff);
  root.setAttribute('data-theme-mode', mode);
  // 手机浏览器地址栏 / 安卓状态栏附近的底色跟着变
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', eff === 'dark' ? '#0f1720' : '#f4f6f9');
  const btn = $('themeBtn');
  if (btn) {
    btn.innerHTML = mode === 'auto' ? THEME_ICONS.auto : (eff === 'dark' ? THEME_ICONS.dark : THEME_ICONS.light);
    const label = tr('themeBtn', { m: themeModeLabel(mode) });
    btn.title = label;
    btn.setAttribute('aria-label', label);
  }
  document.querySelectorAll('input[name="themeMode"]').forEach((el) => {
    el.checked = el.value === mode;
  });
  if (persist) {
    try { localStorage.setItem(THEME_MODE_KEY, mode); } catch { /* 隐私模式 */ }
  }
  // 安卓：状态栏/导航栏图标明暗 + WebView 底色
  if (window.Android && typeof window.Android.setTheme === 'function') {
    try { window.Android.setTheme(eff === 'dark'); } catch { /* ignore */ }
  }
}

/** 顶部按钮：直接切明暗；当前是 auto 时，切到与系统相反的那一档（并退出跟随） */
function cycleTheme() {
  const eff = resolveTheme(state.themeMode || 'auto');
  applyTheme(eff === 'dark' ? 'light' : 'dark');
}

function initTheme() {
  let mode = 'auto';
  try { mode = localStorage.getItem(THEME_MODE_KEY) || 'auto'; } catch { /* ignore */ }
  applyTheme(mode, { persist: false });
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (state.themeMode === 'auto') applyTheme('auto', { persist: false });
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }
}

const UPDATE_DISMISS_KEY = 'updateDismissedVersion';

/** 关于页顶部的版本号：服务端 /api/update/check 的 current 就是 package.json 的 version */
function renderAboutVersion(v) {
  const el = $('aboutVersion');
  if (el) el.textContent = v ? tr('aboutVersionLabel', { v }) : '';
}

/**
 * 「去更新」的落点：安卓端直接给 APK 资产（交给系统浏览器下载），其他平台去 Release 页。
 * 链接必须是 http(s)，否则当作不安全忽略。
 */
function updateTarget(d) {
  if (!d || !d.hasUpdate || !d.release || !d.release.url) return null;
  const canExternal = !!(window.Android && typeof window.Android.openExternal === 'function');
  const apk = canExternal && d.release.assets && d.release.assets.apk;
  const target = safeHttpUrl(apk ? apk.url : d.release.url);
  return target ? { href: target, direct: !!apk } : null;
}

/** 关于页里的更新状态（手动检查与启动自动检查共用） */
function renderUpdateState(d) {
  const hint = $('updateHint');
  const link = $('updateLink');
  if (!hint || !link) return;
  state.version = d.current;
  state.update = d;
  renderAboutVersion(d.current);
  const t = updateTarget(d);
  if (d.hasUpdate) {
    hint.textContent = tr('updateFound', { v: d.latest, c: d.current });
    if (t) {
      link.href = t.href;
      link.dataset.direct = t.direct ? '1' : '';
      link.textContent = t.direct ? tr('updateDownloadApk') : tr('updateDownload');
      link.classList.remove('hidden');
    } else {
      hint.textContent += '（更新链接协议不安全，已忽略）';
      link.classList.add('hidden');
    }
  } else {
    hint.textContent = tr('updateLatest', { v: d.current });
    link.classList.add('hidden');
  }
}

/** 顶栏下方的更新提示条：同一版本被关掉后不再弹 */
function showUpdateBanner(d) {
  const bar = $('updateBanner');
  const t = updateTarget(d);
  if (!bar || !t) return;
  let dismissed = '';
  try { dismissed = localStorage.getItem(UPDATE_DISMISS_KEY) || ''; } catch { /* 隐私模式 */ }
  if (dismissed === String(d.latest)) return;
  $('updateBannerText').textContent = tr('updateBannerText', { v: d.latest, c: d.current });
  const go = $('updateBannerGo');
  go.dataset.href = t.href;
  go.dataset.direct = t.direct ? '1' : '';
  bar.classList.remove('hidden');
}

function closeUpdateBanner(remember) {
  const bar = $('updateBanner');
  if (bar) bar.classList.add('hidden');
  if (remember) {
    try { localStorage.setItem(UPDATE_DISMISS_KEY, remember); } catch { /* ignore */ }
    const hint = $('updateHint');
    if (hint) hint.textContent = tr('updateBannerDismissed');
  }
}

/** 启动时自动查一次（服务端 6 小时缓存）：失败就静默，不打扰用户 */
const ONBOARD_KEY = 'onboardHintDone';

/** 首启提示：只在没登录且没关过时出现，关掉写 localStorage（同一设备不再打扰） */
function maybeShowOnboardHint() {
  const bar = $('onboardBanner');
  if (!bar || state.loggedIn) return;
  try {
    if (localStorage.getItem(ONBOARD_KEY) === 'done') return;
  } catch { /* 隐私模式 */ }
  $('onboardBannerText').textContent = tr('onboardText');
  bar.classList.remove('hidden');
}

function closeOnboardHint() {
  const bar = $('onboardBanner');
  if (bar) bar.classList.add('hidden');
  try { localStorage.setItem(ONBOARD_KEY, 'done'); } catch { /* ignore */ }
}

/** 安卓首启向导里选好的输出目录：写进服务端设置，之后网页与打包都用它 */
window.WE_SET_OUTPUT = async function (dir) {
  if (!dir) return;
  try {
    const r = await api('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outputDir: dir }),
    });
    if (r && r.outputDir) {
      state.outputDir = r.outputDir;
      if ($('cfg') && state.loggedIn) $('cfg').textContent = `${state.engine} · ${r.outputDir}`;
    }
  } catch (e) {
    if ($('cfg')) $('cfg').textContent = '⚠ ' + e.message;
  }
};

async function autoCheckUpdate() {
  try {
    const d = await api('/api/update/check');
    renderAboutVersion(d.current);
    if (d.error) return;
    renderUpdateState(d);
    if (d.hasUpdate) showUpdateBanner(d);
  } catch { /* 断网/服务未起：忽略 */ }
}

async function checkUpdate() {
  const hint = $('updateHint');
  hint.textContent = tr('updateChecking');
  try {
    const d = await api('/api/update/check?force=1');
    if (d.error) throw new Error(d.error);
    renderUpdateState(d);
    if (d.hasUpdate) showUpdateBanner(d);
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
const QUALITY_KEY = { high: 'qHigh', balanced: 'qBalanced', smooth: 'qSmooth' };
const QUALITY_SHORT = { high: '高', balanced: '均衡', smooth: '流畅' };
const QUALITY_SHORT_EN = { high: 'High', balanced: 'Balanced', smooth: 'Smooth' };

function qualityShort(preset) {
  return state.lang === 'zh' ? (QUALITY_SHORT[preset] || preset) : (QUALITY_SHORT_EN[preset] || preset);
}

/** 画质下拉：默认落在设备推荐档，并把「推荐」标在对应选项上（少一次选择） */
function syncQualitySelect(sel, saved) {
  if (!sel) return;
  const rec = state.device ? state.device.preset : 'high';
  for (const opt of sel.options) {
    const base = tr(QUALITY_KEY[opt.value] || 'qHigh');
    opt.textContent = base + (opt.value === rec ? ` · ${tr('recommended')}` : '');
  }
  const want = saved || rec;
  if (Array.from(sel.options).some((o) => o.value === want)) sel.value = want;
}

function syncQualityOptions() {
  let override = null;
  try { override = localStorage.getItem('qualityOverride'); } catch { /* ignore */ }
  syncQualitySelect($('d-quality'), override);
  let batchPref = null;
  try { batchPref = localStorage.getItem('batchQuality'); } catch { /* ignore */ }
  syncQualitySelect($('batchQuality'), batchPref);
}

function applyDeviceHint() {
  if (!state.device) state.device = detectDevice();
  const hint = $('d-device');
  if (!hint) return;
  hint.textContent = tr('deviceRec', { q: QUALITY_LABEL[state.device.preset] || state.device.preset, d: state.device.desc });
  hint.title = tr('deviceHint');
  syncQualityOptions();
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
/** 条目标签里带 Type=Web 的，就是网页壁纸（手机端没有 Web 引擎，只能导原始资源） */
function isWebItem(item) {
  return typeOf(item) === TYPE_META.web;
}

function rawExportChecked() {
  return !!($('d-raw') && $('d-raw').checked);
}

function setDownloadLabel() {
  const btn = $('d-download');
  const cur = state.current;
  const web = !!(cur && isWebItem(cur.seed));
  const raw = rawExportChecked();
  // Web 类型没有可用的手机端渲染，只能导出原始资源；不勾选就灰掉
  if (web && !raw) {
    btn.disabled = true;
    btn.textContent = tr('webNoMpkg');
    return;
  }
  if (!state.canDownload) {
    btn.disabled = true;
    btn.textContent = tr('noDownload');
    return;
  }
  // 能下载但没登录：按钮仍然可点，点了直接引导去登录
  btn.disabled = false;
  btn.textContent = raw
    ? tr('rawDownloadBtn')
    : (state.loggedIn ? tr('downloadPack') : tr('needLogin'));
}

function openDetail(id, seed) {
  state.current = { id, seed };
  if ($('drawerMask')) $('drawerMask').classList.remove('hidden');
  $('drawer').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  $('d-title').textContent = seed.title || id;
  if (seed.preview) $('d-preview').src = seed.preview;
  else $('d-preview').removeAttribute('src');
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
    // 详情接口返回的 tags 比列表更全，用它重新判一次 Web 类型（下载按钮可能因此变灰）
    state.current.seed = Object.assign({}, state.current.seed, d);
    setDownloadLabel();
  }).catch(() => { /* 保留卡片信息 */ });
}

function closeDetail() {
  if ($('drawerMask')) $('drawerMask').classList.add('hidden');
  $('drawer').classList.add('hidden');
  document.body.style.overflow = '';
  if (state.poll) clearTimeout(state.poll);
  state.poll = null;
  state.currentJob = null;
}

/** 安卓返回键：先关抽屉/弹窗，返回 true 表示已在页面内消费掉这次返回 */
window.__androidBack = function () {
  const modal = $('modal');
  if (modal && !modal.classList.contains('hidden')) {
    closeSettings();
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
  if (!state.loggedIn && !(await ensureLoggedIn())) {
    // 没登录就直接把用户带去登录，不要先建一个必然失败的任务
    return;
  }
  const rawMode = rawExportChecked();
  if (isWebItem(cur.seed) && !rawMode) {
    // Web 类型不能打包 mpkg，按钮本来就该是灰的；这里兜底防手改 DOM
    setDownloadLabel();
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
        // 勾选后不打包 mpkg，而是把原始资源（scene 解包 / web 离线包）压成 zip
        raw: rawMode,
        preset: ($('d-quality') || {}).value || 'high',
        // 原始资源原样保留音频；打包 mpkg 默认去音频（有音频交互的场景后端会自动保留）
        preserveAudio: rawMode,
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
  if (!window.Android) return null;
  if (typeof window.Android.openMpkg === 'function' || typeof window.Android.openFile === 'function') return window.Android;
  return null;
}

function showResultAction(jobId, result, job) {
  const el = $('p-file');
  // 优先用任务顶层的 outPath，再退回 result 里的（两个接口字段都要能认）
  const wepath = (job && job.outPath) || (result && result.outPath);
  // 原始资源包：产出的是 zip，不是 mpkg；安卓上直接调系统「打开文件」，桌面端下载 zip
  if (result && result.rawExport) {
    if (androidBridge() && wepath && typeof androidBridge().openFile === 'function') {
      el.removeAttribute('href');
      el.dataset.action = 'openfile';
      delete el.dataset.i18n;
      el.textContent = tr('openFile');
      el.onclick = (ev) => {
        ev.preventDefault();
        try {
          const msg = androidBridge().openFile(wepath);
          if (msg) $('p-log').textContent += '\n' + msg;
        } catch (e) {
          $('p-log').textContent += '\n✘ 打开文件失败: ' + e.message;
        }
      };
    } else {
      el.dataset.action = 'save';
      el.dataset.i18n = 'saveRaw';
      el.textContent = tr('saveRaw');
      el.href = '/api/file/' + jobId;
      el.onclick = null;
    }
    if ($('p-note')) $('p-note').textContent = wepath || (job && job.outFile) || '';
    el.classList.remove('hidden');
    return;
  }
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
const PHASE_LABEL = { prepare: '解包检查', download: '下载', convert: '纹理转换', shader: '着色器适配', reference: '替换资源', rawexport: '导出资源', webexport: '导出网页包', write: '写入 mpkg', done: '完成' };

/** 把下载中心的进度写进详情页的进度条（下载一条、打包一条，深色层叠在下载层上） */
function applyProgress(job) {
  const p = job.progress || {};
  const bar = $('p-bar');
  const packEl = $('p-pack');
  const wrap = bar ? bar.parentElement : null;
  const state = job.state;
  const running = state === 'downloading' || state === 'packing' || state === 'queued';
  // 打包阶段判定：state 应已切到 packing，但老服务端可能停在 downloading，所以再看 phase
  const packing = state === 'packing' || (state === 'downloading' && !!p.phase && p.phase !== 'download');
  const done = state === 'done';

  // 下载层：下载阶段按字节涨，一旦进打包就锁 100 —— 底层永远表示「下载这件事完了没」
  let dl = done ? 100 : (typeof p.dlPercent === 'number'
    ? p.dlPercent
    : ((!p.phase || p.phase === 'download') ? (typeof p.percent === 'number' ? p.percent : null) : 100));
  // 打包层：只在打包阶段画出深色覆盖条（完成后收掉，让整条恢复成完成色）
  let pk = packing
    ? (typeof p.packPercent === 'number' ? p.packPercent : (typeof p.percent === 'number' ? p.percent : null))
    : null;

  if (wrap) {
    wrap.classList.toggle('indeterminate', dl === null && pk === null);
    wrap.classList.toggle('layered', pk !== null);
  }
  if (bar) bar.style.width = dl === null ? '' : `${Math.max(1, Math.min(100, dl))}%`;
  if (packEl) {
    packEl.classList.toggle('hidden', pk === null);
    packEl.style.width = pk === null ? '0%' : `${Math.max(1, Math.min(100, pk))}%`;
  }

  const stateText = packing ? '打包中' : ({ queued: '排队中', downloading: '下载中', packing: '打包中', done: '完成', failed: '失败', cancelled: '已取消' }[state] || state);
  $('p-state').textContent = stateText + (done ? ' ✔' : '');
  const late = PHASE_LABEL[p.phase] ? ` · ${PHASE_LABEL[p.phase]}` : '';

  let sub;
  if (packing) {
    // 打包阶段单独算文案：下载已经结束，只报「下载 100% + 打包 x%」，不再挂一个 0 B/s
    const bits = ['下载 100%'];
    bits.push(pk === null ? '打包中' : `打包 ${Math.round(pk)}%`);
    if (p.packTotal) bits.push(`${p.packDone || 0}/${p.packTotal} 张`);
    if (p.total) bits.push(`共 ${human(p.total)}`);
    sub = bits.join(' · ');
  } else {
    const parts = [];
    if (typeof dl === 'number') parts.push(`${Math.round(dl)}%`);
    if (p.total) parts.push(`${human(p.bytes || 0)} / ${human(p.total)}`);
    if (running && p.speed) parts.push(`${human(p.speed)}/s`);
    if (running && p.eta) parts.push(`剩 ${p.eta}s`);
    sub = parts.join('  ');
  }
  const subEl = $('p-sub');
  if (subEl) subEl.textContent = sub;

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
      if (state.currentJob !== jobId) return;
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
const SETTINGS_TABS = ['account', 'network', 'output', 'display', 'about'];

function savedSettingsTab() {
  try {
    const v = localStorage.getItem('settingsTab');
    return SETTINGS_TABS.includes(v) ? v : 'account';
  } catch {
    return 'account';
  }
}

/** 设置弹窗分 tab：账号 / 网络 / 输出 / 关于，手机上不用滚一长页找东西 */
function switchSettingsTab(name) {
  if (!SETTINGS_TABS.includes(name)) name = 'account';
  document.querySelectorAll('#settingsTabs .tab').forEach((b) => {
    const on = b.dataset.tab === name;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('.tabpane').forEach((p) => p.classList.toggle('on', p.id === `tab-${name}`));
  state.settingsTab = name;
  try { localStorage.setItem('settingsTab', name); } catch { /* ignore */ }
}

async function openSettings(tab) {
  $('modal').classList.remove('hidden');
  document.body.classList.add('modal-open');
  switchSettingsTab(tab || savedSettingsTab());
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
      $('proxyInput').placeholder = '自动跟随系统';
      $('proxyHint').textContent = proxyHintText(s);
    }
  } catch (e) {
    $('dirHint').textContent = e.message;
  }
  loadCdnNodes();
}

/**
 * 代理提示：手动代理 > 系统代理（安卓外壳读 LinkProperties/VPN）> 直连
 * 不再引导用户去填 7890 这类固定端口——不同代理软件端口不一样。
 */
function proxyHintText(s) {
  if (!s) return tr('proxyNone');
  if (s.proxy) return tr('proxySaved', { p: s.proxy });
  const net = s.systemNet || {};
  if (s.defaultProxy) return tr('proxyDefault', { p: s.defaultProxy });
  if (net.vpn || net.transport === 'vpn') return tr('proxyVpn');
  return tr('proxyNone');
}

/** 把 /api/config 的结果应用到页面状态（启动、登录后、切回前台都要走这里） */
function applyConfig(cfg) {
  if (!cfg) return null;
  state.canDownload = cfg.canDownload !== false;
  state.canDownloadReason = cfg.canDownloadReason || '';
  state.loggedIn = !!cfg.loggedIn;
  state.webLogin = cfg.webLogin || null;
  if (!state.canDownload) {
    $('cfg').textContent = '⚠ ' + cfg.platform + ' — ' + state.canDownloadReason;
  } else {
    $('cfg').textContent = state.loggedIn ? `${cfg.engine} · ${cfg.outputDir}` : tr('notLogged');
  }
  setDownloadLabel();
  return cfg;
}

async function refreshAuthState() {
  return applyConfig(await api('/api/config'));
}

/**
 * 登录成功后的收尾：先把本地状态摆正（否则用户点下载又被弹回登录页），
 * 再等服务端把 web 登录态换回来（它要连一次 steamcommunity，是异步的），
 * 最后用「账号范围」重抓一次列表 —— 首次登录后列表不该还是匿名内容。
 */
async function afterLoginDone(accountName) {
  $('loginHint').textContent = tr('loginDone', { a: accountName || '?' });
  $('loginAccount').value = accountName || '';
  state.loggedIn = true;
  state.canDownload = true;
  state.canDownloadReason = '';
  setDownloadLabel();
  let got = false;
  for (let i = 0; i < 4 && !got; i++) {
    try {
      const cfg = await refreshAuthState();
      got = !!(cfg && cfg.webLogin && cfg.webLogin.loggedIn);
    } catch { /* 网络抖动就再试一次 */ }
    if (!got) await new Promise((r) => setTimeout(r, 1200));
  }
  load();
}

/** 点下载前的最后一道确认：页面里的 loggedIn 可能是旧的快照 */
async function ensureLoggedIn() {
  try {
    const cfg = await refreshAuthState();
    if (cfg && cfg.loggedIn) {
      load();
      return true;
    }
  } catch { /* 服务没响应就按未登录处理 */ }
  openSettings('account');
  $('loginHint').textContent = tr('notLogged');
  return false;
}

function closeSettings() {
  $('modal').classList.add('hidden');
  document.body.classList.remove('modal-open');
  // 登录轮询不能在关闭设置页时掐掉：手机上「点登录 → 顺手关掉抽屉」太常见了，
  // 掐掉就会变成「后台已登录、主界面还显示未登录」。轮询自己会在 done/failed 时停。
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
  const seq = ++state.loginPollSeq;
  const tick = async () => {
    try {
      const s = await api('/api/login/status');
      if (seq !== state.loginPollSeq) return;
      if (s.state === 'done') {
        state.loginPoll = null;
        await afterLoginDone(s.accountName);
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
      if (seq !== state.loginPollSeq) return;
      state.loginPoll = setTimeout(tick, 3000);
    }
  };
  tick();
}

async function logout() {
  await api('/api/logout', { method: 'POST' });
  if (state.loginPoll) { clearTimeout(state.loginPoll); state.loginPoll = null; }
  state.loginPollSeq++;
  state.loggedIn = false;
  state.webLogin = null;
  state.canDownload = false;
  state.canDownloadReason = tr('needLogin');
  $('loginAccount').value = '';
  $('loginHint').textContent = tr('loginIdle');
  setDownloadLabel();
  if ($('batchBar')) $('batchBar').classList.add('hidden');
  // 退出后按匿名范围重新取一遍列表（不打这批卡片就一直是旧状态）
  load();
}

// ---------------- 事件绑定 ----------------
/** 时间窗选择只在「热门趋势」下有意义 */
function toggleDays() {
  const wrap = $('daysWrap');
  if (wrap) wrap.classList.toggle('hidden', state.sort !== 'trend');
}

function wire() {
  if ($('onboardBannerClose')) $('onboardBannerClose').onclick = closeOnboardHint;
  if ($('onboardBannerGo')) $('onboardBannerGo').onclick = function () { closeOnboardHint(); openSettings('account'); };
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
    document.querySelectorAll('.card').forEach((c) => setCardPicked(c, false));
    updateBatchBar();
  };
  if ($('batchQuality')) $('batchQuality').onchange = (e) => {
    try { localStorage.setItem('batchQuality', e.target.value); } catch { /* ignore */ }
    syncQualityOptions();
  };
  if ($('d-quality')) $('d-quality').onchange = (e) => localStorage.setItem('qualityOverride', e.target.value);
  if ($('p-cancel')) $('p-cancel').onclick = cancelCurrentJob;
  // 下载中心改成页内浮层：不跳页、不重载主界面
  // 顶栏任务条（#hubBtn）的点击由 dlcenter.js 绑定，这里不要再抢一遍，
  // 否则一次点击会「打开→立刻收起」。
  if ($('p-hub')) $('p-hub').onclick = () => { if (window.WE_DLC) window.WE_DLC.open(); };
  document.querySelectorAll('#settingsTabs .tab').forEach((b) => {
    b.onclick = () => switchSettingsTab(b.dataset.tab);
  });
  $('filterToggle').onclick = () => {
    state.filtersOpen = !state.filtersOpen;
    applyFiltersOpen();
  };
  $('filterToggle').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      $('filterToggle').click();
    }
  });
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
        closeSettings();
        window.Android.openSetup();
      }
    };
  }
  $('modalClose').onclick = () => {
    closeSettings();
  };
  $('saveDir').onclick = saveDir;
  if ($('saveProxy')) $('saveProxy').onclick = saveProxy;
  if ($('testProxy')) $('testProxy').onclick = testProxyConn;
  if ($('resetProxy')) $('resetProxy').onclick = resetProxy;
  if ($('themeBtn')) $('themeBtn').onclick = cycleTheme;
  document.querySelectorAll('input[name="themeMode"]').forEach((el) => {
    el.onchange = () => applyTheme(el.value);
  });
  if ($('checkUpdate')) $('checkUpdate').onclick = checkUpdate;
  if ($('updateBannerGo')) {
    $('updateBannerGo').onclick = () => {
      const go = $('updateBannerGo');
      const href = go.dataset.href;
      if (!href) return;
      if (go.dataset.direct === '1' && window.Android && typeof window.Android.openExternal === 'function') {
        openExternal(href);
      } else {
        window.open(href, '_blank', 'noopener');
      }
    };
  }
  if ($('updateBannerClose')) {
    $('updateBannerClose').onclick = () => {
      const v = ($('updateBannerText').textContent.match(/\d+\.\d+\.\d+/g) || []).pop() || '';
      closeUpdateBanner(v);
    };
  }
  // APK 直链在 WebView 里点会停在下载页或被拦；显式交给系统浏览器打开
  if ($('updateLink')) {
    $('updateLink').addEventListener('click', (e) => {
      const link = $('updateLink');
      if (link.dataset.direct === '1' && window.Android && typeof window.Android.openExternal === 'function') {
        e.preventDefault();
        openExternal(link.href);
      }
    });
  }
  if ($('cdnTest')) $('cdnTest').onclick = testCdnNodes;
  if ($('pickDir')) $('pickDir').onclick = pickFolder;
  if ($('d-raw')) {
    $('d-raw').checked = false;
    $('d-raw').onchange = () => setDownloadLabel();
  }
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

  wireAutoHideHead();
  wirePullToRefresh();
  wireScrollTop();
  wireSearchFocus();

  // 点击遮罩关闭
  $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeSettings(); });

  // 详情抽屉：点遮罩（关闭按钮以外的任何位置）直接关闭，避免顶部 ✕ 被状态栏挡住够不到
  if ($('drawerMask')) $('drawerMask').addEventListener('click', closeDetail);

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

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  // 从后台回来（去 Steam App 确认完登录 / 切了窗口）：登录态可能已经变了
  refreshAuthState().catch(() => {});
});

async function init() {
  state.lang = localStorage.getItem('lang') || (/^zh/i.test(navigator.language || '') ? 'zh' : 'en');
  state.filtersOpen = window.innerWidth > 640;
  wire();
  applyLang();
  initTheme();
  watchStickyLayout();
  state.device = detectDevice();
  syncQualityOptions();
  // 恢复上次的抓取深度与时间窗
  state.pages = Math.max(1, Math.min(5, parseInt(localStorage.getItem('depth') || '1', 10) || 1));
  state.days = parseInt(localStorage.getItem('days') || '7', 10) || 7;
  if ($('depth')) $('depth').value = String(state.pages);
  if ($('days')) $('days').value = String(state.days);
  toggleDays();
  try {
    applyConfig(await api('/api/config'));
  } catch (e) {
    $('cfg').textContent = e.message;
  }
  setDownloadLabel();
  maybeShowOnboardHint();
  // 安卓向导可能比页面加载更早把目录塞过来（页面还没 init 完），这里补一次
  if (typeof window.__weOnboardDir === 'string' && window.__weOnboardDir) window.WE_SET_OUTPUT(window.__weOnboardDir);
  load();
  loadFilters();
  // 启动时自动检测更新；有新版本才弹提示，失败静默
  autoCheckUpdate();
  // 下载中心页面上的「重新登录」会带 ?settings=account 跳回主界面，直接落在对应 tab
  const wantTab = new URLSearchParams(location.search).get('settings');
  if (wantTab) openSettings(wantTab);
  // 供浮层/其它页面复用：打开设置并落到指定 tab
  window.WE_APP = {
    openSettings: (tab) => openSettings(tab),
    /** 原生侧系统切了深浅色（Activity 不重建）时回调这里，auto 模式下重算一次 */
    onSystemThemeChange: () => {
      if ((state.themeMode || 'auto') === 'auto') applyTheme('auto', { persist: false });
      else applyTheme(state.themeMode, { persist: false });
    },
  };
}

init();
