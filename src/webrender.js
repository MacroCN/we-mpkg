'use strict';
/**
 * web 类型壁纸 -> 视频 转换器
 *
 * 背景：Wallpaper Engine 安卓客户端只有一个渲染引擎（libscenejni.so），
 * 没有任何 Web/Chromium 组件，官方也明确说明「网页类型的壁纸不能在手机上使用」。
 * 因此 web 类 mpkg 导入安卓端只会得到一个黑屏 SurfaceView。
 *
 * 这里用桌面上的 Edge/Chrome 无头模式把 index.html 实时渲染出来，逐帧抓图，
 * 再用 ffmpeg 编码成 mp4，最后按 video 类型重新打包 —— 手机端就能正常播放。
 *
 * 局限：丢失交互（鼠标/滚轮/多屏）与音频反应，动画本身保留。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const DEFAULT_W = 1080;
const DEFAULT_H = 2400;
const DEFAULT_SECONDS = 10;
const DEFAULT_FPS = 24;

const BROWSER_CANDIDATES = [
  process.env.WEM_WEB_BROWSER,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

// 顺序与 src/video.js 保持一致：只用新版，不内置旧版（详见 src/ffmpeg.js）。
// 网页壁纸的音频解码同样是「用不可信的工坊媒体喂解码器」，没有理由退回旧版本。
const FFMPEG_CANDIDATES = [
  process.env.WEM_FFMPEG,
  process.env.FFMPEG,
  path.join(__dirname, '..', '.cache', 'toolchain', 'ffmpeg', 'bin', 'ffmpeg'),
];

function firstExisting(list, extra = []) {
  for (const p of [...list, ...extra]) {
    if (!p) continue;
    try { if (fs.existsSync(p) && fs.statSync(p).isFile()) return p; } catch { /* ignore */ }
  }
  // 退化到 PATH
  const exe = 'which';
  const names = ['ffmpeg'];
  try {
    const out = execFileSync(exe, names, { encoding: 'utf8' }).split(/\r?\n/)[0].trim();
    if (out && fs.existsSync(out)) return out;
  } catch { /* ignore */ }
  return null;
}

function findFfmpeg() { return firstExisting(FFMPEG_CANDIDATES); }

function findBrowser() {
  for (const p of BROWSER_CANDIDATES) {
    if (!p) continue;
    try { if (fs.existsSync(p) && fs.statSync(p).isFile()) return p; } catch { /* ignore */ }
  }
  return null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

function httpJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('timeout')));
  });
}

async function waitFor(fn, timeoutMs, stepMs = 200) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  throw new Error('等待超时');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.atlas': 'text/plain; charset=utf-8',
  '.skel': 'application/octet-stream',
  '.moc3': 'application/octet-stream',
};

/**
 * 起一个临时静态服务：web 壁纸里的 Live2D / PixiJS 会用 XHR/fetch 读模型文件，
 * file:// 下会被同源策略拦掉，必须走 http。
 */
