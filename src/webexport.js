'use strict';
/**
 * web 类型壁纸「导出到本地」：把整个网页工程做成离线包（PWA）。
 *
 * 背景：安卓 WE 只有 scene/video 引擎，网页壁纸导入必黑屏；而用户有时只是想
 * 在手机上看看这张壁纸的交互效果，并不需要它变系统壁纸。这时最合适的是
 * 「静态网页离线包」：原样保留 index.html + 资源，补上 viewport、触屏适配脚本，
 * 再顺手做成 PWA（manifest + service worker），解压后即可在手机浏览器里跑，
 * 支持「添加到桌面」当独立 App 用。
 *
 * 产出：<下载目录>/<标题>_<id>_web.zip，里面是一个可直接打开的完整网页目录。
 */
const fs = require('fs');
const path = require('path');
const zip = require('./zip');

const TOUCH_SCRIPT = 'we-touch.js';
const PWA_SCRIPT = 'we-pwa.js';
const MANIFEST_FILE = 'manifest.webmanifest';
const SW_FILE = 'sw.js';
const README_FILE = 'README-手机预览.txt';

/** 打包网页离线包时没必要带的 WE 私有资源 */
const SKIP_EXT = new Set(['.tex', '.pkg', '.mpkg']);

// ---------------------------------------------------------------------------
// 触屏适配脚本：把触摸手势翻译成鼠标事件，绝大多数网页壁纸不改代码就能点得动
// ---------------------------------------------------------------------------
const TOUCH_JS = `/* we-mpkg 自动生成的触屏适配脚本（可删，删了交互会退回鼠标事件） */
(function () {
  if (window.__WE_TOUCH__) return;
  if (!('ontouchstart' in window) && navigator.maxTouchPoints <= 0) return;
  window.__WE_TOUCH__ = true;

  // 1) 关掉页面滚动/长按菜单/选中，网页壁纸基本都要占满全屏
  var css = document.createElement('style');
  css.textContent = 'html,body{overflow:hidden!important;touch-action:none!important;'
    + '-webkit-user-select:none!important;user-select:none!important;'
    + '-webkit-touch-callout:none!important;overscroll-behavior:none!important}';
  (document.head || document.documentElement).appendChild(css);

  // 2) 触摸 -> 鼠标：按落点取真实目标，再冒泡给页面自己的监听器
  function targetAt(x, y) {
    return document.elementFromPoint(x, y) || document.body || document.documentElement;
  }
  function fire(type, x, y, buttons) {
    var el = targetAt(x, y);
    if (!el) return;
    var ev;
    try {
      ev = new MouseEvent(type, {
        bubbles: true, cancelable: true, view: window,
        clientX: x, clientY: y, screenX: x, screenY: y,
        button: 0, buttons: buttons, detail: type === 'click' ? 1 : 0
      });
    } catch (e) {
      ev = document.createEvent('MouseEvents');
      ev.initMouseEvent(type, true, true, window, type === 'click' ? 1 : 0,
        x, y, x, y, false, false, false, false, 0, null);
    }
    el.dispatchEvent(ev);
  }

  var down = false;
  var lastX = 0, lastY = 0;

  function onStart(e) {
    if (e.touches && e.touches.length > 1) { down = false; return; }
    var t = e.touches ? e.touches[0] : e.changedTouches[0];
    if (!t) return;
    down = true;
    lastX = t.clientX; lastY = t.clientY;
    fire('mousemove', lastX, lastY, 0);
    fire('mousedown', lastX, lastY, 1);
    if (e.cancelable) e.preventDefault();
  }
  function onMove(e) {
    var t = e.touches ? e.touches[0] : e.changedTouches[0];
    if (!t) return;
    lastX = t.clientX; lastY = t.clientY;
    // 拖动/跟随效果：按住时 buttons=1，否则 0
    fire('mousemove', lastX, lastY, down ? 1 : 0);
    if (e.cancelable) e.preventDefault();
  }
  function onEnd(e) {
    var t = (e.changedTouches && e.changedTouches[0]) || { clientX: lastX, clientY: lastY };
    lastX = t.clientX; lastY = t.clientY;
    fire('mouseup', lastX, lastY, 0);
    if (down) fire('click', lastX, lastY, 0);
    down = false;
    if (e.cancelable) e.preventDefault();
  }
  // 用非 passive 才能 preventDefault，挡住浏览器自己合成的鼠标事件（避免点一次触发两次）
  window.addEventListener('touchstart', onStart, { passive: false });
  window.addEventListener('touchmove', onMove, { passive: false });
  window.addEventListener('touchend', onEnd, { passive: false });
  window.addEventListener('touchcancel', onEnd, { passive: false });
  window.addEventListener('contextmenu', function (e) { e.preventDefault(); }, { passive: false });

  // 3) 方向/窗口变化后重新按视口铺满（不少 canvas 壁纸只在 resize 里重算尺寸）
  var lastW = window.innerWidth, lastH = window.innerHeight;
  function relayout() {
    if (window.innerWidth === lastW && window.innerHeight === lastH) return;
    lastW = window.innerWidth; lastH = window.innerHeight;
    try { window.dispatchEvent(new Event('resize')); } catch (e) { /* ignore */ }
  }
  window.addEventListener('orientationchange', function () { setTimeout(relayout, 260); });
  window.addEventListener('resize', relayout);
})();
`;

