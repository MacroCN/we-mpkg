'use strict';
/**
 * 下载中心页面：轮询下载中心进程的 /api/hub/jobs，渲染进度条与操作。
 * 这个页面跑在独立端口（默认 3091）上，关掉主界面不影响任务。
 *
 * 任务的状态文案 / meta / 动作按钮和主界面的浮层共用 public/joblib.js，
 * 这里只负责把 view(job) 画成这个页面自己的卡片样式。
 */

const POLL_MS = 1000;
const $ = (id) => document.getElementById(id);
const J = window.WE_JOBS;

// 手机远程连接时 localhost 会指向手机自己，必须按当前页面主机拼主界面地址
function mainBase() {
  return `${location.protocol === 'https:' ? 'https:' : 'http:'}//${location.hostname}:3090`;
}
(function fixMainLink() {
  const a = $('mainLink');
  if (!a) return;
  a.href = mainBase() + '/';
})();

function esc(s) { return J.esc(s); }
function human(n) { return J.human(n); }

/** 安卓外壳的原生桥：有它才能直接拉起壁纸引擎导入 */
function bridge() {
  if (!window.Android) return null;
  if (typeof window.Android.openMpkg !== 'function' && typeof window.Android.openFile !== 'function') return null;
  return window.Android;
}

/** 阶段那行的文案：暂停 / 阶段名 / 明细拼一起（判定在 joblib 里） */
function phaseLabel(v) {
  if (v.paused) return v.state === 'downloading' ? '已暂停 · 已下的分块保留，点「继续」接着下' : '已暂停';
  return v.phase || v.stateText;
}

function renderJob(j) {
  const v = J.view(j, { bridge: bridge(), reveal: false, fileBase: 'api/hub/file/' });
  const actions = v.actions.map((a) => {
    if (a.act === 'save') {
      return `<a class="download small" href="${a.href}" download>${esc(a.label)}</a>`;
    }
    return `<button class="ghost" data-act="${a.act}" data-id="${esc(j.id)}">${esc(a.label)}</button>`;
  });
  const err = v.error
    ? `<div class="dl-err">✘ ${esc(v.error)}${v.errorText ? ` · ${esc(v.errorText)}` : ''}</div>` : '';
  const warnings = v.warnings.length
    ? `<div class="dl-warn">⚠ ${esc(v.warnings.slice(0, 3).join('；'))}${v.warnings.length > 3 ? ' …' : ''}</div>` : '';

  const tex = j.result && j.result.tex;
  const extra = [];
  if (tex && (tex.converted || tex.downsampled)) {
    extra.push(`纹理 ${tex.converted} 转换${tex.downsampled ? `（降采样 ${tex.downsampled}）` : ''}`);
  }
  if (j.result && j.result.audio && j.result.audio.removed) extra.push(`音频剥离 ${j.result.audio.removed}`);
  if (j.result && j.result.shader && j.result.shader.rewritten) extra.push(`着色器改写 ${j.result.shader.rewritten}`);

  return `
    <article class="dl-card st-${esc(v.state)}" data-id="${esc(j.id)}">
      <div class="dl-card-head">
        <div class="dl-card-title">
          <span class="st st-${esc(v.state)}">${esc(v.badge)}</span>
          <strong>${esc(v.title)}</strong>
          <span class="dl-sub">#${esc(v.itemId)}</span>
        </div>
        <div class="dl-card-actions">${actions.join('')}</div>
      </div>
      <div class="dl-phase"><span>${esc(phaseLabel(v))}</span><span class="dl-pct">${v.pct === null ? '' : v.pct + '%'}</span></div>
      ${v.bar}
      <div class="dl-meta">${esc(v.metaText)}</div>
      ${err}${warnings}
      ${extra.length ? `<div class="dl-meta">${esc(extra.join(' · '))}</div>` : ''}
      ${j.log && j.log.length ? `<details class="dl-log"><summary>日志（${j.log.length} 行）</summary><pre>${esc(j.log.join('\n'))}</pre></details>` : ''}
    </article>`;
}

let lastFingerprint = '';
let lastJobs = [];