function startStaticServer(rootDir) {
  const root = path.resolve(rootDir);
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent((req.url || '/').split('?')[0]);
    if (rel === '/') rel = '/index.html';
    const abs = path.resolve(path.join(root, '.' + rel));
    if (!abs.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return; }
    fs.readFile(abs, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/** 极简 CDP 客户端（Node >= 21 自带 WebSocket） */
class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.events = new Map();
  }

  open() {
    return new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve(this));
      this.ws.addEventListener('error', (e) => reject(new Error('WebSocket 连接失败: ' + (e && e.message))));
      this.ws.addEventListener('message', (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve: res, reject: rej } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) rej(new Error(msg.error.message || 'CDP 错误'));
          else res(msg.result);
        } else if (msg.method) {
          const cbs = this.events.get(msg.method);
          if (cbs) for (const cb of cbs) { try { cb(msg.params, msg.sessionId); } catch { /* ignore */ } }
        }
      });
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 超时: ${method}`));
        }
      }, 20000);
    });
  }

  on(method, cb) {
    if (!this.events.has(method)) this.events.set(method, []);
    this.events.get(method).push(cb);
  }

  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

function pathToFileUrl(p) {
  let s = path.resolve(p).replace(/\\/g, '/');
  if (!s.startsWith('/')) s = '/' + s;
  return 'file://' + encodeURI(s);
}

/** 音频可视化类 web 壁纸会用的音频文件后缀 */
const AUDIO_EXT = new Set(['.mp3', '.ogg', '.oga', '.wav', '.m4a', '.aac', '.flac']);

/**
 * 找出 web 项目里的音频文件（音频可视化壁纸通常自带一段示例曲/背景乐）。
 * 优先取体积最大的，通常那才是主音轨。
 */
function findAudioFile(dir) {
  let best = null;
  const walk = (d, depth) => {
    if (depth > 4) return;
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const ent of ents) {
      const abs = path.join(d, ent.name);
      if (ent.isDirectory()) walk(abs, depth + 1);
      else if (ent.isFile() && AUDIO_EXT.has(path.extname(ent.name).toLowerCase())) {
        let size = 0;
        try { size = fs.statSync(abs).size; } catch { continue; }
        if (size < 8 * 1024) continue; // 太小的多半是点击音效
        if (!best || size > best.size) best = { path: abs, size };
      }
    }
  };
  walk(dir, 0);
  return best;
}

/**
 * 注入到页面里的「音频兼容层」。
 *
 * Wallpaper Engine 在桌面端通过 `window.wallpaperRegisterAudioListener(fn)` 把系统音频的
 * 128 字节频谱（前 64 左声道 / 后 64 右声道，0~255）持续推给网页。安卓端没有 Web 引擎，
 * 我们把网页烘成视频时这层 API 根本不存在，于是音频可视化类壁纸在视频里就是**静止的**
 * （看起来像「坏了」）。
 *
 * 这里在页面加载前先塞一个同名 API：
 *  - 项目里带音频文件时，用 WebAudio 解码 + AnalyserNode 取真实频谱；
 *  - 没有音频（或解码失败/headless 无音频设备）时退回合成频谱，保证柱子会动。
 */
function audioShimSource(audioRel) {
  return `(() => {
  'use strict';
  const AUDIO_SRC = ${JSON.stringify(audioRel || '')};
  const listeners = [];
  const LEFT = new Uint8Array(64);
  const RIGHT = new Uint8Array(64);
  const payload = new Uint8Array(128);
  let ctx = null, anL = null, anR = null, real = false;

  function synth(t) {
    // 拟真频谱：低频厚、高频长尾，叠 2Hz 节拍脉冲 + 慢速起伏
    const beat = Math.pow(Math.sin(t * Math.PI * 4) * 0.5 + 0.5, 5);
    const bob = 0.5 + 0.5 * Math.sin(t * 0.8);
    for (let i = 0; i < 64; i++) {
      const tilt = Math.exp(-i / 22) * 0.85 + Math.exp(-i / 6) * 0.35;
      const wob = 0.55 + 0.45 * Math.sin(t * (1.6 + i * 0.09) + i * 0.55);
      let v = tilt * wob * (0.45 + 0.55 * bob);
      if (i < 8) v += beat * 0.45 * Math.exp(-i / 5);
      v = Math.max(0, Math.min(1, v));
      const b = Math.round(v * 255);
      LEFT[i] = b;
      RIGHT[i] = b;
    }
  }

  function startReal() {
    if (!AUDIO_SRC) return;
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return;
      ctx = new C();
      fetch(AUDIO_SRC).then(function (r) { return r.arrayBuffer(); })
        .then(function (buf) { return ctx.decodeAudioData(buf); })
        .then(function (data) {
          const src = ctx.createBufferSource();
          src.buffer = data;
          src.loop = true;
          const split = ctx.createChannelSplitter(2);
          anL = ctx.createAnalyser(); anL.fftSize = 128; anL.smoothingTimeConstant = 0.72;
          anR = ctx.createAnalyser(); anR.fftSize = 128; anR.smoothingTimeConstant = 0.72;
          src.connect(split);
          split.connect(anL, 0);
          split.connect(anR, 1);
          try { src.connect(ctx.destination); } catch (e) { /* headless 无输出设备 */ }
          src.start(0);
          if (ctx.resume) ctx.resume().catch(function () {});
          real = true;
        }).catch(function () { real = false; });
    } catch (e) { real = false; }
  }

  function emit() {
    payload.set(LEFT, 0);
    payload.set(RIGHT, 64);
    for (let k = 0; k < listeners.length; k++) {
      try { listeners[k](payload); } catch (e) { /* 单个监听器出错不影响其它 */ }
    }
  }

  const tmpL = new Uint8Array(64);
  const tmpR = new Uint8Array(64);
  function loop() {
    const t = (window.performance || Date).now() / 1000;
    if (real && anL && anR) {
      anL.getByteFrequencyData(tmpL);
      anR.getByteFrequencyData(tmpR);
      let sum = 0;
      for (let i = 0; i < 64; i++) sum += tmpL[i] + tmpR[i];
      if (sum > 120) { LEFT.set(tmpL); RIGHT.set(tmpR); } else { synth(t); }
    } else {
      synth(t);
    }
    emit();
    requestAnimationFrame(loop);
  }

  const reg = function (fn) { if (typeof fn === 'function') listeners.push(fn); };
  window.wallpaperRegisterAudioListener = reg;
  window.wallpaperRegisterAudioListeners = reg;
  startReal();
  requestAnimationFrame(loop);
})();`;
}

/**
 * 用无头浏览器把网页壁纸渲染成 jpeg 帧序列
 * @returns {Promise<{frames:number, dir:string, width:number, height:number, fps:number, ms:number}>}
 */
async function captureFrames(htmlPath, outDir, opts = {}) {
  const browser = opts.browser || findBrowser();
  if (!browser) throw new Error('没有找到 Edge/Chrome，无法把 web 壁纸渲染成视频');
  const width = opts.width || DEFAULT_W;
  const height = opts.height || DEFAULT_H;
  const fps = opts.fps || DEFAULT_FPS;
  const seconds = opts.seconds || DEFAULT_SECONDS;
  const onLog = opts.onLog || (() => {});
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) fs.rmSync(path.join(outDir, f), { force: true });

  const port = await freePort();
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wem-web-'));
  const rootDir = path.dirname(htmlPath);
  const web = await startStaticServer(rootDir);
  const pageUrl = `http://127.0.0.1:${web.port}/${encodeURIComponent(path.basename(htmlPath))}`;

  // 音频兼容层：音频可视化壁纸靠 wallpaperRegisterAudioListener 拿频谱，安卓端没有这一层，
  // 烘视频时必须自己补上，否则画面完全静止。
  let audioRel = '';
  let micWav = '';
  if (opts.enableAudio !== false) {
    const audio = opts.audioFile ? { path: opts.audioFile } : findAudioFile(rootDir);
    if (audio && audio.path && fs.existsSync(audio.path)) {
      audioRel = '/' + path.relative(rootDir, audio.path).split(path.sep).map(encodeURIComponent).join('/');
      onLog(`  音频兼容层: ${path.basename(audio.path)}（用于频谱 + 拟真麦克风输入）`);
      const f = findFfmpeg();
      if (!f) onLog(`  ${require('./ffmpeg').missingHelpShort()}`);
      if (f) {
        const wav = path.join(userData, 'mic.wav');
        try {
          execFileSync(f, ['-y', '-loglevel', 'error', '-i', audio.path, '-vn', '-ac', '2', '-ar', '48000', '-t', '30', wav], { stdio: 'ignore' });
          if (fs.existsSync(wav) && fs.statSync(wav).size > 0) micWav = wav;
        } catch { /* 转 wav 失败就只保留 WebAudio 频谱 */ }
      }
    } else {
      onLog('  音频兼容层: 项目里没有音频文件，使用合成频谱（画面会动，但不是真实音频同步）');
    }
  }
  const args = [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userData}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--disable-extensions',
    '--force-device-scale-factor=1',
    '--high-dpi-support=1',
    // 不少 web 壁纸（Live2D / PixiJS / 粒子）依赖 WebGL，无头环境走 SwiftShader 软件渲染
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-features=CalculateNativeWinOcclusion',
    // 让用 getUserMedia / AnalyserNode 直接抓麦克风的音频可视化壁纸也有真实信号
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    ...(micWav ? [`--use-file-for-fake-audio-capture=${micWav}`] : []),
    `--window-size=${width},${height}`,
    'about:blank',
  ];
  const proc = spawn(browser, args, { stdio: 'ignore' });
  let cdp = null;
  try {
    const version = await waitFor(() => httpJson(`http://127.0.0.1:${port}/json/version`).catch(() => null), 15000);
    cdp = await new Cdp(version.webSocketDebuggerUrl).open();

    const t = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const att = await cdp.send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
    const sid = att.sessionId;
    await cdp.send('Page.enable', {}, sid);

    // 音频兼容层必须在页面脚本执行之前注入
    if (opts.enableAudio !== false) {
      try {
        await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: audioShimSource(audioRel) }, sid);
      } catch (e) {
        onLog(`  ⚠ 音频兼容层注入失败: ${e.message}`);
      }
    }

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: false,
      screenWidth: width, screenHeight: height,
    }, sid);

    await cdp.send('Page.navigate', { url: pageUrl }, sid);
    // 等页面 load 完成
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      cdp.on('Page.loadEventFired', finish);
      setTimeout(finish, 5000);
    });
    // 导航后再锁一次视口尺寸，保证 CSS 像素正好等于目标分辨率
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: false,
      screenWidth: width, screenHeight: height,
    }, sid);
    await new Promise((r) => setTimeout(r, Math.max(200, (opts.warmupMs || 800))));
    const vp = await cdp.send('Page.getLayoutMetrics', {}, sid).catch(() => null);
    if (vp && vp.cssLayoutViewport) {
      onLog(`  视口 ${vp.cssLayoutViewport.clientWidth}x${vp.cssLayoutViewport.clientHeight}`);
    }

    const total = Math.max(8, Math.round(seconds * fps));
    const t0 = Date.now();
    let i = 0;
    while (i < total) {
      const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 88, captureBeyondViewport: false }, sid);
      fs.writeFileSync(path.join(outDir, `f${String(i).padStart(5, '0')}.jpg`), Buffer.from(shot.data, 'base64'));
      i++;
      // 让抓帧节奏贴近目标帧间隔（抓图本身耗时约 30~90ms）
      const target = t0 + i * (1000 / fps);
      const wait = target - Date.now();
      if (wait > 4) await new Promise((r) => setTimeout(r, wait));
      if (Date.now() - t0 > (seconds + 8) * 1000) break; // 兜底
    }
    onLog(`  抓帧 ${i} 张（目标 ${total}，${((Date.now() - t0) / 1000).toFixed(1)}s）`);
    const realFps = Math.max(1, i / ((Date.now() - t0) / 1000));
    if (realFps < fps * 0.7) onLog(`  渲染较慢，实际约 ${realFps.toFixed(1)} fps，将按实际帧率编码（时长不变）`);
    return { frames: i, dir: outDir, width, height, fps, realFps, ms: Date.now() - t0, audioFile: audioRel ? path.join(rootDir, decodeURIComponent(audioRel.slice(1))) : '' };
  } finally {
    try { if (cdp) cdp.close(); } catch { /* ignore */ }
    try { proc.kill(); } catch { /* ignore */ }
    try { web.server.close(); } catch { /* ignore */ }
    setTimeout(() => { try { fs.rmSync(userData, { recursive: true, force: true }); } catch { /* ignore */ } }, 400);
  }
}

