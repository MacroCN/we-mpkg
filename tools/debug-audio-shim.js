'use strict';
/** 调试：确认音频兼容层是否注入、监听器是否被调用、频谱是否非零 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');
const webrender = require('../src/webrender');

function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
  });
}
function httpJson(url) {
  return new Promise((res, rej) => {
    http.get(url, (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on('error', rej);
  });
}

(async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wem-dbg-'));
  const html = path.join(work, 'index.html');
  fs.writeFileSync(html, `<!DOCTYPE html><html><body><div id="x">none</div>
<script>
window.__seen = 0;
if (window.wallpaperRegisterAudioListener) {
  window.wallpaperRegisterAudioListener(function (arr) {
    window.__seen++;
    window.__last = [arr[0], arr[1], arr[63], arr[64], arr[127]];
    document.getElementById('x').textContent = 'v=' + arr[0] + ',' + arr[5] + ' n=' + window.__seen;
  });
}
</script></body></html>`);
  const audio = path.join(work, 'a.mp3');
  fs.writeFileSync(audio, Buffer.alloc(0)); // 无音频，走合成频谱

  const port = await freePort();
  const browser = webrender.findBrowser();
  const srv = http.createServer((req, res) => {
    const p = path.join(work, decodeURIComponent((req.url || '/').split('?')[0]));
    fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200); res.end(d); });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const webPort = srv.address().port;

  const proc = spawn(browser, ['--headless=new', `--remote-debugging-port=${port}`,
    `--user-data-dir=${path.join(work, 'ud')}`, '--no-first-run', '--autoplay-policy=no-user-gesture-required',
    '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', 'about:blank'], { stdio: 'ignore' });
  const t0 = Date.now();
  let version = null;
  while (Date.now() - t0 < 15000) {
    version = await httpJson(`http://127.0.0.1:${port}/json/version`).catch(() => null);
    if (version) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params = {}, sessionId) => new Promise((res) => {
    const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  });
  const t = await send('Target.createTarget', { url: 'about:blank' });
  const att = await send('Target.attachToTarget', { targetId: t.result.targetId, flatten: true });
  const sid = att.result.sessionId;
  await send('Page.enable', {}, sid);
  const inj = await send('Page.addScriptToEvaluateOnNewDocument', { source: webrender.audioShimSource('') }, sid);
  console.log('注入结果:', JSON.stringify(inj.result || inj.error));
  await send('Page.navigate', { url: `http://127.0.0.1:${webPort}/index.html` }, sid);
  await new Promise((r) => setTimeout(r, 2500));
  const ev1 = await send('Runtime.evaluate', { expression: 'JSON.stringify({has: typeof window.wallpaperRegisterAudioListener, seen: window.__seen, last: window.__last})', returnByValue: true }, sid);
  console.log('页面状态:', ev1.result && ev1.result.result && ev1.result.result.value);
  const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85 }, sid);
  if (shot.result && shot.result.data) fs.writeFileSync(path.join('logs', 'audio-dbg.jpg'), Buffer.from(shot.result.data, 'base64'));
  try { ws.close(); } catch {}
  try { proc.kill(); } catch {}
  srv.close();
  console.log('截图: logs\\audio-dbg.jpg');
  setTimeout(() => { try { fs.rmSync(work, { recursive: true, force: true }); } catch {} }, 500);
})();
