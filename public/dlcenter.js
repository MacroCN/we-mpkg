'use strict';
/**
 * 下载中心浮层（App 内悬浮窗）
 * - 不跳页：主界面原地弹出，关掉浮层下载照跑（任务在独立进程/内嵌 hub 里）
 * - 可拖动、可折叠回顶栏的常驻任务条
 * - 安卓外壳下成品按钮是「导入壁纸引擎 / 打开文件」，桌面端是「保存 .mpkg / 打开所在文件夹」
 * - 状态文案、meta、动作按钮全部来自 joblib.js，和独立下载中心页共用一套判定
 */

(function () {
  const J = window.WE_JOBS;
  const api = (p, opt) => fetch(p, Object.assign({ cache: 'no-store' }, opt || {}));
  const POLL_OPEN = 1000;
  const POLL_IDLE = 4000;
  const POLL_BUSY = 2000;
  const POS_KEY = 'dlcPos';

  let panel, list, stat, foot, confirmBar, confirmText;
  let hubBtn, hubCount, hubPct, hubBar;
  let jobs = [];
  let timer = null;
  let open = false;
  let busyClear = false;

  const isZh = () => J.isZh();
  const t = (zh, en) => (isZh() ? zh : en);

  function bridge() {
    if (!window.Android) return null;
    if (typeof window.Android.openMpkg !== 'function' && typeof window.Android.openFile !== 'function') return null;
    return window.Android;
  }

  // ---------- 渲染 ----------
  function actionHtml(a) {
    const cls = [a.primary ? 'primary-act' : '', a.growEnd ? 'grow-end' : ''].filter(Boolean).join(' ');
    const common = `class="${cls}" data-act="${a.act}" data-id="${J.esc(a.id)}"`;
    if (a.act === 'save') {
      // 主页面必须走主服务的 /api/file/<id> 转发；下载中心端口上的相对路径在这里会 404
      return `<a ${common} href="/api/file/${encodeURIComponent(a.id)}" download>${J.esc(a.label)}</a>`;
    }
    return `<button ${common}>${J.esc(a.label)}</button>`;
  }

  function renderJob(j) {
    const v = J.view(j, { bridge: bridge(), reveal: true, zh: isZh(), fileBase: '/api/file/' });
    v.actions.forEach((a) => { a.id = j.id; });
    const acts = v.actions.map(actionHtml);
    const err = v.error ? `<div class="dlc-err">✘ ${J.esc(v.error)}${v.errorText ? ` · ${J.esc(v.errorText)}` : ''}</div>` : '';
    const warn = v.warnings.length ? `<div class="dlc-warn">⚠ ${J.esc(v.warnings.slice(0, 2).join('；'))}</div>` : '';
    return `
      <div class="dlc-job st-${J.esc(v.state)}" data-id="${J.esc(v.id)}">
        <div class="row1">
          <span class="badge">${J.esc(v.badge)}</span>
          <strong title="${J.esc(v.title)}">${J.esc(v.title)}</strong>
          <span class="id">#${J.esc(v.itemId)}</span>
        </div>
        <div class="dlc-phase"><span>${J.esc(v.phase)}</span><span class="pct">${v.pct === null ? '' : v.pct + '%'}</span></div>
        ${v.bar}
        <div class="dlc-meta">${J.esc(v.metaText)}</div>
        ${err}${warn}
        <div class="dlc-acts">${acts.join('')}</div>
      </div>`;
  }

  /** 顶栏常驻任务条：运行数 + 总体进度，关掉浮层也看得到 */
  function renderPill() {
    if (!hubBtn) return;
    const agg = J.aggregate(jobs);
    hubBtn.classList.toggle('busy', agg.running > 0);
    hubBtn.classList.toggle('has-tasks', jobs.length > 0);
    if (hubCount) {
      hubCount.textContent = agg.running
        ? (agg.queued ? `${agg.running}+${agg.queued}` : String(agg.running))
        : '';
      hubCount.classList.toggle('hidden', !agg.running);
    }
    if (hubPct) {
      hubPct.textContent = agg.running ? (agg.pct === null ? t('进行中', 'busy') : `${agg.pct}%`) : '';
      hubPct.classList.toggle('hidden', !agg.running);
    }
    if (hubBar) {
      const wrap = hubBar.parentElement;
      if (wrap) wrap.classList.toggle('indeterminate', agg.running > 0 && agg.pct === null);
      hubBar.style.width = agg.pct === null ? '0%' : `${Math.max(2, Math.min(100, agg.pct))}%`;
    }
    const label = agg.running
      ? t(`${agg.running} 个任务进行中${agg.queued ? `，${agg.queued} 个排队` : ''}`, `${agg.running} running${agg.queued ? `, ${agg.queued} queued` : ''}`)
      : t('下载中心', 'Downloads');
    hubBtn.setAttribute('title', label);
    hubBtn.setAttribute('aria-label', label);
  }

  function render() {
    const agg = J.aggregate(jobs);
    if (stat) stat.textContent = `${agg.running}/${(jobs.maxConcurrent || 3)} ${t('并发', 'in parallel')} · ${t('共', 'total')} ${jobs.length}`;
    renderPill();

    // 列表（交互中不整块重建，避免拖拽/点击被打断）
    if (list && document.activeElement !== list) {
      if (!jobs.length) {
        list.innerHTML = `<div class="dlc-empty">${t('还没有任务。在壁纸详情页点「下载并打包」，或在卡片上点「直接下载」就会出现在这里，关掉浮层也不会中断。', 'No tasks yet. Start one from an item page or straight from a card — downloads keep running when this panel is closed.')}</div>`;
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
    const agg = J.aggregate(jobs);
    const delay = open ? POLL_OPEN : (agg.running ? POLL_BUSY : (jobs.length ? POLL_IDLE : 6000));
    timer = setTimeout(poll, delay);
  }

  // ---------- 事件流（SSE） ----------
  // 有 EventSource 时用它接收推送（服务端按 400ms 节流），推流断开才退回轮询，
  // 避免每秒一次空查询，也避免「页面关了轮询还在跑」这类生命周期问题。
  let es = null;

  function stopLoop() {
    if (timer) { clearTimeout(timer); timer = null; }
  }

  function startLoop() {
    if (timer) return;
    schedule();
  }

  function applyPayload(d) {
    if (!d || !Array.isArray(d.jobs)) return;
    jobs = d.jobs;
    jobs.maxConcurrent = d.maxConcurrent;
    render();
  }

  function connectSse() {
    if (es || typeof EventSource === 'undefined') return;
    try {
      es = new EventSource('api/events');
    } catch {
      es = null;
      return;
    }
    es.onopen = () => { stopLoop(); };
    es.onmessage = (ev) => {
      try { applyPayload(JSON.parse(ev.data)); } catch { /* 半截数据包忽略，等下一帧 */ }
    };
    es.onerror = () => {
      // EventSource 会自动重连；这期间恢复轮询兜底，别让界面卡死
      startLoop();
      // 断线太久（CLOSED 状态）就重建，避免浏览器放弃后永久静默
      if (es && es.readyState === 2) {
        try { es.close(); } catch { /* ignore */ }
        es = null;
        setTimeout(connectSse, 3000);
      }
    };
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
    // SSE 已连上就不要再排下一次轮询；只有断流时才继续兜底
    if (es && es.readyState === 1) stopLoop();
    else schedule();
  }

  // ---------- 拖动 ----------
  function viewport() {
    const de = document.documentElement;
    const iw = window.innerWidth || (de && de.clientWidth) || 0;
    const ih = window.innerHeight || (de && de.clientHeight) || 0;
    const vv = window.visualViewport;
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
      // 「换节点重试」：先强制重测所有节点（排序结果落到 .cache，下载层下次就按新顺序走），再重排队
      if (act === 'retry-node') {
        toastInline(t('正在重新测速并重排队…', 'Re-testing nodes, then retrying…'));
        try { await api('api/cdn/test', { method: 'POST' }); } catch { /* 测速失败也照样重试 */ }
        const r = await api(`api/jobs/${encodeURIComponent(id)}/retry`, { method: 'POST' });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          toastInline(j.error || 'HTTP ' + r.status);
        }
      } else if (act === 'forget') {
        await api(`api/jobs/${encodeURIComponent(id)}/forget`, { method: 'POST' });
      } else if (act === 'cancel' || act === 'retry' || act === 'pause' || act === 'resume') {
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
    foot.innerHTML = `<span style="color:var(--err)">${J.esc(msg)}</span>`;
    setTimeout(() => { if (foot) render(); }, 3000);
  }

  function importMpkg(id) {
    const j = jobs.find((x) => x.id === id);
    const b = bridge();
    if (!b || typeof b.openMpkg !== 'function') return;
    const path = j && j.outPath;
    if (!path) { toastInline(t('拿不到成品路径', 'No output path')); return; }
    try {
      const msg = b.openMpkg(path);
      toastInline(msg || t('正在打开壁纸引擎…', 'Opening Wallpaper Engine…'));
    } catch (e) {
      toastInline(t('拉起壁纸引擎失败：', 'Failed to open WE: ') + e.message);
    }
  }

  /** 原始资源包不是 mpkg：交给系统按文件类型打开（zip 一般是文件管理器 / 解压工具） */
  function openFile(id) {
    const j = jobs.find((x) => x.id === id);
    const b = bridge();
    if (!b || typeof b.openFile !== 'function') return;
    const path = j && j.outPath;
    if (!path) { toastInline(t('拿不到成品路径', 'No output path')); return; }
    try {
      const msg = b.openFile(path);
      toastInline(msg || t('已请求系统打开', 'Asking the system to open it'));
    } catch (e) {
      toastInline(t('打开文件失败：', 'Failed to open file: ') + e.message);
    }
  }

  /** 桌面端：让服务端在该文件所在的文件夹里定位它（Windows 是资源管理器选中） */
  async function reveal(id) {
    const j = jobs.find((x) => x.id === id);
    if (!j || !j.outPath) { toastInline(t('拿不到成品路径', 'No output path')); return; }
    try {
      const r = await api('api/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: j.outPath }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) toastInline(d.error || ('HTTP ' + r.status));
      else toastInline(t('已打开所在文件夹', 'Opened the containing folder'));
    } catch (e) {
      toastInline(t('打开文件夹失败：', 'Failed to reveal: ') + e.message);
    }
  }

  /** 失败是因为掉登录：直接把用户带到登录入口，不用读文案猜 */
  function relogin() {
    if (window.WE_APP && typeof window.WE_APP.openSettings === 'function') {
      closePanel();
      window.WE_APP.openSettings('account');
      return;
    }
    if (window.Android && typeof window.Android.openSetup === 'function') {
      closePanel();
      window.Android.openSetup();
      return;
    }
    toastInline(t('请在主界面右上角 ⚙ 重新登录', 'Sign in again from the ⚙ settings on the main page'));
  }

  // 清空历史（页内二次确认，不依赖 window.confirm）
  function askClear() {
    const ended = jobs.filter(J.isEnded);
    if (!ended.length) { toastInline(t('没有可清空的历史', 'Nothing to clear')); return; }
    if (!confirmBar) return;
    confirmBar.classList.add('on');
    if (confirmText) confirmText.textContent = t(`清空 ${ended.length} 条已完成/失败记录？（不影响成品文件）`, `Remove ${ended.length} finished records? (output files stay)`);
  }

  async function doClear() {
    if (busyClear) return;
    busyClear = true;
    const ended = jobs.filter(J.isEnded);
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
      panel.classList.add('on');
      restorePos();
      reflowPos();
    }
    notifyAndroid(true);
    poll();
  }

  function closePanel() {
    open = false;
    if (panel) panel.classList.remove('on');
    if (confirmBar) confirmBar.classList.remove('on');
    notifyAndroid(false);
    render();
    // SSE 连着就不用再排轮询；断流时 schedule 会继续兜底
    if (!(es && es.readyState === 1)) schedule();
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
    // 触摸被系统/其它手势抢走时不会来 pointerup，捕获一丢就收手，
    // 否则 drag 残留，面板会一直跟着之后的手指走
    head.addEventListener('lostpointercapture', onHeadUp);

    panel.querySelector('#dlc-min').addEventListener('click', closePanel);
    panel.querySelector('#dlc-close').addEventListener('click', closePanel);
    panel.querySelector('#dlc-clear').addEventListener('click', askClear);
    panel.querySelector('#dlc-confirm-no').addEventListener('click', () => confirmBar.classList.remove('on'));
    panel.querySelector('#dlc-confirm-yes').addEventListener('click', doClear);

    list.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-act]');
      if (!btn) return;
      const { act, id } = btn.dataset;
      if (act === 'import') { importMpkg(id); return; }
      if (act === 'openfile') { openFile(id); return; }
      if (act === 'reveal') { reveal(id); return; }
      if (act === 'relogin') { relogin(); return; }
      jobAction(id, act);
    });

    const onViewportChange = () => reflowPos();
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('orientationchange', () => setTimeout(() => reflowPos(), 260));
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onViewportChange);

    render();
  }

  function init() {
    hubBtn = document.getElementById('hubBtn');
    if (hubBtn) {
      hubCount = hubBtn.querySelector('#hubCount');
      hubPct = hubBtn.querySelector('#hubPct');
      hubBar = hubBtn.querySelector('#hubBar');
      hubBtn.addEventListener('click', toggle);
    }
    build();
    // 先拉一次现状（任务条立刻有数），随后交给 SSE 推流；EventSource 不可用时保留轮询兜底
    schedule();
    connectSse();
    // 首次进页面：如果后台已有任务，任务条立刻反映出来；带 ?dlc=1 直接展开浮层
    window.WE_DLC = {
      open: openPanel,
      close: closePanel,
      toggle,
      isOpen: () => open,
      refresh: poll,
      notifyJobAdded: () => { poll(); openPanel(); },
      // 卡片「直接下载」用：只刷新任务条，不弹面板打断浏览
      notifyQueued: () => { poll(); },
    };
    if (/[?&]dlc=1(&|$)/.test(location.search)) openPanel();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