/** 帧序列 -> mp4（H.264 / yuv420p / faststart，WE 安卓原生支持）
 * layout = 'full'   ：整帧直接编码
 * layout = 'letterbox'：把画面按宽度居中，四周用模糊放大版填满（适合固定 16:9 的网页）
 */
function encodeMp4(frameDir, outMp4, opts = {}) {
  const ffmpeg = opts.ffmpeg || findFfmpeg();
  if (!ffmpeg) throw new Error(`无法把渲染的帧编码成 mp4。${require('./ffmpeg').missingHelp()}`);
  const fps = opts.fps || DEFAULT_FPS;
  const seconds = opts.seconds || DEFAULT_SECONDS;
  const width = opts.width;
  const height = opts.height;
  const layout = opts.layout || 'full';
  fs.mkdirSync(path.dirname(outMp4), { recursive: true });
  // 抓帧慢于目标帧率时（Live2D / 重 WebGL 页面很常见），用运动插值补齐，保持播放流畅
  const outFps = opts.outFps || fps;
  const interp = opts.outFps && opts.outFps > fps * 1.15
    ? `minterpolate=fps=${outFps}:mi_mode=mci:mc_mode=aobmc:vsbmc=1,`
    : '';
  const common = [
    '-y', '-loglevel', 'error',
    '-framerate', String(fps),
    '-i', path.join(frameDir, 'f%05d.jpg'),
    '-t', String(seconds),
  ];
  // 音频可视化壁纸：把项目自带音轨一起封进 mp4，手机端播放时画面和声音才对得上
  const audioIn = opts.audio && fs.existsSync(opts.audio) ? ['-stream_loop', '-1', '-i', opts.audio] : [];
  const audioMap = audioIn.length ? ['-map', '1:a', '-c:a', 'aac', '-b:a', '128k', '-shortest'] : [];
  const args = layout === 'letterbox'
    ? [
      ...common,
      ...audioIn,
      '-filter_complex',
      `[0:v]${interp}split=2[s1][s2];` +
      `[s1]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},gblur=sigma=48,eq=brightness=-0.08:saturation=0.9[bg];` +
      `[s2]scale=${width}:-2:flags=lanczos[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2:format=auto,setsar=1,format=yuv420p[v]`,
      '-map', '[v]',
      ...audioMap,
      '-color_range', 'tv',
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '22',
      '-profile:v', 'high',
      '-level', '4.1',
      '-movflags', '+faststart',
      outMp4,
    ]
    : [
      ...common,
      ...audioIn,
      '-vf', `${interp}scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,format=yuv420p`,
      '-map', '0:v',
      ...audioMap,
      '-color_range', 'tv',
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '22',
      '-pix_fmt', 'yuv420p',
      '-profile:v', 'high',
      '-level', '4.1',
      '-movflags', '+faststart',
      outMp4,
    ];
  execFileSync(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  if (!fs.existsSync(outMp4)) throw new Error('ffmpeg 未产出 mp4');
  return { outMp4, size: fs.statSync(outMp4).size, ffmpeg, layout };
}

/**
 * 估算画面有效内容占比：取几帧，找出与背景色差异明显的像素包围盒。
 * 固定像素舞台（例如 16:9 布局）塞进竖屏时会只占一角，占比会很低。
 * @returns {number} 0~1
 */
function contentRatio(frameDir, count = 4) {
  let jpegDecode;
  try { jpegDecode = require('./rusttex').jpegDecode; } catch { return 1; } // 没有解码器就假定自适应
  let files;
  try {
    files = fs.readdirSync(frameDir).filter((f) => /^f\d+\.jpg$/.test(f)).sort();
  } catch { return 1; }
  if (!files.length) return 1;
  const stepFile = Math.max(1, Math.floor(files.length / count));
  let best = 0;
  for (let i = 0; i < files.length; i += stepFile) {
    let img;
    try { img = jpegDecode(fs.readFileSync(path.join(frameDir, files[i]))); } catch { continue; }
    const { width: w, height: h, data } = img;
    const px = (x, y) => { const o = (y * w + x) * 4; return [data[o], data[o + 1], data[o + 2]]; };
    const bg = px(2, 2);
    let minX = w; let minY = h; let maxX = -1; let maxY = -1;
    const stride = Math.max(2, Math.floor(w / 240));
    for (let y = 0; y < h; y += stride) {
      for (let x = 0; x < w; x += stride) {
        const c = px(x, y);
        if (Math.abs(c[0] - bg[0]) + Math.abs(c[1] - bg[1]) + Math.abs(c[2] - bg[2]) > 36) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) continue;
    const ratio = ((maxX - minX) * (maxY - minY)) / (w * h);
    if (ratio > best) best = ratio;
  }
  return best || 0.001;
}

/**
 * 把 web 项目目录改写为 video 项目目录（写到 dstDir）
 * @returns {Promise<{dstDir:string, mp4:string, frames:number, ms:number}>}
 */
async function convertWebProject(srcDir, dstDir, opts = {}) {
  const onLog = opts.onLog || (() => {});
  const project = JSON.parse(fs.readFileSync(path.join(srcDir, 'project.json'), 'utf8').replace(/^\uFEFF/, ''));
  const rel = typeof project.file === 'string' && project.file ? project.file.replace(/\\/g, '/') : 'index.html';
  const html = path.join(srcDir, rel);
  if (!fs.existsSync(html)) throw new Error(`project.json 指向的网页不存在: ${rel}`);

  const work = path.join(opts.workDir || path.join(__dirname, '..', '.cache', 'webrender'), String(Date.now()));
  const framesDir = path.join(work, 'frames');
  const mp4 = path.join(dstDir, `${path.basename(rel, path.extname(rel)) || 'wallpaper'}.mp4`);
  fs.mkdirSync(dstDir, { recursive: true });

  const outW = opts.width || DEFAULT_W;
  const outH = opts.height || DEFAULT_H;
  const layoutOpt = opts.layout || 'letterbox';
  const base = { seconds: opts.seconds, fps: opts.fps, onLog, warmupMs: opts.warmupMs, enableAudio: opts.enableAudio, audioFile: opts.audioFile };

  onLog(`[web] 无头渲染 ${rel}（${opts.seconds || DEFAULT_SECONDS}s @ ${opts.fps || DEFAULT_FPS}fps）`);
  let layout = 'full';
  let cap;
  if (layoutOpt === 'full') {
    onLog(`[web] 按竖屏 ${outW}x${outH} 整屏渲染`);
    cap = await captureFrames(html, framesDir, { ...base, width: outW, height: outH });
  } else if (layoutOpt === 'auto') {
    onLog(`[web] 先按竖屏 ${outW}x${outH} 试渲染，检查网页是否自适应`);
    cap = await captureFrames(html, framesDir, { ...base, width: outW, height: outH });
    if (contentRatio(framesDir) < 0.55) {
      layout = 'letterbox';
      onLog('[web] 网页是固定横屏布局，改用 16:9 渲染再做竖屏构图');
      cap = await captureFrames(html, framesDir, { ...base, width: 1920, height: 1080 });
    } else {
      onLog('[web] 网页能自适应竖屏，直接整屏输出');
    }
  } else {
    layout = 'letterbox';
    onLog('[web] 按桌面原生 16:9 渲染，再做竖屏构图（模糊填充）');
    cap = await captureFrames(html, framesDir, { ...base, width: 1920, height: 1080 });
  }

  onLog('[web] 编码 mp4 ...');
  const effFps = Math.max(1, Math.min(opts.fps || DEFAULT_FPS, cap.realFps || cap.fps));
  const effSec = cap.frames / effFps;
  const targetFps = opts.fps || DEFAULT_FPS;
  const enc = encodeMp4(framesDir, mp4, {
    ...opts,
    audio: cap.audioFile,
    width: outW,
    height: outH,
    layout,
    fps: Math.round(effFps * 100) / 100,
    outFps: targetFps,
    seconds: effSec,
  });
  onLog(`[web] mp4 完成 ${(enc.size / 1024 / 1024).toFixed(2)} MB（${layout === 'letterbox' ? '竖屏构图' : '整屏'}${cap.audioFile ? ' · 含音频轨' : ''}）`);

  // 组装 video 类型项目：只带 project.json 指向的预览图，其余网页资源（Live2D 模型、库）全部丢弃
  const keep = new Set();
  if (typeof project.preview === 'string' && project.preview) keep.add(project.preview.replace(/\\/g, '/'));
  for (const n of ['preview.gif', 'preview.jpg', 'preview.png']) keep.add(n);
  for (const rel of keep) {
    const src = path.join(srcDir, rel);
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue;
    const dest = path.join(dstDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
  if (path.basename(mp4) !== 'wallpaper.mp4') {
    // 统一命名，避免 project.json 里路径带空格
    fs.renameSync(mp4, path.join(dstDir, 'wallpaper.mp4'));
  }
  const outProject = { ...project };
  outProject.type = 'video';
  outProject.file = 'wallpaper.mp4';
  if (project.preview && fs.existsSync(path.join(srcDir, project.preview))) {
    outProject.preview = project.preview;
  }
  fs.writeFileSync(path.join(dstDir, 'project.json'), JSON.stringify(outProject, null, 2));

  try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* ignore */ }
  return { dstDir, mp4: path.join(dstDir, 'wallpaper.mp4'), frames: cap.frames, ms: cap.ms, size: enc.size, layout };
}

module.exports = {
  convertWebProject,
  captureFrames,
  encodeMp4,
  findFfmpeg,
  FFMPEG_CANDIDATES,
  findBrowser,
  findAudioFile,
  audioShimSource,
  DEFAULT_W, DEFAULT_H, DEFAULT_SECONDS, DEFAULT_FPS,
};
