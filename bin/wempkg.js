#!/usr/bin/env node
'use strict';
/**
 * we-mpkg 命令行
 *
 *   node bin/wempkg.js serve  [--port 3090]                 打开网页浏览界面
 *   node bin/wempkg.js browse [--search xx] [--sort trend] [--tag Scene,Video] [--group "Genre:Anime,Fantasy"] [--page 1]
 *     --tag   多个标签之间是「与」（强制同时命中）
 *     --group 同一组内是「或」，不同组之间是「与」，与官方客户端一致；可重复
 *   node bin/wempkg.js info   <id>                          查看条目详情
 *   node bin/wempkg.js get    <id> [--title 名称] [--ref 参考.mpkg]   下载并打包成 mpkg
 *   node bin/wempkg.js fetch  <id>                          只下载（保留原始文件）
 *   node bin/wempkg.js pack   <目录|.pkg|.mpkg> [--out x.mpkg] [--ref ref.mpkg]
 *   node bin/wempkg.js inspect <目录|.pkg|.mpkg>            分析结构
 */
const fs = require('fs');
const path = require('path');
const { config, ensureDirs } = require('../src/config');
const workshop = require('../src/workshop');
const steamcmd = require('../src/steamcmd');
const packer = require('../src/pack');

function parseArgs(argv) {
  const args = { _: [] };
  const put = (key, value) => {
    if (args[key] === undefined) args[key] = value;
    else if (Array.isArray(args[key])) args[key].push(value);
    else args[key] = [args[key], value];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) put(key, true);
      else { put(key, next); i++; }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function human(bytes) {
  if (!bytes) return '—';
  if (bytes > 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes > 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  if (bytes > 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function dateStr(ts) {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function accountFromArgs(args) {
  if (!args.user) return null;
  return { user: String(args.user), pass: args.pass ? String(args.pass) : '' };
}

function entitlementHint(reason) {
  if (!reason) return '';
  if (!/授权|解密密钥|depot|订阅|Access Denied/.test(reason)) return '';
  return `\n提示：公开条目必须用「拥有 Wallpaper Engine 的账号」下载。两种方式：
  1) 设置环境变量 STEAM_USERNAME / STEAM_PASSWORD 后重试；
  2) 交互登录：node bin/wempkg.js ${process.argv[2] === 'fetch' ? 'fetch' : 'get'} <id> --interactive --user 你的账号
     程序会打开 SteamCMD 窗口让你输入密码 / Steam Guard 验证码。`;
}

async function cmdBrowse(args) {
  const tags = String(args.tag || '').split(',').map((s) => s.trim()).filter(Boolean);
  // --group "Genre:Anime,Fantasy" 可重复；同一组内是「或」，不同组之间是「与」（官方语义）
  const rawGroups = args.group === undefined ? [] : (Array.isArray(args.group) ? args.group : [args.group]);
  const groups = rawGroups
    .map((g) => {
      const s = String(g);
      const idx = s.indexOf(':');
      if (idx < 0) return null;
      const name = s.slice(0, idx).trim();
      const list = s.slice(idx + 1).split(',').map((x) => x.trim()).filter(Boolean);
      return name && list.length ? { name, tags: list } : null;
    })
    .filter(Boolean);
  const res = await workshop.browse({
    search: args.search || '',
    sort: args.sort || 'trend',
    tags,
    groups: groups.length ? groups : null,
    page: parseInt(args.page || '1', 10),
    perPage: parseInt(args.perPage || '20', 10),
    days: parseInt(args.days || '0', 10),
  });
  console.log(`\n后端: ${res.backend}  共 ${res.total} 条${res.warning ? `  ⚠ ${res.warning}` : ''}\n`);
  for (const it of res.items) {
    console.log(`${it.id}  ${(it.title || '').slice(0, 50)}`);
    console.log(`        订阅 ${it.subscriptions} | 大小 ${human(it.fileSize)} | 更新 ${dateStr(it.timeUpdated)} | ${(it.tags || []).slice(0, 4).join('/')}`);
  }
  console.log('');
}

async function cmdInfo(args) {
  const id = args._[0];
  if (!id) throw new Error('用法: info <创意工坊 id>');
  const d = await workshop.getItemDetail(id);
  console.log(`\n标题: ${d.title}\n作者: ${d.author || '—'}\n订阅: ${d.subscriptions}  收藏: ${d.favorited}  浏览: ${d.views}`);
  console.log(`大小: ${human(d.fileSize)}  更新: ${dateStr(d.timeUpdated)}  发布: ${dateStr(d.timeCreated)}`);
  console.log(`标签: ${(d.tags || []).join(', ')}`);
  console.log(`预览: ${d.preview}`);
  console.log(`\n简介:\n${(d.description || '（无）').slice(0, 800)}\n`);
}

async function cmdFetch(args) {
  const id = args._[0];
  if (!id) throw new Error('用法: fetch <id> [--user 账号 --pass 密码 | --interactive]');
  const res = await steamcmd.downloadWorkshopItem({
    id,
    onLog: (l) => console.log(`[steamcmd] ${l}`),
    account: accountFromArgs(args),
    interactive: !!args.interactive,
  });
  if (!res.ok) {
    console.error(`\n下载失败: ${res.reason || '未知原因'}${entitlementHint(res.reason)}`);
    process.exitCode = 2;
    return;
  }
  ensureDirs();
  const dest = path.join(config.DOWNLOAD_DIR, String(id));
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(res.dir, { withFileTypes: true })) {
    const from = path.join(res.dir, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) fs.cpSync(from, to, { recursive: true });
    else fs.copyFileSync(from, to);
  }
  console.log(`\n已保存原始文件: ${dest}`);
  if (!args.keep) steamcmd.cleanupRoot(res.root);
}

async function cmdGet(args) {
  const id = args._[0];
  if (!id) throw new Error('用法: get <id> [--title 名称] [--ref 参考.mpkg] [--user 账号 --pass 密码 | --interactive]');
  const detail = await workshop.getItemDetail(id).catch(() => ({ title: `wallpaper_${id}` }));
  console.log(`\n条目: ${detail.title || id}`);
  const dl = await steamcmd.downloadWorkshopItem({
    id,
    onLog: (l) => console.log(`[steamcmd] ${l}`),
    account: accountFromArgs(args),
    interactive: !!args.interactive,
  });
  if (!dl.ok) {
    console.error(`\n下载失败: ${dl.reason || '未知原因'}${entitlementHint(dl.reason)}`);
    process.exitCode = 2;
    return;
  }
  const ref = args.ref || (fs.existsSync(path.join(config.ROOT, 'refs', `${id}.mpkg`)) ? path.join(config.ROOT, 'refs', `${id}.mpkg`) : null);
  const out = await packer.packFromItemDir(dl.dir, {
    id,
    title: args.title || detail.title || `wallpaper_${id}`,
    reference: ref,
    ...packOptions(args),
    ...webOptions(args),
    onLog: (l) => console.log(`[pack] ${l}`),
  });
  steamcmd.cleanupRoot(dl.root);
  console.log(`\n✔ 完成: ${out.outFile}`);
  printSummary(out);
}

async function cmdPack(args) {
  const input = args._[0];
  if (!input) throw new Error('用法: pack <目录|.pkg|.mpkg> [--title 名称] [--out x.mpkg] [--ref ref.mpkg] [--quality high|balanced|smooth|original] [--keep-audio] [--resume]');
  if (!fs.existsSync(input)) throw new Error(`路径不存在: ${input}`);
  const out = await packer.packFromPath(input, {
    title: args.title,
    reference: args.ref,
    outDir: args.out ? path.dirname(path.resolve(args.out)) : config.OUTPUT_DIR,
    ...packOptions(args),
    ...webOptions(args),
    onLog: (l) => console.log(`[pack] ${l}`),
  });
  if (args.out) fs.renameSync(out.outFile, path.resolve(args.out));
  console.log(`\n✔ 完成: ${args.out ? path.resolve(args.out) : out.outFile}`);
  printSummary(out);
}

/** 打包结果摘要：体积变化、纹理转换、着色器改写、音频、告警 */
function printSummary(out) {
  if (!out) return;
  if (out.preset) console.log(`  画质档位: ${out.preset.label}（reduction=${out.preset.reduction}）  容器: ${out.magic || 'PKGM0020'}`);
  const t = out.tex;
  if (t) {
    console.log(`  纹理: 共 ${t.total}，转换 ${t.converted}（降采样 ${t.downsampled}），保留 ${t.kept}，视频 ${t.video}，超预算 ${t.budget}，失败 ${t.failed}${t.resumed ? `，续转跳过 ${t.resumed}` : ''}`);
  }
  if (out.shader && out.shader.rewritten) {
    console.log(`  着色器: ${out.shader.rewritten} 个文件（${out.shader.literals} 处补 .0，${out.shader.structural} 处结构性修正）`);
  }
  if (out.audio && out.audio.removed) {
    console.log(`  音频: 剥离 ${out.audio.removed} 个文件 / ${(out.audio.bytes / 1048576).toFixed(2)} MB`);
  }
  for (const w of out.warnings || []) console.log(`  ⚠ ${w}`);
}

async function cmdInspect(args) {
  const input = args._[0];
  if (!input) throw new Error('用法: inspect <目录|.pkg|.mpkg>');
  const a = packer.analyze(input);
  console.log(`\n输入: ${a.input}\n类型: ${a.kind}${a.magic ? `  标记: ${a.magic}` : ''}${a.type ? `  壁纸类型: ${a.type}` : ''}`);
  console.log(`文件数: ${a.files.length}`);
  for (const f of a.files.slice(0, 80)) console.log(`  ${f.path}  ${human(f.size)}`);
  if (a.files.length > 80) console.log(`  ... 其余 ${a.files.length - 80} 个`);
  if (a.project) {
    const p = Object.assign({}, a.project);
    delete p.__parseError;
    console.log(`\nproject.json（节选）: ${JSON.stringify(p).slice(0, 400)}`);
  }
}

async function cmdServe(args) {
  const server = require('../src/server');
  await server.start(args.port ? parseInt(args.port, 10) : config.PORT);
  process.stdin.resume();
}

/** 只起下载中心（独立进程，关掉网页/关掉主服务都不影响下载） */
async function cmdDlHub(args) {
  const dlhub = require('../src/dlhub');
  const port = args.port ? parseInt(args.port, 10) : dlhub.DEFAULT_PORT;
  const r = await dlhub.ensureHub({ port, logger: (m) => console.log(m) });
  console.log(`下载中心已就绪: ${r.url}${r.embedded ? '（进程内模式）' : ''}`);
  console.log('这个窗口可以最小化，别关；关掉页面不影响下载。Ctrl+C 会保存队列后退出。');
  process.stdin.resume();
}

async function cmdSteamjs(args) {
  const steamjs = require('../src/steamjs');
  const sub = (args._.shift() || 'status').toLowerCase();

  if (sub === 'status' || sub === 'whoami') {
    const t = steamjs.readToken();
    if (!t) {
      console.log('\n未登录。执行: run.bat steamjs login\n');
      return;
    }
    console.log(`\n已保存凭据: ${t.accountName || '(未知账号)'}  保存于 ${t.savedAt || '?'}`);
    console.log(`文件: ${steamjs.TOKEN_FILE}\n`);
    return;
  }

  if (sub === 'logout') {
    steamjs.clearToken();
    console.log('\n✔ 已删除本地登录凭据\n');
    return;
  }

  if (sub === 'token') {
    const t = steamjs.readToken();
    if (!t) throw new Error('还没登录，先执行: run.bat steamjs login');
    const blob = Buffer.from(JSON.stringify({ refreshToken: t.refreshToken, accountName: t.accountName }), 'utf8').toString('base64');
    console.log('\n把下面整段粘贴到手机 App 的“登录凭据”输入框（这是一段 Base64，不是密码）：\n');
    console.log(blob);
    console.log(`\n账号: ${t.accountName || '?'}  长度: ${blob.length}\n`);
    return;
  }

  // 社区站登录态（创意工坊网页抓取的「账号范围」就靠它）
  if (sub === 'webcookie' || sub === 'web') {
    const webcookie = require('../src/webcookie');
    if (args.refresh || args.f) {
      console.log('\n正在换社区站登录 cookie（会连一下 Steam，几秒钟）…');
      const c = await webcookie.getLoginCookie({ force: true, onLog: (m) => console.log(`  ${m}`) });
      if (!c) {
        console.log('\n✘ 没换到：需要先 steamjs login 拿到凭据\n');
        return;
      }
    }
    const s = webcookie.cachedStatus();
    if (!s.loggedIn) {
      console.log('\n社区站登录态: 未启用（创意工坊按匿名范围抓，条目比客户端少）');
      console.log('启用: run.bat steamjs webcookie --refresh\n');
      return;
    }
    console.log(`\n社区站登录态: 已启用${s.fresh ? '' : '（已过期，下次访问会自动续）'}`);
    console.log(`账号: ${s.accountName || '?'}  steamID: ${s.steamId || '?'}`);
    console.log(`取得时间: ${new Date(s.at).toLocaleString()}`);
    console.log(`缓存: ${webcookie.COOKIE_FILE}\n`);
    return;
  }

  if (sub === 'login') {
    if (args.user) {
      const pass = args.pass || process.env.STEAM_PASSWORD;
      if (!pass) throw new Error('密码登录需要 --pass 或 STEAM_PASSWORD 环境变量；推荐直接用扫码登录（不带参数）');
      console.log(`\n账号密码登录: ${args.user}`);
      await steamjs.passwordLogin({
        user: args.user,
        pass,
        onLog: (l) => console.log(`[steam] ${l}`),
        onPrompt: (m) => console.log(`[steam] ${m}`),
        getCode: () => ask('请输入 Steam Guard 验证码: '),
      });
      return;
    }
    console.log('\n=== 扫码登录（推荐）===');
    await steamjs.qrLogin({
      onLog: (l) => console.log(`[steam] ${l}`),
      onQr: (url) => {
        const { printQr } = require('../src/steamjs');
        if (typeof printQr === 'function') return printQr(url);
        console.log(`二维码地址: ${url}`);
      },
    });
    console.log('\n✔ 登录态已保存，下次不用再扫\n');
    return;
  }

  if (sub === 'get' || sub === 'download') {
    const id = args._[0];
    if (!id) throw new Error('用法: steamjs get <创意工坊id> [--title 名称] [--ref 参考.mpkg]');
    const token = steamjs.readToken();
    if (!token) throw new Error('还没有登录凭据，先执行: run.bat steamjs login');

    const detail = await workshop.getItemDetail(id).catch(() => ({ title: `wallpaper_${id}` }));
    console.log(`\n条目: ${detail.title || id}`);

    const outDir = path.join(config.DOWNLOAD_DIR, `js-${id}`);
    const res = await steamjs.downloadItem({
      id,
      outDir,
      refreshToken: token.refreshToken,
      onLog: (l) => console.log(`[js] ${l}`),
      onProgress: ({ file, done, total }) => {
        if (total) process.stdout.write(`\r  ${file}: ${Math.round((done / total) * 100)}%   `);
      },
    });
    process.stdout.write('\n');

    const ref = args.ref || (fs.existsSync(path.join(config.ROOT, 'refs', `${id}.mpkg`)) ? path.join(config.ROOT, 'refs', `${id}.mpkg`) : null);
    const out = await packer.packFromItemDir(res.dir, {
      id,
      title: args.title || res.title || `wallpaper_${id}`,
      reference: ref,
      ...packOptions(args),
      ...webOptions(args),
      onLog: (l) => console.log(`[pack] ${l}`),
    });
    console.log(`\n✔ 完成: ${out.outFile}`);
    printSummary(out);
    return;
  }

  throw new Error(`未知 steamjs 子命令: ${sub}（可用: login / status / logout / get）`);
}

/** web 类转视频参数（--web-seconds / --web-fps / --web-width / --web-height） */
function webOptions(args) {
  const num = (v) => (v === undefined || v === null || v === '' ? undefined : Number(v));
  const o = {
    webSeconds: num(args['web-seconds']),
    webFps: num(args['web-fps']),
    webWidth: num(args['web-width']),
    webHeight: num(args['web-height']),
    webLayout: args['web-layout'],
  };
  for (const k of ['webSeconds', 'webFps', 'webWidth', 'webHeight']) if (!Number.isFinite(o[k]) || o[k] <= 0) delete o[k];
  if (typeof o.webLayout !== 'string') delete o.webLayout;
  return o;
}

/**
 * 打包相关参数
 *   --quality high|balanced|smooth|original  画质档位（默认 high）
 *   --keep-audio                             保留壁纸自带音频（默认剥离）
 *   --drop-audio-layers                      强制移除音频频谱可视化层（默认修复并保留）
 *   --resume                                 沿用上次的工作目录与断点，中断后接着转
 *   --video-magic 0014|0020                  视频类 mpkg 的容器魔数（默认 0020）
 *   --max-texture-mb N                       单张纹理解码内存预算（默认 192）
 */
function packOptions(args) {
  const o = {};
  if (typeof args.quality === 'string') o.preset = args.quality;
  if (args['keep-audio']) o.preserveAudio = true;
  if (args['drop-audio-layers']) o.dropAudioLayers = true;
  if (args.resume) o.resume = true;
  if (typeof args['video-magic'] === 'string') o.videoMagic = args['video-magic'];
  const mb = Number(args['max-texture-mb']);
  if (Number.isFinite(mb) && mb > 0) o.maxRgbaBytes = Math.round(mb * 1048576);
  return o;
}

function ask(question) {
  const readline = require('readline');
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (a) => { rl.close(); resolve(a.trim()); });
  });
}

async function cmdCdn(args) {
  const steamjs = require('../src/steamjs');
  const cdn = require('../src/cdn');
  const show = (data) => {
    const geo = data.geo || {};
    console.log(`\n客户端地区: ${geo.region || geo.country || geo.countryCode || '未知'}${geo.isp ? ` / ${geo.isp}` : ''}（来源 ${geo.source || '?'}）`);
    console.log(`测速时间: ${new Date(data.testedAt).toLocaleString()}\n`);
    (data.servers || []).forEach((s, i) => {
      const tag = s.domestic ? '国内' : (s.cluster || s.provider || '');
      console.log(`${String(i + 1).padStart(2)}. ${s.ok ? `${String(s.latencyMs).padStart(5)}ms` : '   ✘   '}  tier${s.tier}  ${s.host}  ${tag}`);
    });
    console.log('');
  };
  if (!args.test) {
    const cached = cdn.loadCached();
    if (!cached) {
      console.log('还没有测速结果。跑一次：node bin/wempkg.js cdn --test');
      return;
    }
    show(cached);
    return;
  }
  const token = steamjs.readToken();
  if (!token || !token.refreshToken) throw new Error('还没有登录 Steam，先执行: run.bat steamjs login');
  const client = await steamjs.connect(token.refreshToken, { onLog: (m) => console.log(`  ${m}`) });
  try {
    const data = await cdn.testRanking(client, { onLog: (m) => console.log(`  ${m}`) });
    show(data);
  } finally {
    try { client.logOff(); } catch { /* ignore */ }
    cdn.releaseIdleSockets();
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const cmd = args._.shift();
  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log(`we-mpkg — 浏览 Wallpaper Engine 创意工坊并导出手机版 .mpkg

  serve    启动网页界面（默认 http://localhost:${config.PORT}）
  dlhub    只启动下载中心（独立进程，默认 http://127.0.0.1:${require('../src/dlhub').DEFAULT_PORT}）
  browse   搜索/浏览创意工坊
  info     查看条目详情
  get      下载并打包成 .mpkg（一步到位）
  fetch    只下载原始文件
  pack     把本地目录 / .pkg 打成 .mpkg
            --quality high|balanced|smooth|original  画质档位（默认 high）
            --keep-audio   保留壁纸自带音频（默认剥离）
            --drop-audio-layers  强制移除音频频谱可视化层（默认修复后保留）
            --resume       沿用上次工作目录与断点，中断后接着转
            --max-texture-mb N  单张纹理解码内存预算（默认 192）
  inspect  查看目录或容器的内部结构
  cdn      CDN 节点测速（--test 立即重测，否则显示上次结果）
  steamjs  纯 JS 下载引擎（不依赖 SteamCMD，安卓可用）
           steamjs login            扫码登录，凭据存 .cache/steam-token.json
           steamjs status / logout  查看 / 清除登录态
           steamjs webcookie       查看创意工坊的「账号范围」登录态（--refresh 重新获取）
           steamjs get <id>         下载并打包

环境变量:
  WE_MPKG_PROXY / HTTPS_PROXY   代理
  STEAM_USERNAME / STEAM_PASSWORD  需要账号才能下载时使用
  STEAM_API_KEY                可选，走 QueryFiles 检索
`);
    return;
  }
  ensureDirs();
  const table = { serve: cmdServe, dlhub: cmdDlHub, browse: cmdBrowse, info: cmdInfo, get: cmdGet, fetch: cmdFetch, pack: cmdPack, inspect: cmdInspect, cdn: cmdCdn, steamjs: cmdSteamjs };
  const fn = table[cmd];
  if (!fn) throw new Error(`未知命令: ${cmd}（用 help 查看用法）`);
  await fn(args);
}

main().catch((e) => {
  console.error(`\n✘ ${e.message}\n`);
  process.exitCode = 1;
});
