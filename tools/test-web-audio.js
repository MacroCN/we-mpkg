'use strict';
/**
 * 音频可视化类 web 壁纸自检：
 *  1. 造一个只会画「音频柱」的网页（只靠 wallpaperRegisterAudioListener 驱动）
 *  2. 造一段 8 秒的测试音频（ffmpeg lavfi sine）
 *  3. 走一遍 convertWebProject，检查
 *     - 抓到的帧之间确实有差异（柱子动了，不再是一张静止画面）
 *     - 产出 mp4 里带 audio 流
 *
 * 运行：node tools\test-web-audio.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const webrender = require('../src/webrender');

const HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#05070d;overflow:hidden}
canvas{display:block;width:100vw;height:100vh}
</style></head><body>
<canvas id="c"></canvas>
<script>
const c = document.getElementById('c');
const dpr = Math.min(2, devicePixelRatio || 1);
function fit(){
  c.width = Math.round(innerWidth * dpr);
  c.height = Math.round(innerHeight * dpr);
}
fit(); addEventListener('resize', fit);
const g = c.getContext('2d');
let spec = new Uint8Array(128);
let frames = 0;
if (window.wallpaperRegisterAudioListener) {
  window.wallpaperRegisterAudioListener(function (arr) {
    spec = arr;
    frames++;
  });
}
function draw(){
  const W = c.width, H = c.height;
  g.fillStyle = '#05070d';
  g.fillRect(0, 0, W, H);
  const n = 64;
  const bw = W / n;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = spec[i] / 255;
    sum += v;
    const h = Math.max(2, v * H * 0.9);
    g.fillStyle = 'hsl(' + (180 + i * 2) + ',90%,' + (35 + v * 45) + '%)';
    g.fillRect(i * bw + 1, H - h, bw - 2, h);
  }
  g.fillStyle = '#9fe';
  g.font = '16px sans-serif';
  g.fillText('audio frames: ' + frames + ' sum: ' + Math.round(sum), 10, 22);
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
</script></body></html>`;

function makeAudio(ffmpeg, out) {
  // 2 秒单一正弦 + 低频鼓点，音量有起伏，频谱不是常数
  execFileSync(ffmpeg, [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=8',
    '-af', 'volume=0.8,tremolo=f=2:d=0.8',
    '-c:a', 'libmp3lame', '-b:a', '128k', out,
  ], { stdio: 'ignore', windowsHide: true });
}

function frameDiff(a, b) {
  const jpeg = require('jpeg-js');
  const A = jpeg.decode(fs.readFileSync(a), { useTArray: true });
  const B = jpeg.decode(fs.readFileSync(b), { useTArray: true });
  if (A.width !== B.width || A.height !== B.height) return 1;
  // 用「明显变化的像素占比」而不是平均值：细高的音频柱只占部分画面，平均值会被大面积背景摊平
  let changed = 0;
  let total = 0;
  const n = A.data.length;
  for (let i = 0; i < n; i += 4) {
    total++;
    const d = Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]);
    if (d > 24) changed++;
  }
  return changed / total; // 0~1
}

function hasAudioStream(ffmpeg, mp4) {
  try {
    const out = execFileSync(ffmpeg, ['-i', mp4, '-hide_banner'], { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    return /Audio:/i.test(out);
  } catch (e) {
    const msg = String((e && (e.stderr || e.message)) || '');
    return /Audio:/i.test(msg);
  }
}

(async () => {
  const ffmpeg = webrender.findFfmpeg();
  const browser = webrender.findBrowser();
  if (!ffmpeg || !browser) {
    console.error(`缺少依赖：ffmpeg=${ffmpeg || '无'} browser=${browser || '无'}`);
    process.exit(1);
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wem-audio-test-'));
  const src = path.join(work, 'src');
  const dst = path.join(work, 'out');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'index.html'), HTML);
  fs.writeFileSync(path.join(src, 'project.json'), JSON.stringify({
    type: 'web', file: 'index.html', title: 'audio-test', preview: '',
  }, null, 2));
  const audio = path.join(src, 'demo.mp3');
  makeAudio(ffmpeg, audio);
  console.log('测试音频:', (fs.statSync(audio).size / 1024).toFixed(0) + ' KB');

  const logs = [];
  const info = await webrender.convertWebProject(src, dst, {
    seconds: 3,
    fps: 12,
    width: 360,
    height: 640,
    layout: 'full',
    onLog: (m) => { logs.push(m); console.log('  ' + m); },
  });

  const mp4 = info.mp4;
  const hasAudio = hasAudioStream(ffmpeg, mp4);
  console.log('mp4:', (fs.statSync(mp4).size / 1024).toFixed(0) + ' KB，含音频流:', hasAudio);

  // 抽几帧比较：动起来的画面帧间差异应明显 > 0
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', mp4, '-vf', 'fps=3', '-frames:v', '6',
    path.join(work, 'chk%02d.jpg')], { stdio: 'ignore', windowsHide: true });
  const frames = fs.readdirSync(work).filter((f) => /^chk\d+\.jpg$/.test(f)).sort()
    .map((f) => path.join(work, f));
  let maxDiff = 0;
  for (let i = 1; i < frames.length; i++) {
    maxDiff = Math.max(maxDiff, frameDiff(frames[i - 1], frames[i]));
  }
  console.log('帧间最大差异:', (maxDiff * 100).toFixed(1) + '%');

  const okAudio = hasAudio;
  const okMotion = maxDiff > 0.02;
  if (okAudio && okMotion) {
    console.log('音频可视化自检通过（画面随频谱变化 + mp4 带音频轨）');
  } else {
    console.log(`音频可视化自检失败：音频轨=${okAudio} 运动=${okMotion}`);
    process.exitCode = 1;
  }
  if (process.env.WEM_KEEP) console.log('保留临时目录:', work);
  else { try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* ignore */ } }
})().catch((e) => { console.error(e); process.exit(1); });
