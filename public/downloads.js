'use strict';
/**
 * 下载中心页面：轮询下载中心进程的 /api/hub/jobs，渲染进度条与操作。
 * 这个页面跑在独立端口（默认 3091）上，关掉主界面不影响任务。
 */

const POLL_MS = 1000;
const $ = (id) => document.getElementById(id);

const STATE_TEXT = {
  queued: '排队中',
  downloading: '下载中',
  packing: '打包中',
  done: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const PHASE_TEXT = {
  prepare: '解包与检查',
  download: '下载',
  convert: '纹理转换',
  shader: '着色器适配',
  reference: '替换参考包资源',
  write: '写入 mpkg',
  packing: '打包中',
  done: '完成',
  queued: '排队中',
};

function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 安卓外壳的原生桥：有它才能直接拉起壁纸引擎导入 */
function hasBridge() {
  return !!(window.Android && typeof window.Android.openMpkg === 'function');
}

function human(n) {
  n = Number(n) || 0;
  if (n >= 1073741824) return (n / 1073741824).toFixed(2) + ' GB';
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
  return n + ' B';
}

function secs(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  if (n <= 0) return '0s';
  if (n < 60) return Math.round(n) + 's';
  const m = Math.floor(n / 60);
  const s = Math.round(n % 60);
  return m + 'm' + (s ? s + 's' : '');
}

function phaseLabel(j) {
  const p = j.progress || {};
  const base = PHASE_TEXT[p.phase] || STATE_TEXT[j.state] || j.state;
  return p.detail && p.detail !== base ? `${base} · ${p.detail}` : base;
}

/** 进度条：有百分比画实心条，没有就画流动的不确定条 */
function barHtml(percent, cls = '') {
  if (percent === null || percent === undefined) {
    return `<div class="bar indeterminate ${cls}"><i></i></div>`;
  }
  return `<div class="bar ${cls}"><i style="width:${Math.max(1, Math.min(100, percent))}%"></i></div>`;
}

function stateClass(state) {
  return `st-${state}`;
}

function renderJob(j) {
  const p = j.progress || {};
  const isRun = j.state === 'downloading' || j.state === 'packing' || j.state === 'queued';
  const percent = j.state === 'done' ? 100 : (p.percent === undefined ? null : p.percent);
  const meta = [];
  if (p.total) meta.push(`${human(p.bytes || 0)} / ${human(p.total)}`);
  else if (p.bytes) meta.push(human(p.bytes));
  if (isRun && p.speed) meta.push(`${human(p.speed)}/s`);
  if (isRun && p.eta) meta.push(`剩 ${secs(p.eta)}`);
  if (p.phase === 'convert' && p.total) meta.push(`${p.done || 0}/${p.total} 张`);
  if (j.size && j.state === 'done') meta.push(human(j.size));
  if (j.result && j.result.type) meta.push(j.result.type);

  const actions = [];
  if (isRun) actions.push(`<button class="ghost" data-act="cancel" data-id="${esc(j.id)}">取消</button>`);
  if (j.state === 'failed' || j.state === 'cancelled') actions.push(`<button class="ghost" data-act="retry" data-id="${esc(j.id)}">重试</button>`);
  if (j.state === 'done' && hasBridge() && j.outPath) actions.push(`<button class="ghost small" data-act="import" data-id="${esc(j.id)}">导入壁纸引擎</button>`);
  else if (j.state === 'done' && j.outFile) actions.push(`<a class="download small" href="api/hub/file/${encodeURIComponent(j.id)}">保存 .mpkg</a>`);
  if (j.state === 'done' && j.rawDir) actions.push(`<span class="dl-path" title="${esc(j.rawDir)}">已下载：${esc(j.rawDir)}</span>`);

  const tex = j.result && j.result.tex;
  const extra = [];
  if (tex && (tex.converted || tex.downsampled)) {
    extra.push(`纹理 ${tex.converted} 转换${tex.downsampled ? `（降采样 ${tex.downsampled}）` : ''}`);
  }
  if (j.result && j.result.audio && j.result.audio.removed) extra.push(`音频剥离 ${j.result.audio.removed}`);
  if (j.result && j.result.shader && j.result.shader.rewritten) extra.push(`着色器改写 ${j.result.shader.rewritten}`);

  const warnings = j.result && j.result.warnings && j.result.warnings.length
    ? `<div class="dl-warn">⚠ ${esc(j.result.warnings.slice(0, 3).join('；'))}${j.result.warnings.length > 3 ? ' …' : ''}</div>` : '';
  const err = j.error ? `<div class="dl-err">✘ ${esc(j.error)}</div>` : '';

  return `
    <article class="dl-card ${stateClass(j.state)}" data-id="${esc(j.id)}">
      <div class="dl-card-head">
        <div class="dl-card-title">
          <span class="st ${stateClass(j.state)}">${esc(STATE_TEXT[j.state] || j.state)}</span>
          <strong>${esc(j.title)}</strong>
          <span class="dl-sub">#${esc(j.itemId)}</span>
        </div>
        <div class="dl-card-actions">${actions.join('')}</div>
      </div>
      <div class="dl-phase"><span>${esc(phaseLabel(j))}</span><span class="dl-pct">${percent === null ? '' : percent + '%'}</span></div>
      ${barHtml(percent)}
      <div class="dl-meta">${esc(meta.join(' · '))}</div>
      ${err}${warnings}
      ${extra.length ? `<div class="dl-meta">${esc(extra.join(' · '))}</div>` : ''}
      ${j.log && j.log.length ? `<details class="dl-log"><summary>日志（${j.log.length} 行）</summary><pre>${esc(j.log.join('\n'))}</pre></details>` : ''}
    </article>`;
}

let lastFingerprint = '';
let lastJobs = [];

function fingerprint(jobs) {
  return JSON.stringify(jobs.map((j) => [j.id, j.state, j.progress && j.progress.percent, j.progress && j.progress.bytes, j.error, j.log && j.log.length]));
}

async function tick() {
  try {
    const r = await fetch('api/hub/jobs', { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    const jobs = data.jobs || [];
    lastJobs = jobs;
    const fp = fingerprint(jobs);
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
    $('dl-out-list').innerHTML = files.length
      ? files.slice(0, 30).map((f) => `<a class="dl-out" href="http://localhost:3090/api/download-local/${encodeURIComponent(f.name)}" title="${esc(f.name)}">${esc(f.name)}<span>${human(f.size)}</span></a>`).join('')
      : '<span class="dl-sub">暂无成品</span>';
  } catch { /* ignore */ }
}

$('dl-list').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-act]');
  if (!btn) return;
  const { act, id } = btn.dataset;
  if (act === 'import') {
    // 安卓外壳里：直接把成品绝对路径交给原生，用 content:// 拉起壁纸引擎
    const job = (lastJobs || []).find((x) => x.id === id);
    if (!job || !job.outPath) return;
    try {
      const msg = window.Android.openMpkg(job.outPath);
      $('dl-stat').textContent = msg || '正在打开壁纸引擎…';
    } catch (e) {
      $('dl-stat').textContent = '拉起壁纸引擎失败：' + e.message;
    }
    return;
  }
  btn.disabled = true;
  try {
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