async function tick() {
  try {
    const r = await fetch('api/hub/jobs', { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    const jobs = data.jobs || [];
    lastJobs = jobs;
    const fp = J.fingerprint(jobs);
    $('dl-stat').textContent = `${data.running}/${data.maxConcurrent} 并发 · 共 ${jobs.length} 条`;
    $('dl-empty').classList.toggle('hidden', jobs.length > 0);
    if (fp !== lastFingerprint) {
      lastFingerprint = fp;
      $('dl-list').innerHTML = jobs.map(renderJob).join('');
      // 日志展开状态保留
      document.querySelectorAll('.dl-log[open]').forEach((el) => {
        const card = el.closest('.dl-card');
        if (!card) return;
        const same = document.querySelector(`.dl-card[data-id="${card.dataset.id}"] .dl-log`);
        if (same && !same.open) same.open = true;
      });
    }
  } catch (e) {
    $('dl-stat').textContent = '下载中心未响应：' + e.message;
  }
}

async function loadOutputs() {
  try {
    const r = await fetch('api/hub/outputs', { cache: 'no-store' });
    const d = await r.json();
    $('dl-out-dir').textContent = d.dir || '';
    const files = d.files || [];
    const base = `${location.protocol === 'https:' ? 'https:' : 'http:'}//${location.hostname}:3090`;
    $('dl-out-list').innerHTML = files.length
      ? files.slice(0, 30).map((f) => `<a class="dl-out" href="${base}/api/download-local/${encodeURIComponent(f.name)}" title="${esc(f.name)}">${esc(f.name)}<span>${human(f.size)}</span></a>`).join('')
      : '<span class="dl-sub">暂无成品</span>';
  } catch { /* ignore */ }
}

$('dl-list').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-act]');
  if (!btn) return;
  let act = btn.dataset.act;
  const id = btn.dataset.id;
  const job = (lastJobs || []).find((x) => x.id === id);
  const b = bridge();
  if (act === 'import') {
    // 安卓外壳里：直接把成品绝对路径交给原生，用 content:// 拉起壁纸引擎
    if (!job || !job.outPath || !b) return;
    try {
      const msg = b.openMpkg(job.outPath);
      $('dl-stat').textContent = msg || '正在打开壁纸引擎…';
    } catch (e) {
      $('dl-stat').textContent = '拉起壁纸引擎失败：' + e.message;
    }
    return;
  }
  if (act === 'openfile') {
    if (!job || !job.outPath || !b || typeof b.openFile !== 'function') return;
    try {
      const msg = b.openFile(job.outPath);
      $('dl-stat').textContent = msg || '已请求系统打开';
    } catch (e) {
      $('dl-stat').textContent = '打开文件失败：' + e.message;
    }
    return;
  }
  if (act === 'relogin') {
    // 这个页面拿不到主界面的设置弹窗，直接把用户送过去
    $('dl-stat').textContent = '需要重新登录：已打开主界面的设置入口';
    window.open(mainBase() + '/?settings=account', '_blank');
    return;
  }
  if (act === 'reveal') {
    $('dl-stat').textContent = '「打开所在文件夹」只能在主界面里用';
    return;
  }
  btn.disabled = true;
  try {
    if (act === 'retry-node') {
      $('dl-stat').textContent = '正在重新测速…';
      try { await fetch('api/hub/cdn/test', { method: 'POST' }); } catch { /* 测速失败也照样重试 */ }
      act = 'retry';
    }
    const r = await fetch(`api/hub/jobs/${encodeURIComponent(id)}/${act}`, { method: 'POST' });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      $('dl-stat').textContent = j.error || ('操作失败：HTTP ' + r.status);
    }
  } catch (e) {
    $('dl-stat').textContent = '操作失败：' + e.message;
  } finally {
    btn.disabled = false;
    tick();
  }
});

$('dl-clear').addEventListener('click', async () => {
  const done = [...document.querySelectorAll('.dl-card.st-done, .dl-card.st-failed, .dl-card.st-cancelled')];
  if (!done.length) {
    $('dl-stat').textContent = '没有可清空的记录';
    return;
  }
  // WebView 里 window.confirm 是空操作（没有 WebChromeClient），所以用页内二次确认
  if (!$('dl-confirm').classList.contains('on')) {
    $('dl-confirm-text').textContent = `清空 ${done.length} 条已完成/失败记录？（不影响成品文件）`;
    $('dl-confirm').classList.add('on');
    return;
  }
});

$('dl-confirm-yes').addEventListener('click', async () => {
  $('dl-confirm').classList.remove('on');
  const cards = [...document.querySelectorAll('.dl-card.st-done, .dl-card.st-failed, .dl-card.st-cancelled')];
  for (const card of cards) {
    try { await fetch(`api/hub/jobs/${encodeURIComponent(card.dataset.id)}/forget`, { method: 'POST' }); } catch { /* ignore */ }
  }
  lastFingerprint = '';
  tick();
});
$('dl-confirm-no').addEventListener('click', () => $('dl-confirm').classList.remove('on'));

tick();
loadOutputs();
setInterval(tick, POLL_MS);
setInterval(loadOutputs, 5000);

// 触摸抬起后释放焦点（同 app.js）：避免按钮点过一直套着焦点环
document.addEventListener('touchend', () => {
  const el = document.activeElement;
  if (!el || el === document.body) return;
  const tag = (el.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  try { el.blur(); } catch { /* ignore */ }
}, { passive: true });
