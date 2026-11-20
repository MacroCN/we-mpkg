const wr = require('../src/webrender');
const p = 'D:/SteamCMD/we-mpkg/.cache/web-probe/index.html';
(async () => {
  const r = await wr.captureFrames(p, 'D:/SteamCMD/we-mpkg/.cache/web-frames', { seconds: 4, fps: 20, width: 1080, height: 2400, onLog: console.log });
  console.log('frames', r.frames, r.ms + 'ms');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
