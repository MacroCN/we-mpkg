'use strict';
/**
 * 下载中心浮层（App 内悬浮窗）
 * - 不跳页：主界面原地弹出，关掉浮层下载照跑（任务在独立进程/内嵌 hub 里）
 * - 可拖动、可折叠成右下角的小药丸
 * - 安卓外壳下成品按钮是「导入壁纸引擎」，桌面端是「保存 .mpkg」
 * - 清空历史用页内二次确认（WebView 里 window.confirm 是空操作，不能靠它）
 */

(function () {
  const api = (p, opt) => fetch(p, Object.assign({ cache: 'no-store' }, opt || {}));
  const POLL_OPEN = 1000;
  const POLL_PILL = 3000;
  const POS_KEY = 'dlcPos';

  const STATE_TEXT = {
    queued: '排队中', downloading: '下载中', packing: '打包中',
    done: '完成', failed: '失败', cancelled: '取消',
  };
  const STATE_TEXT_EN = {
    queued: 'Queued', downloading: 'Downloading', packing: 'Packing',
    done: 'Done', failed: 'Failed', cancelled: 'Cancelled',
  };
  const PHASE_TEXT = {
    prepare: '解包检查', download: '下载', convert: '纹理转换', shader: '着色器适配',
    reference: '替换资源', write: '写入 mpkg', packing: '打包', done: '完成', queued: '排队',
  };
  const PHASE_TEXT_EN = {
    prepare: 'Unpack', download: 'Download', convert: 'Textures', shader: 'Shaders',
    reference: 'Resources', write: 'Write mpkg', packing: 'Pack', done: 'Done', queued: 'Queued',
  };

  let panel, pill, list, stat, foot, confirmBar, confirmText;
  let jobs = [];
  let timer = null;
  let open = false;
  let busyClear = false;

  const isZh = () => /^zh/i.test(document.documentElement.lang || 'zh');
  const t = (zh, en) => (isZh() ? zh : en);

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function human(n) {
    n = Number(n) || 0;
    if (n >= 1073741824) return (n / 1073741824).toFixed(2) + ' GB';
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
    return n + ' B';
  }
  function secs(n) {
    if (!Number.isFinite(n) || n <= 0) return '';
    if (n < 60) return Math.round(n) + 's';
    const m = Math.floor(n / 60), s = Math.round(n % 60);
    return m + 'm' + (s ? s + 's' : '');
  }
  function isRun(j) {
    return j.state === 'queued' || j.state === 'downloading' || j.state === 'packing';
  }
  function isEnded(j) {
    return j.state === 'done' || j.state === 'failed' || j.state === 'cancelled';
  }
  function bridge() {
    if (!window.Android) return null;
    if (typeof window.Android.openMpkg !== 'function') return null;
    return window.Android;
  }
  function stateText(s) {
    return (isZh() ? STATE_TEXT[s] : STATE_TEXT_EN[s]) || s;
  }
  function phaseText(p) {
    if (!p || !p.phase) return '';
    return (isZh() ? PHASE_TEXT[p.phase] : PHASE_TEXT_EN[p.phase]) || p.phase;
  }
  function percentOf(j) {
    if (j.state === 'done') return 100;
    const p = j.progress || {};
    return p.percent === undefined || p.percent === null ? null : p.percent;
  }
  function barHtml(pct) {
    if (pct === null) return '<div class="bar indeterminate"><i></i></div>';
    return `<div class="bar"><i style="width:${Math.max(1, Math.min(100, pct))}%"></i></div>`;
  }

  // ---------- 渲染 ----------
  function renderJob(j) {
    const p = j.progress || {};
    const pct = percentOf(j);
    const run = isRun(j);
    const meta = [];
    if (j.state === 'done' && j.size) meta.push(human(j.size));
    if (p.total) meta.push(`${human(p.bytes || 0)} / ${human(p.total)}`);
    else if (p.bytes) meta.push(human(p.bytes));
    if (run && p.speed) meta.push(`${human(p.speed)}/s`);
    if (run && p.eta) meta.push(t(`剩 ${secs(p.eta)}`, `${secs(p.eta)} left`));
    if (p.phase === 'convert' && p.total) meta.push(`${p.done || 0}/${p.total} ${t('张', 'tex')}`);
    if (j.result && j.result.type) meta.push(j.result.type);
    if (j.rawDir) meta.push(t('原始文件', 'raw files'));

    const acts = [];
    if (run) acts.push(`<button data-act="cancel" data-id="${esc(j.id)}">${t('取消', 'Cancel')}</button>`);
    if (j.state === 'failed' || j.state === 'cancelled') {
      acts.push(`<button data-act="retry" data-id="${esc(j.id)}">${t('重试', 'Retry')}</button>`);
    }
    if (j.state === 'done') {
      const b = bridge();
      if (b && j.outPath) {
        acts.push(`<button class="primary-act" data-act="import" data-id="${esc(j.id)}">${t('导入壁纸引擎', 'Import to WE')}</button>`);
      } else if (j.outFile) {
        acts.push(`<a class="primary-act" href="api/hub/file/${encodeURIComponent(j.id)}" download>${t('保存 .mpkg', 'Save .mpkg')}</a>`);
      }
      if (j.outFile && !j.rawDir) acts.push(`<span class="tag">${esc(j.outFile)}</span>`);
    }
    if (isEnded(j)) acts.push(`<button class="grow-end" data-act="forget" data-id="${esc(j.id)}">${t('移除', 'Remove')}</button>`);

    const phase = [phaseText(p), p.detail].filter(Boolean).join(' · ');
    const err = j.error ? `<div class="dlc-err">✘ ${esc(j.error)}</div>` : '';
    const warn = j.result && j.result.warnings && j.result.warnings.length
      ? `<div class="dlc-warn">⚠ ${esc(j.result.warnings.slice(0, 2).join('；'))}</div>` : '';

    return `
      <div class="dlc-job st-${esc(j.state)}" data-id="${esc(j.id)}">
        <div class="row1">
          <span class="badge">${esc(stateText(j.state))}</span>
          <strong title="${esc(j.title)}">${esc(j.title)}</strong>
          <span class="id">#${esc(j.itemId)}</span>
        </div>
        <div class="dlc-phase"><span>${esc(phase)}</span><span class="pct">${pct === null ? '' : pct + '%'}</span></div>
        ${barHtml(pct)}
        <div class="dlc-meta">${esc(meta.join(' · '))}</div>
        ${err}${warn}
        <div class="dlc-acts">${acts.join('')}</div>
      </div>`;
  }

  function render() {
    const running = jobs.filter(isRun).length;
    const total = jobs.length;
    const stats = `${running}/${(jobs.maxConcurrent || 3)} ${t('并发', 'in parallel')} · ${t('共', 'total')} ${total}`;
    if (stat) stat.textContent = stats;

    // 药丸
    if (pill) {
      const active = running > 0;
      pill.classList.toggle('on', !open && (total > 0 || active));
      pill.classList.toggle('idle', !active);
      const txt = active
        ? `<span class="n"><b>${running}</b> ${t('个下载中', 'running')}</span>`
        : `<span class="n">${t('下载中心', 'Downloads')}${total ? ` · ${total}` : ''}</span>`;
      pill.innerHTML = `<span class="dot"></span>${txt}`;
    }

    // 列表（交互中不整块重建，避免拖拽/点击被打断）
    if (list && document.activeElement !== list) {
      if (!total) {
        list.innerHTML = `<div class="dlc-empty">${t('还没有任务。在壁纸详情页点「下载并打包」就会出现在这里，关掉浮层也不会中断。', 'No tasks yet. Start one from an item page — downloads keep running when this panel is closed.')}</div>`;
      } else {
        list.innerHTML = jobs.map(renderJob).join('');
      }
    }
    if (foot) {
      foot.innerHTML = `<span>${t('任务跑在后台进程，关掉这个浮层也不会中断', 'Runs in a background process — closing this panel is safe')}</span>`;
    }
    // 任务增减会改变面板高度，已拖动的面板要重新夹回可见范围
    if (open && isPositioned()) reflowPos(false);
  }

  function schedule() {
    if (timer) { clearTimeout(timer); timer = null; }
    const delay = open ? POLL_OPEN : (jobs.length ? POLL_PILL : 4000);
    timer = setTimeout(poll, delay);
  }

  async function poll() {
    timer = null;
    try {
      const r = await api('api/jobs');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      jobs = d.jobs || [];
      jobs.maxConcurrent = d.maxConcurrent;
      render();
    } catch (e) {
      if (stat) stat.textContent = t('下载中心未响应：', 'Hub error: ') + e.message;
    }
    schedule();
  }

  // ---------- 拖动 ----------
  function viewport() {
    const de = document.documentElement;
    const iw = window.innerWidth || (de && de.clientWidth) || 0;
    const ih = window.innerHeight || (de && de.clientHeight) || 0;
    const vv = window.visualViewport;
    // 取较小者：软键盘/缩放时也保证面板不被裁掉；不用 offsetTop/Left，避免缩放时整体位移
    return {
      w: Math.round(vv && vv.width ? Math.min(iw, vv.width) : iw),
      h: Math.round(vv && vv.height ? Math.min(ih, vv.height) : ih),
    };
  }

  /** 面板隐藏（display:none）时 offsetWidth/Height 是 0，按 CSS 上限兜个底，避免把坐标算到屏幕外 */
  function panelSize() {
    const vp = viewport();
    return {
      vp,
      w: panel.offsetWidth || Math.min(420, vp.w - 24),
      h: panel.offsetHeight || Math.min(vp.h * 0.66, 560),
    };
  }

  function clampPos(x, y) {
    const { vp, w, h } = panelSize();
    const pad = 8;
    const maxX = Math.max(pad, vp.w - w - pad);
    const maxY = Math.max(pad, vp.h - h - pad);
    const topLimit = Math.min(pad + (window.__dlcTopInset || 0), maxY);
    return {
      x: Math.min(Math.max(x, pad), maxX),
      y: Math.min(Math.max(y, topLimit), maxY),
    };
  }

  function isPositioned() {
    return !!panel.style.left && panel.style.left !== 'auto';
  }

  function applyPos(x, y) {
    const p = clampPos(x, y);
    panel.style.left = p.x + 'px';
    panel.style.top = p.y + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    return p;
  }

  /** 视口/内容高度变了以后，把已拖动的面板重新夹回可见区域 */
  function reflowPos(save) {
    if (!open || !isPositioned()) return;
    const p = applyPos(panel.offsetLeft, panel.offsetTop);
    if (save !== false) {
      try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch { /* ignore */ }
    }
  }

  function restorePos() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); } catch { /* ignore */ }
    if (!saved || typeof saved.x !== 'number' || typeof saved.y !== 'number') {
      // 默认右下角
      panel.style.left = 'auto';
      panel.style.top = 'auto';
      panel.style.right = '12px';
      panel.style.bottom = `calc(12px + env(safe-area-inset-bottom))`;
      return;
    }
    applyPos(saved.x, saved.y);
  }

  let drag = null;
  function onHeadDown(ev) {
    if (ev.target.closest('button')) return;
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    const rect = panel.getBoundingClientRect();
    drag = { dx: ev.clientX - rect.left, dy: ev.clientY - rect.top };
    // 捕获在按下头的那个元素上（挂到 panel 上会让 head 收不到后续 move）
    try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
    ev.preventDefault();
  }
  function onHeadMove(ev) {
    if (!drag) return;
    applyPos(ev.clientX - drag.dx, ev.clientY - drag.dy);
  }
  function onHeadUp() {
    if (!drag) return;
    drag = null;
    try {
      localStorage.setItem(POS_KEY, JSON.stringify({ x: panel.offsetLeft, y: panel.offsetTop }));
    } catch { /* ignore */ }
  }

  // ---------- 动作 ----------
  async function jobAction(id, act) {
    const btn = list && list.querySelector(`button[data-act="${act}"][data-id="${id}"]`);
    if (btn) btn.disabled = true;
    try {
      if (act === 'forget') {
        await api(`api/jobs/${encodeURIComponent(id)}/forget`, { method: 'POST' });
      } else if (act === 'cancel' || act === 'retry') {
        const r = await api(`api/jobs/${encodeURIComponent(id)}/${act}`, { method: 'POST' });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          toastInline(j.error || 'HTTP ' + r.status);
        }
      }
    } catch (e) {
      toastInline(e.message);
    } finally {
      await poll();
    }
  }

  function toastInline(msg) {
    if (!foot) return;
    foot.innerHTML = `<span style="color:var(--err)">${esc(msg)}</span>`;
    setTimeout(() => { if (foot) render(); }, 3000);
  }

  function importMpkg(id) {
    const j = jobs.find((x) => x.id === id);
    const b = bridge();
    if (!b) return;
    const path = j && j.outPath;
    if (!path) { toastInline(t('拿不到成品路径', 'No output path')); return; }
    try {
      const msg = b.openMpkg(path);
      toastInline(msg || t('正在打开壁纸引擎…', 'Opening Wallpaper Engine…'));
    } catch (e) {
      toastInline(t('拉起壁纸引擎失败：', 'Failed to open WE: ') + e.message);
    }
  }

  // 清空历史（页内二次确认，不依赖 window.confirm）
  function askClear() {
    const ended = jobs.filter(isEnded);
    if (!ended.length) { toastInline(t('没有可清空的历史', 'Nothing to clear')); return; }
    if (!confirmBar) return;
    confirmBar.classList.add('on');
    if (confirmText) confirmText.textContent = t(`清空 ${ended.length} 条已完成/失败记录？（不影响成品文件）`, `Remove ${ended.length} finished records? (output files stay)`);
  }

  async function doClear() {
    if (busyClear) return;
    busyClear = true;
    const ended = jobs.filter(isEnded);
    for (const j of ended) {
      try { await api(`api/jobs/${encodeURIComponent(j.id)}/forget`, { method: 'POST' }); } catch { /* ignore */ }
    }
    busyClear = false;
    if (confirmBar) confirmBar.classList.remove('on');
    await poll();
  }

  // ---------- 开关 ----------
  function notifyAndroid(v) {
    try {
      if (window.Android && typeof window.Android.setDownloadsOpen === 'function') {
        window.Android.setDownloadsOpen(!!v);
      }
    } catch { /* ignore */ }
  }

  function openPanel() {
    open = true;
    if (panel) {
      // 先显示再量尺寸：隐藏状态下尺寸为 0，先 clamp 会把面板算到屏幕外
      panel.classList.add('on');
      restorePos();
      reflowPos();
    }
    if (pill) pill.classList.remove('on');
    notifyAndroid(true);
    poll();
  }

  function closePanel() {
    open = false;
    if (panel) panel.classList.remove('on');
    if (confirmBar) confirmBar.classList.remove('on');
    notifyAndroid(false);
    render();
    schedule();
  }

  function toggle() {
    if (open) closePanel(); else openPanel();
  }

  // ---------- 初始化 ----------
  function build() {
    panel = document.createElement('div');
    panel.id = 'dlc-panel';
    panel.innerHTML = `
      <div class="dlc-head" id="dlc-head">
        <div class="dlc-title">${t('下载中心', 'Downloads')}<span class="stat" id="dlc-stat"></span></div>
        <button id="dlc-clear" title="${t('清空已完成记录', 'Clear finished')}">${t('清空', 'Clear')}</button>
        <button id="dlc-min" title="${t('收起', 'Minimize')}">—</button>
        <button class="dlc-x" id="dlc-close" title="${t('关闭', 'Close')}">×</button>
      </div>
      <div class="dlc-body" id="dlc-list"></div>
      <div class="dlc-confirm" id="dlc-confirm">
        <span id="dlc-confirm-text"></span>
        <button class="danger" id="dlc-confirm-yes">${t('清空', 'Clear')}</button>
        <button id="dlc-confirm-no">${t('取消', 'Cancel')}</button>
      </div>
      <div class="dlc-foot" id="dlc-foot"></div>`;
    document.body.appendChild(panel);

    pill = document.createElement('div');
    pill.id = 'dlc-pill';
    document.body.appendChild(pill);

    list = panel.querySelector('#dlc-list');
    stat = panel.querySelector('#dlc-stat');
    foot = panel.querySelector('#dlc-foot');
    confirmBar = panel.querySelector('#dlc-confirm');
    confirmText = panel.querySelector('#dlc-confirm-text');

    const head = panel.querySelector('#dlc-head');
    head.addEventListener('pointerdown', onHeadDown);
    head.addEventListener('pointermove', onHeadMove);
    head.addEventListener('pointerup', onHeadUp);
    head.addEventListener('pointercancel', onHeadUp);

    panel.querySelector('#dlc-min').addEventListener('click', closePanel);
    panel.querySelector('#dlc-close').addEventListener('click', closePanel);
    panel.querySelector('#dlc-clear').addEventListener('click', askClear);
    panel.querySelector('#dlc-confirm-no').addEventListener('click', () => confirmBar.classList.remove('on'));
    panel.querySelector('#dlc-confirm-yes').addEventListener('click', doClear);
    pill.addEventListener('click', openPanel);

    list.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-act]');
      if (!btn) return;
      const { act, id } = btn.dataset;
      if (act === 'import') { importMpkg(id); return; }
      jobAction(id, act);
    });

    const onViewportChange = () => reflowPos();
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('orientationchange', () => setTimeout(() => reflowPos(), 260));
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onViewportChange);

    render();
  }

  function init() {
    build();
    schedule();
    // 首次进页面：如果后台已有任务，直接把药丸露出来；带 ?dlc=1 直接展开浮层
    window.WE_DLC = {
      open: openPanel,
      close: closePanel,
      toggle,
      isOpen: () => open,
      refresh: poll,
      notifyJobAdded: () => { openPanel(); },
    };
    if (/[?&]dlc=1(&|$)/.test(location.search)) openPanel();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