// ---------------------------------------------------------------------------
// PWA 注册脚本：file:// 下 service worker 注册不了，静默跳过即可
// ---------------------------------------------------------------------------
const PWA_JS = `/* we-mpkg 自动生成的 PWA 注册脚本 */
(function () {
  if (!('serviceWorker' in navigator)) return;
  if (!/^http/i.test(location.protocol)) return; // file:// 不支持，离线单页照常能看
  var self = document.currentScript;
  var base = self && self.src ? self.src.replace(/[^/]*$/, '') : './';
  window.addEventListener('load', function () {
    navigator.serviceWorker.register(base + 'sw.js', { scope: base }).catch(function () { /* 忽略 */ });
  });
})();
`;

const README_TEXT = (title, id) => `【离线网页包】${title}（${id}）

这是从 Wallpaper Engine 创意工坊条目里导出的完整网页，交互（JS / Canvas / WebGL）全部保留，
但它不是系统壁纸，只是一个能离线打开的网页。

怎么用（手机）
1. 解压这个 zip（系统文件管理器、ZArchiver 都行）。
2. 用支持本地网页的浏览器打开里面的 index.html：
   Kiwi Browser / Firefox 最稳；系统自带浏览器和 Chrome 对 file:// 跨域限制严，容易白屏。
   打开时如果提示「用其他应用打开」，选浏览器即可。
3. 想要「添加到桌面 / 全屏像 App」的效果（PWA）：service worker 需要 http(s) 或 localhost，
   file:// 下会自动跳过。把整个文件夹放到任意 http(s) 地址，或本机跑
   python -m http.server 8000 后访问 http://localhost:8000/index.html，即可安装。

包里多出来的文件
- we-touch.js  触屏适配：把触摸翻译成鼠标事件，并禁止页面滚动/缩放/长按菜单
- we-pwa.js    PWA 注册（file:// 下自动跳过）
- manifest.webmanifest / sw.js  添加到桌面与离线缓存
- icon-192.jpg / icon-512.jpg   桌面图标（取自条目预览图）

注意
- 音频可能需要点一下屏幕才会响（浏览器自动播放限制）。
- 部分壁纸用多指手势或鼠标滚轮，手机上没有对应操作，属于原理限制。
`;

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------
function safeName(s) {
  return String(s || '').replace(/[\\/:*?"<>|\r\n\t]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'web';
}

function copyTree(src, dst, onLog) {
  let skipped = 0;
  const walk = (sub, out) => {
    fs.mkdirSync(out, { recursive: true });
    let entries = [];
    try { entries = fs.readdirSync(sub, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const from = path.join(sub, e.name);
      const to = path.join(out, e.name);
      if (e.isDirectory()) { walk(from, to); continue; }
      if (!e.isFile()) continue;
      if (SKIP_EXT.has(path.extname(e.name).toLowerCase())) { skipped++; continue; }
      fs.copyFileSync(from, to);
    }
  };
  walk(src, dst);
  if (skipped) onLog && onLog(`  跳过 ${skipped} 个 WE 私有资源（.tex/.pkg/.mpkg）`);
  return skipped;
}

/** 生成桌面图标（只用现成依赖 jpeg-js，避免再引 png 编码库） */
function makeIcon(previewPath, size, outPath) {
  const jpeg = require('jpeg-js');
  let pixels;
  let w;
  let h;
  if (previewPath && fs.existsSync(previewPath)) {
    const raw = jpeg.decode(fs.readFileSync(previewPath), { useTArray: true });
    w = raw.width; h = raw.height;
    pixels = raw.data;
  } else {
    // 没有预览图就画一张深色纯色图，保证 manifest 里的图标不是 404
    w = 64; h = 64;
    pixels = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      pixels[i * 4] = 16; pixels[i * 4 + 1] = 20; pixels[i * 4 + 2] = 24; pixels[i * 4 + 3] = 255;
    }
  }
  // 居中裁成正方形 + 双线性缩放到目标尺寸
  const side = Math.min(w, h);
  const sx = (w - side) / 2;
  const sy = (h - side) / 2;
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const fy = sy + ((y + 0.5) * side) / size - 0.5;
    const y0 = Math.max(0, Math.floor(fy));
    const y1 = Math.min(h - 1, y0 + 1);
    const wy = Math.min(1, Math.max(0, fy - y0));
    for (let x = 0; x < size; x++) {
      const fx = sx + ((x + 0.5) * side) / size - 0.5;
      const x0 = Math.max(0, Math.floor(fx));
      const x1 = Math.min(w - 1, x0 + 1);
      const wx = Math.min(1, Math.max(0, fx - x0));
      const o = (y * size + x) * 4;
      for (let c = 0; c < 4; c++) {
        const a = pixels[(y0 * w + x0) * 4 + c];
        const b = pixels[(y0 * w + x1) * 4 + c];
        const d = pixels[(y1 * w + x0) * 4 + c];
        const e = pixels[(y1 * w + x1) * 4 + c];
        const top = a * (1 - wx) + b * wx;
        const bottom = d * (1 - wx) + e * wx;
        out[o + c] = Math.round(top * (1 - wy) + bottom * wy);
      }
    }
  }
  const enc = jpeg.encode({ data: out, width: size, height: size }, 86);
  fs.writeFileSync(outPath, enc.data);
}

function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/**
 * 往 html 里注入 viewport / manifest / 两个脚本。
 * 资源都在包根目录，所以深层 html 需要 ../ 前缀。
 */
function patchHtml(html, depth) {
  const prefix = depth > 0 ? '../'.repeat(depth) : './';
  const head = [
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">',
    '<meta name="theme-color" content="#101418">',
    `<link rel="manifest" href="${prefix}${MANIFEST_FILE}">`,
    `<link rel="apple-touch-icon" href="${prefix}icon-192.jpg">`,
    `<script src="${prefix}${TOUCH_SCRIPT}" defer></script>`,
    `<script src="${prefix}${PWA_SCRIPT}" defer></script>`,
  ].join('\n');
  let out = html;
  // 已有 viewport 的就不要再塞第二个，避免手机端按后写的那个缩放
  if (!/name\s*=\s*["']viewport["']/i.test(out)) {
    if (/<head[^>]*>/i.test(out)) out = out.replace(/<head[^>]*>/i, (m) => `${m}\n${head}`);
    else if (/<html[^>]*>/i.test(out)) out = out.replace(/<html[^>]*>/i, (m) => `${m}\n<head>\n${head}\n</head>`);
    else out = `${head}\n${out}`;
  } else {
    const extra = [
      `<link rel="manifest" href="${prefix}${MANIFEST_FILE}">`,
      `<script src="${prefix}${TOUCH_SCRIPT}" defer></script>`,
      `<script src="${prefix}${PWA_SCRIPT}" defer></script>`,
    ].join('\n');
    if (/<\/head>/i.test(out)) out = out.replace(/<\/head>/i, `${extra}\n</head>`);
    else if (/<body[^>]*>/i.test(out)) out = out.replace(/<body[^>]*>/i, (m) => `${extra}\n${m}`);
    else out = `${extra}\n${out}`;
  }
  return out;
}

function buildManifest(title) {
  const short = String(title || 'Web 壁纸').slice(0, 12);
  return JSON.stringify({
    name: String(title || 'Web 壁纸'),
    short_name: short,
    start_url: './index.html',
    scope: './',
    display: 'fullscreen',
    display_override: ['fullscreen', 'standalone'],
    orientation: 'any',
    background_color: '#000000',
    theme_color: '#101418',
    icons: [
      { src: 'icon-192.jpg', sizes: '192x192', type: 'image/jpeg', purpose: 'any' },
      { src: 'icon-512.jpg', sizes: '512x512', type: 'image/jpeg', purpose: 'any' },
    ],
  }, null, 2);
}

function buildServiceWorker(files) {
  const list = files.map((f) => `'./${f}'`).join(',\n  ');
  return `/* we-mpkg 自动生成的离线缓存 */
const CACHE = 'we-mpkg-pwa-${Date.now().toString(36)}';
const ASSETS = [
  ${list}
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)
    .then((resp) => {
      const copy = resp.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return resp;
    })
    .catch(() => caches.match('./index.html')));
});
`;
}

function pickEntryHtml(root) {
  const candidates = [];
  const walk = (sub) => {
    let entries = [];
    try { entries = fs.readdirSync(sub, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(sub, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!e.isFile() || !/\.html?$/i.test(e.name)) continue;
      const rel = path.relative(root, abs).split(path.sep).join('/');
      candidates.push(rel);
    }
  };
  walk(root);
  if (candidates.includes('index.html')) return 'index.html';
  const shallow = candidates.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  return shallow[0] || null;
}

/**
 * 把 web 工程导出成离线网页包（PWA）。
 * @param {string} srcDir 解包后的工程目录
 * @param {{id:string,title:string,outDir:string,onLog?:Function,onProgress?:Function}} opts
 */
function exportWebProject(srcDir, opts = {}) {
  const onLog = opts.onLog || (() => {});
  const onProgress = opts.onProgress || (() => {});
  const id = String(opts.id || path.basename(srcDir));
  const title = opts.title || `wallpaper_${id}`;
  const outDir = opts.outDir || path.join(srcDir, '..');

  const entry = pickEntryHtml(srcDir);
  if (!entry) {
    const e = new Error('这个条目里没有 .html 文件，不是网页（web）类型壁纸，离线网页包不适用');
    e.code = 'NOT_WEB';
    throw e;
  }
  onProgress({ phase: 'webexport', percent: null, detail: '复制网页资源' });
  onLog(`  web 类型：入口 ${entry}，开始导出离线网页包`);

  const workRoot = path.join(path.dirname(srcDir), 'webexport');
  const pkgDir = path.join(workRoot, `${safeName(title)}_${id}_web`);
  fs.rmSync(pkgDir, { recursive: true, force: true });
  fs.mkdirSync(pkgDir, { recursive: true });
  copyTree(srcDir, pkgDir, onLog);

  const preview = ['preview.jpg', 'preview.png', 'preview.gif']
    .map((n) => path.join(srcDir, n)).find((p) => fs.existsSync(p));

  // 图标：manifest 里要 192/512，否则 Chrome 不给「安装」入口
  try {
    fs.mkdirSync(pkgDir, { recursive: true });
    makeIcon(preview, 192, path.join(pkgDir, 'icon-192.jpg'));
    makeIcon(preview, 512, path.join(pkgDir, 'icon-512.jpg'));
  } catch (e) {
    onLog(`  ⚠ 图标生成失败（不影响预览）: ${e.message}`);
  }

  fs.writeFileSync(path.join(pkgDir, TOUCH_SCRIPT), TOUCH_JS, 'utf8');
  fs.writeFileSync(path.join(pkgDir, PWA_SCRIPT), PWA_JS, 'utf8');
  fs.writeFileSync(path.join(pkgDir, MANIFEST_FILE), buildManifest(title), 'utf8');
  fs.writeFileSync(path.join(pkgDir, README_FILE), README_TEXT(title, id), 'utf8');

  // 逐个 html 注入适配内容
  const htmlFiles = zip.listFiles(pkgDir, (rel) => /\.html?$/i.test(rel));
  let patched = 0;
  for (const f of htmlFiles) {
    if (f.rel === README_FILE) continue;
    const depth = f.rel.split('/').length - 1;
    const raw = stripBom(fs.readFileSync(f.abs, 'utf8'));
    fs.writeFileSync(f.abs, patchHtml(raw, depth), 'utf8');
    patched++;
  }
  onLog(`  已为 ${patched} 个 html 注入 viewport / 触屏适配 / PWA 入口`);

  // service worker 预缓存列表：最终目录里除 sw.js 自身外的所有文件
  const all = zip.listFiles(pkgDir, (rel) => rel !== SW_FILE);
  const swList = all.map((f) => f.rel);
  fs.writeFileSync(path.join(pkgDir, SW_FILE), buildServiceWorker(swList), 'utf8');

  onProgress({ phase: 'webexport', percent: null, detail: '压缩成 zip' });
  const suffix = opts.nameSuffix || 'web';
  const outFile = path.join(outDir, `${safeName(title)}_${id}_${suffix}.zip`);
  fs.rmSync(outFile, { force: true });
  const zipped = zip.zipDirToFile(pkgDir, outFile);
  const totalBytes = zip.listFiles(pkgDir).reduce((n, f) => n + fs.statSync(f.abs).size, 0);

  // 工作目录用完就删，只在输出目录留一个 zip（keepDir 留给测试/调试）
  if (opts.keepDir) onLog(`  调试：保留解包目录 ${pkgDir}`);
  else { try { fs.rmSync(pkgDir, { recursive: true, force: true }); } catch { /* ignore */ } }

  onLog(`✔ 离线网页包: ${outFile} (${(zipped.size / 1048576).toFixed(2)} MB, ${zipped.entries} 个文件, 原始 ${(totalBytes / 1048576).toFixed(2)} MB)`);

  return {
    outFile,
    size: zipped.size,
    entries: zipped.entries,
    type: 'web',
    mode: 'web',
    webExport: true,
    entry,
    dir: opts.keepDir ? pkgDir : null,
    htmlCount: patched,
    rawBytes: totalBytes,
    warnings: [
      '离线网页包保留原始交互，但手机端不能当系统壁纸；用 Kiwi / Firefox 打开 index.html 预览',
      '「添加到桌面」需要 http(s) 或 localhost，file:// 下 service worker 会自动跳过',
    ],
  };
}

module.exports = {
  exportWebProject,
  pickEntryHtml,
  patchHtml,
  buildManifest,
  buildServiceWorker,
  TOUCH_JS,
  PWA_JS,
  MANIFEST_FILE,
  SW_FILE,
  TOUCH_SCRIPT,
};
