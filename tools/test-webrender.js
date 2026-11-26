/**
 * 网页壁纸渲染的调试脚本（手动跑）：
 *   node tools/test-webrender.js [html 路径]
 * 默认用仓库自己的 .cache/web-probe/index.html，帧输出到 .cache/web-frames。
 * 路径全部相对仓库根（以前写死过开发机绝对路径，换机器就跑不起来）。
 */
const path = require('path');
const fs = require('fs');
const wr = require('../src/webrender');

const root = path.resolve(__dirname, '..');
const htmlPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, '.cache', 'web-probe', 'index.html');
const outDir = path.join(root, '.cache', 'web-frames');

if (!fs.existsSync(htmlPath)) {
  console.error(`找不到网页：${htmlPath}\n用法：node tools/test-webrender.js <html 路径>`);
  process.exit(1);
}

(async () => {
  const r = await wr.captureFrames(htmlPath, outDir, {
    seconds: 4, fps: 20, width: 1080, height: 2400, onLog: console.log,
  });
  console.log('frames', r.frames, r.ms + 'ms', '->', outDir);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
