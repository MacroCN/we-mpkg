'use strict';
/**
 * 下载任务列表的公共实现。
 * 之前 public/dlcenter.js（页内浮层）和 public/downloads.js（独立下载中心页）各写了一套
 * 「状态文案 / 阶段文案 / meta / 动作按钮 / 重绘指纹」，两套判定一旦漂移就会出现
 * 「明明暂停了却还显示下载中」这类 bug（暂停指纹漏判就是其中一个）。
 * 这里只保留一份纯函数：两边都按 view(job) 的输出去画自己的 DOM。
 *
 * 注意：这是给浏览器用的脚本，不依赖 DOM，也不做请求，方便直接单测/断言。
 */
(function (global) {
  const STATE_TEXT = {
    zh: { queued: '排队中', downloading: '下载中', packing: '打包中', done: '完成', failed: '失败', cancelled: '取消' },
    en: { queued: 'Queued', downloading: 'Downloading', packing: 'Packing', done: 'Done', failed: 'Failed', cancelled: 'Cancelled' },
  };
  const PHASE_TEXT = {
    zh: {
      prepare: '解包检查', download: '下载', convert: '纹理转换', shader: '着色器适配',
      reference: '替换资源', rawexport: '导出资源', webexport: '导出网页包',
      write: '写入 mpkg', packing: '打包', done: '完成', queued: '排队',
    },
    en: {
      prepare: 'Unpack', download: 'Download', convert: 'Textures', shader: 'Shaders',
      reference: 'Resources', rawexport: 'Export assets', webexport: 'Export web',
      write: 'Write mpkg', packing: 'Pack', done: 'Done', queued: 'Queued',
    },
  };
  const ERR_TEXT = {
    zh: { auth: '需要重新登录 Steam', network: '网络/节点问题', busy: '同一条目已有任务', other: '打包失败' },
    en: { auth: 'Steam sign-in needed', network: 'Network / node issue', busy: 'Item already queued', other: 'Packing failed' },
  };

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
    return !!j && (j.state === 'queued' || j.state === 'downloading' || j.state === 'packing');
  }
  function isEnded(j) {
    return !!j && (j.state === 'done' || j.state === 'failed' || j.state === 'cancelled');
  }
  function isZh(opts) {
    if (opts && typeof opts.zh === 'boolean') return opts.zh;
    return /^zh/i.test((global.document && global.document.documentElement.lang) || 'zh');
  }
  function stateText(state, zh) {
    return (zh ? STATE_TEXT.zh : STATE_TEXT.en)[state] || String(state || '');
  }
  function phaseText(phase, zh) {
    if (!phase) return '';
    return (zh ? PHASE_TEXT.zh : PHASE_TEXT.en)[phase] || phase;
  }
  function percentOf(j) {
    if (!j) return null;
    if (j.state === 'done') return 100;
    const p = j.progress || {};
    return p.percent === undefined || p.percent === null ? null : p.percent;
  }
  function num(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }
  /** 下载层进度（0-100）：下载阶段随字节涨，进入打包后固定 100 —— 底层始终表示「下载完了没」 */
  function dlPctOf(j) {
    if (!j) return null;
    if (j.state === 'done') return 100;
    const p = j.progress || {};
    const d = num(p.dlPercent);
    if (d !== null) return d;
    // 老记录没有分层字段：下载阶段的 percent 就是下载进度
    if (!p.phase || p.phase === 'download') return num(p.percent);
    return 100;
  }
  /** 是否处于打包阶段：state 可能是含混的 downloading，所以再看一眼 phase */
  function isPackingPhase(j) {
    if (!j) return false;
    if (j.state === 'packing') return true;
    const p = j.progress || {};
    return j.state === 'downloading' && !!p.phase && p.phase !== 'download';
  }
  /** 打包层进度（0-100）：只在打包中时有值，用来画深色覆盖层；完成后收掉 */
  function packPctOf(j) {
    if (!j) return null;
    if (!isPackingPhase(j)) return null;
    const p = j.progress || {};
    const v = num(p.packPercent);
    return v !== null ? v : num(p.percent);
  }
  /**
   * 进度条：底层是下载，深色层叠加是打包。
   * pack 为 null 时不画打包层（纯下载任务就是一条普通进度条）。
   */
  function barHtml(pct, cls, pack) {
    const extra = cls ? ' ' + cls : '';
    const dl = pct === null || pct === undefined ? null : Math.max(1, Math.min(100, pct));
    const pk = pack === null || pack === undefined ? null : Math.max(1, Math.min(100, pack));
    const inner = `<i${dl === null ? '' : ` style="width:${dl}%"`}></i>`
      + (pk === null ? '' : `<i class="pack" style="width:${pk}%"></i>`);
    const ind = dl === null ? ' indeterminate' : '';
    return `<div class="bar${pk !== null ? ' layered' : ''}${ind}${extra}">${inner}</div>`;
  }

  /** 失败原因归类：前端据此给「重新登录 / 换节点重试」，而不是让用户读文案猜下一步 */
  function errorKind(err) {
    const s = String(err || '');
    if (!s) return '';
    if (/登录|login|credential|未登录|refresh token|token 失效|会话|sign in/i.test(s)) return 'auth';
    if (/ITEM_BUSY|已有任务在跑/.test(s)) return 'busy';
    if (/ECONN|ETIMEDOUT|超时|timeout|socket|network|网络|节点|CDN|HTTP 5\d\d|带宽/i.test(s)) return 'network';
    return 'other';
  }

  /** 卡片正文里的灰色小字 */
  function metaParts(j) {
    const p = j.progress || {};
    const out = [];
    if (j.state === 'done' && j.size) out.push(human(j.size));
    if (p.total) out.push(`${human(p.bytes || 0)} / ${human(p.total)}`);
    else if (p.bytes) out.push(human(p.bytes));
    if (isRun(j) && p.speed && !j.paused) out.push(`${human(p.speed)}/s`);
    if (isRun(j) && p.eta && !j.paused) out.push(`${secs(p.eta)}`);
    if (isPackingPhase(j)) {
      // 打包阶段只报「下载已完成 + 打包百分比」，不再显示下载字节，免得看着像下载又从头开始
      out.push(isZh() ? '下载完成' : 'Downloaded');
    }
    if (p.packTotal) out.push(`${p.packDone || 0}/${p.packTotal}`);
    if (j.result && j.result.type) out.push(j.result.type);
    if (j.result && j.result.rawExport) out.push(isZh() ? '原始资源' : 'raw assets');
    if (j.rawDir) out.push(isZh() ? '原始文件' : 'raw files');
    return out;
  }

  /**
   * 把所有 UI 需要的信息折成一个视图对象：
   * { 状态、阶段、百分比、meta、错误、动作列表 }
   * 动作是抽象描述（act 是统一动作名），各页面自己决定用 button 还是 a。
   */
  function view(j, opts) {
    const o = opts || {};
    const zh = isZh(o);
    const p = j.progress || {};
    const run = isRun(j);
    const dlPct = dlPctOf(j);
    const packPct = packPctOf(j);
    // 卡片上的大数字：下载中说下载进度，打包中说打包进度
    const pct = packPct !== null ? packPct : percentOf(j);
    const kinds = [];
    if (run) kinds.push('run');
    if (j.state === 'done') kinds.push('done');
    if (j.state === 'failed') kinds.push('failed');
    if (j.state === 'cancelled') kinds.push('ended');
    // 打包阶段统一按 packing 展示（state 有时还停在 downloading）
    const stateLabel = packPct !== null || isPackingPhase(j) ? stateText('packing', zh) : stateText(j.state, zh);

    const phaseParts = [];
    if (j.paused) phaseParts.push(zh ? '已暂停' : 'Paused');
    else phaseParts.push(phaseText(p.phase, zh) || stateText(j.state, zh));
    if (p.detail) phaseParts.push(p.detail);
    const phase = phaseParts.filter(Boolean).join(' · ');

    const rawExport = !!(j.result && j.result.rawExport);
    const actions = [];
    if (run && j.state === 'downloading' && (!p.phase || p.phase === 'download') && (!j.engine || j.engine === 'steamjs')) {
      actions.push(j.paused
        ? { act: 'resume', label: zh ? '继续' : 'Resume', primary: true }
        : { act: 'pause', label: zh ? '暂停' : 'Pause' });
    }
    if (run) actions.push({ act: 'cancel', label: zh ? '取消' : 'Cancel' });
    if (j.state === 'failed' || j.state === 'cancelled') {
      actions.push({ act: 'retry', label: zh ? '重试' : 'Retry' });
    }
    if (j.state === 'failed' && errorKind(j.error) === 'network') {
      actions.push({ act: 'retry-node', label: zh ? '换节点重试' : 'Retry on other node' });
    }
    if (j.state === 'failed' && errorKind(j.error) === 'auth') {
      actions.push({ act: 'relogin', label: zh ? '重新登录' : 'Sign in again', primary: true });
    }
    if (j.state === 'done') {
      const bridge = o.bridge || null;
      let nativeAct = null;
      if (bridge && j.outPath) {
        if (rawExport && typeof bridge.openFile === 'function') {
          nativeAct = { act: 'openfile', label: zh ? '打开文件' : 'Open file', primary: true };
        } else if (!rawExport && typeof bridge.openMpkg === 'function') {
          nativeAct = { act: 'import', label: zh ? '导入壁纸引擎' : 'Import to WE', primary: true };
        }
      }
      if (nativeAct) {
        actions.push(nativeAct);
      } else if (j.outFile) {
        // 没有原生桥（桌面浏览器）：走普通下载；安卓 WebView 没有下载能力，所以有桥时不显示
        actions.push({
          act: 'save',
          label: rawExport ? (zh ? '保存原始资源 .zip' : 'Save raw .zip') : (zh ? '保存 .mpkg' : 'Save .mpkg'),
          href: o.fileBase ? `${o.fileBase}${encodeURIComponent(j.id)}` : null,
          primary: true,
        });
      }
      // 桌面端才有「打开所在文件夹」；安卓外壳交给系统打开文件，不需要它
      if (!bridge && j.outPath && o.reveal !== false) {
        actions.push({ act: 'reveal', label: zh ? '打开所在文件夹' : 'Show in folder' });
      }
    }
    actions.push({ act: 'forget', label: zh ? '移除' : 'Remove', growEnd: true });

    return {
      id: j.id, itemId: j.itemId, title: j.title || `wallpaper_${j.itemId}`,
      state: j.state, stateText: stateLabel,
      paused: !!j.paused, running: run,
      pct, bar: barHtml(dlPct, '', packPct),
      dlPct, packPct,
      phase, phaseText: phaseText(p.phase, zh),
      meta: metaParts(j),
      metaText: metaParts(j).join(' · '),
      error: j.error || '', errorKind: errorKind(j.error),
      errorText: j.error ? (ERR_TEXT[zh ? 'zh' : 'en'][errorKind(j.error)] || '') : '',
      warnings: (j.result && j.result.warnings) || [],
      rawExport,
      outFile: j.outFile || null, outPath: j.outPath || null,
      engine: j.engine || null,
      actions,
      kinds,
      badge: j.paused ? (zh ? '已暂停' : 'Paused') : stateLabel,
    };
  }

  /** 顶部常驻任务条要的数字：运行数 + 总体进度（按字节加权，未知进度按不确定态处理） */
  function aggregate(jobs) {
    const list = jobs || [];
    const running = list.filter(isRun);
    const total = list.length;
    if (!running.length) return { running: 0, queued: 0, total, pct: null, bytes: 0, totalBytes: 0, speed: 0 };
    let known = 0, weight = 0, bytes = 0, totalBytes = 0, speed = 0;
    for (const j of running) {
      const p = j.progress || {};
      const b = Number(p.bytes) || 0;
      const t = Number(p.total) || 0;
      bytes += b;
      speed += Number(p.speed) || 0;
      totalBytes += t;
      if (typeof p.dlPercent === 'number' && Number.isFinite(p.dlPercent)) {
        // 下载占前半程、打包占后半程：顶栏那一条用两层的平均值，别让一段走完就 100%
        const pk = typeof p.packPercent === 'number' && Number.isFinite(p.packPercent) ? p.packPercent : null;
        const prog = pk === null ? p.dlPercent : (p.dlPercent + pk) / 2;
        known += prog * (t || 1);
        weight += (t || 1);
      } else if (typeof p.percent === 'number' && Number.isFinite(p.percent)) {
        known += p.percent * (t || 1);
        weight += (t || 1);
      }
    }
    const pct = weight ? Math.round(known / weight) : null;
    return { running: running.length, queued: list.filter((j) => j.state === 'queued').length, total, pct, bytes, totalBytes, speed };
  }

  /** 重绘判定：状态、暂停、进度、日志长度、结果都要算进去（漏一项就会出现「暂停了但列表不动」） */
  function fingerprint(jobs) {
    return JSON.stringify((jobs || []).map((j) => [
      j.id, j.state, !!j.paused, j.progress && j.progress.percent, j.progress && j.progress.bytes,
      j.progress && j.progress.phase, j.progress && j.progress.detail,
      j.error, (j.log || []).length, (j.result && j.result.warnings && j.result.warnings.length) || 0,
      !!(j.result && j.result.rawExport), j.outPath || null, j.outFile || null,
    ]));
  }

  global.WE_JOBS = {
    esc, human, secs, isRun, isEnded, isZh,
    stateText, phaseText, percentOf, barHtml, errorKind, metaParts, view, aggregate, fingerprint,
    dlPctOf, packPctOf, isPackingPhase,
    STATE_TEXT, PHASE_TEXT,
  };
})(typeof window !== 'undefined' ? window : globalThis);
